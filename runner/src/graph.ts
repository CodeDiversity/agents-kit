import { Annotation, END, START, StateGraph, interrupt, isGraphInterrupt } from "@langchain/langgraph";
import { writeCheckpoint } from "./checkpoint.js";
import { applyJudgment, parseJudge, validateJudge, pathsFromCloseout } from "./closeout.js";
import { commitOwned } from "./git.js";
import { buildHandoff, judgePrompt } from "./handoff.js";
import { judgmentUnknowns, reconcile } from "./reconcile.js";
import { nodeById, route, toGateRecord } from "./router.js";
import type { WorkflowSpec } from "./spec.js";
import type { DeliveryState, SpecialistReturn } from "./types.js";
import type { HostAdapter } from "./hosts/types.js";
import { FileMemorySaver, checkpointerPath } from "./checkpointer.js";

const GraphState = Annotation.Root({
  delivery: Annotation<DeliveryState>({ reducer: (_left, right) => right }),
});

export interface GraphDeps {
  spec: WorkflowSpec;
  host?: HostAdapter;
  repo: string;
  recursionLimit?: number;
  maxJudgmentAttempts?: number;
}

interface CompiledDeliveryGraph {
  invoke(input: { delivery: DeliveryState }, config: { configurable: { thread_id: string }; recursionLimit: number }): Promise<unknown>;
  getState(config: { configurable: { thread_id: string } }): Promise<{ values: { delivery: DeliveryState } }>;
}

export function compileGraph(deps: GraphDeps): CompiledDeliveryGraph {
  const graph = new StateGraph(GraphState) as unknown as {
    addNode(id: string, action: (state: { delivery: DeliveryState }) => Promise<{ delivery: DeliveryState }>): unknown;
    addEdge(from: string, to: string): unknown;
    addConditionalEdges(from: string, path: (state: { delivery: DeliveryState }) => string, destinations: Record<string, string>): unknown;
    compile(options: { checkpointer: object }): CompiledDeliveryGraph;
  };
  graph.addNode("reconcile", (state) => reconcileNode(state.delivery, deps));
  for (const node of deps.spec.nodes) {
    graph.addNode(node.id, (state) => runNode(state.delivery, node.id, deps));
  }
  graph.addEdge(START, "reconcile");
  const destinations = Object.fromEntries(deps.spec.nodes.map((node) => [node.id, node.id]));
  graph.addConditionalEdges("reconcile", (state) => route(deps.spec, toGateRecord(state.delivery)).to, destinations);
  for (const node of deps.spec.nodes) {
    if (node.interrupt || node.id === "complete") graph.addEdge(node.id, END);
    else graph.addEdge(node.id, "reconcile");
  }
  const checkpointer = new FileMemorySaver(checkpointerPath(deps.repo));
  return graph.compile({ checkpointer });
}

async function reconcileNode(delivery: DeliveryState, deps: GraphDeps): Promise<{ delivery: DeliveryState }> {
  const sessionLive = delivery.activeDispatch.session && deps.host
    ? await deps.host.sessionLive(delivery.activeDispatch.session)
    : delivery.sessionLive;
  const next = await reconcile({
    repo: deps.repo,
    readmePath: delivery.readmePath,
    sessionLive,
  });
  next.scope.entry = delivery.scope.entry || next.scope.entry;
  next.scope.limits = delivery.scope.limits || next.scope.limits;
  next.scope.parent = delivery.scope.parent || next.scope.parent;
  if (delivery.blocker.answer.trim()) {
    next.blocker.answer = delivery.blocker.answer;
    next.blocker.kind = "none";
  }
  const decision = route(deps.spec, toGateRecord(next));
  next.stage = decision.stage;
  next.resume = decision.question || `${decision.edge} → ${decision.to}`;
  if (decision.interrupt) {
    const kind = decision.interrupt === "recorded" ? next.blocker.kind || "material_decision" : decision.interrupt;
    next.stage = "blocked";
    next.blocker = {
      kind,
      owner: "user",
      question: next.blocker.question || decision.question || "Delivery is blocked.",
      answer: "",
    };
    next.resume = next.blocker.question;
  }
  writeCheckpoint(next.readmePath, next, deps.repo);
  return { delivery: next };
}

async function runNode(delivery: DeliveryState, nodeId: string, deps: GraphDeps): Promise<{ delivery: DeliveryState }> {
  const specNode = nodeById(deps.spec, nodeId);
  const decision = route(deps.spec, toGateRecord(delivery));
  if (specNode.id === "complete") {
    delivery.stage = "complete";
    delivery.resume = "Parent review passed and the walkthrough is verified. Stop within this parent.";
    delivery.activeDispatch = { ...delivery.activeDispatch, status: "none", name: "", role: "", session: "" };
    writeCheckpoint(delivery.readmePath, delivery, delivery.coordinator.workspace);
    return { delivery };
  }
  if (specNode.interrupt) {
    const kind = decision.interrupt === "recorded" ? delivery.blocker.kind : decision.interrupt || specNode.interrupt;
    delivery.stage = "blocked";
    delivery.blocker = {
      kind: kind || "material_decision",
      owner: "user",
      question: delivery.blocker.question || decision.question || "Delivery is blocked.",
      answer: "",
    };
    delivery.resume = delivery.blocker.question;
    writeCheckpoint(delivery.readmePath, delivery, delivery.coordinator.workspace);
    interrupt({ kind: delivery.blocker.kind, question: delivery.blocker.question });
    return { delivery };
  }
  if (!deps.host) throw new Error("This command only reconciles. Pass a host to dispatch.");
  if (specNode.id === "judge") return { delivery: await judge(delivery, deps) };
  if (specNode.id === "wait") return { delivery: await waitForLive(delivery, deps) };
  return { delivery: await dispatchSpecialist(delivery, specNode.id, deps) };
}

async function judge(delivery: DeliveryState, deps: GraphDeps): Promise<DeliveryState> {
  const unknown = judgmentUnknowns(delivery);
  const task = `judge-${delivery.scope.parent}-${Date.now()}`;
  const result = await deps.host!.dispatch({
    role: "dod-auditor",
    taskName: task,
    handoff: judgePrompt(delivery, unknown),
    workspace: delivery.coordinator.workspace,
    readOnly: true,
  });
  if (result.paused) return pause(delivery, result.paused.kind, result.paused.question);
  const parsed = parseJudge(result.raw);
  const maxAttempts = deps.maxJudgmentAttempts ?? 2;
  if (!parsed) {
    delivery.judgmentAttempts += 1;
    if (delivery.judgmentAttempts >= maxAttempts) return pause(delivery, "missing_judgment", "Two judgment passes did not return a usable gate record.");
    writeCheckpoint(delivery.readmePath, delivery, delivery.coordinator.workspace);
    return delivery;
  }
  const validation = validateJudge(parsed, unknown);
  if (!validation.ok) {
    delivery.malformedJudgmentAttempts += 1;
    if (delivery.malformedJudgmentAttempts >= 3) return pause(delivery, "malformed_judgment", validation.reason);
    writeCheckpoint(delivery.readmePath, delivery, delivery.coordinator.workspace);
    return delivery;
  }
  const merged = applyJudgment(delivery, parsed);
  merged.judgmentAttempts = 0;
  merged.malformedJudgmentAttempts = 0;
  merged.activeDispatch = { name: task, role: "dod-auditor", status: "returned", pointer: "", session: result.sessionId, assignment: "judge" };
  writeCheckpoint(merged.readmePath, merged, deps.repo);
  return merged;
}

async function waitForLive(delivery: DeliveryState, deps: GraphDeps): Promise<DeliveryState> {
  const result = await deps.host!.wait(delivery.activeDispatch.session);
  return applyReturn(delivery, result, delivery.activeDispatch.role || "wait", "none");
}

async function dispatchSpecialist(delivery: DeliveryState, nodeId: string, deps: GraphDeps): Promise<DeliveryState> {
  const specNode = nodeById(deps.spec, nodeId);
  const decision = route(deps.spec, toGateRecord(delivery));
  const task = `${specNode.role ?? nodeId}-${decision.assignment || nodeId}-${Date.now()}`;
  delivery.activeDispatch = {
    name: task,
    role: specNode.role ?? nodeId,
    status: "pending",
    pointer: delivery.activeDispatch.pointer,
    session: "",
    assignment: decision.assignment,
  };
  delivery.stage = decision.stage;
  delivery.writer = specNode.role === "implementer" ? "held" : "none";
  writeCheckpoint(delivery.readmePath, delivery, delivery.coordinator.workspace);
  let result;
  try {
    result = await deps.host!.dispatch({
      role: specNode.role ?? nodeId,
      taskName: task,
      handoff: buildHandoff(delivery, specNode, decision.assignment),
      workspace: delivery.coordinator.workspace,
      readOnly: false,
    });
  } catch (error) {
    delivery.activeDispatch.status = "not_started";
    delivery.writer = "none";
    writeCheckpoint(delivery.readmePath, delivery, delivery.coordinator.workspace);
    throw error;
  }
  delivery.activeDispatch.session = result.sessionId;
  delivery.activeDispatch.status = "running";
  writeCheckpoint(delivery.readmePath, delivery, delivery.coordinator.workspace);
  return applyReturn(delivery, result, specNode.role ?? nodeId, specNode.commit ?? "none");
}

async function applyReturn(delivery: DeliveryState, result: SpecialistReturn, role: string, commit: string): Promise<DeliveryState> {
  if (result.paused) return pause(delivery, result.paused.kind, result.paused.question);
  delivery.activeDispatch.status = "returned";
  delivery.writer = "none";
  delivery.sessionLive = false;
  delivery.lastResult.evidence = result.records || delivery.lastResult.evidence;
  delivery.lastResult.scopeNote = result.status;
  delivery.blocker.answer = "";
  delivery.gates.judgedAtHead = "";
  if (commit === "coordinator") {
    const paths = pathsFromCloseout(`${result.records}\n${result.commits}`);
    const committed = await commitOwned(delivery.coordinator.workspace, role, paths, `chore: record ${role} handoff for ${delivery.scope.parent}`);
    delivery.lastResult.evidence = committed.hash || delivery.lastResult.evidence;
    if (committed.status === "pending") delivery.resume = `commit pending: ${committed.reason}`;
  }
  writeCheckpoint(delivery.readmePath, delivery, delivery.coordinator.workspace);
  return delivery;
}

function pause(delivery: DeliveryState, kind: string, question: string): DeliveryState {
  delivery.stage = "blocked";
  delivery.writer = delivery.activeDispatch.status === "running" ? "held" : delivery.writer;
  delivery.blocker = { kind, owner: "user", question, answer: "" };
  delivery.resume = question;
  writeCheckpoint(delivery.readmePath, delivery, delivery.coordinator.workspace);
  interrupt({ kind, question });
  return delivery;
}

export async function invokeGraph(compiled: CompiledDeliveryGraph, delivery: DeliveryState, threadId: string, recursionLimit = 250): Promise<DeliveryState> {
  const config = { configurable: { thread_id: threadId }, recursionLimit };
  try {
    await compiled.invoke({ delivery }, config);
  } catch (error) {
    if (!isGraphInterrupt(error)) throw error;
  }
  const snapshot = await compiled.getState(config);
  return snapshot.values.delivery;
}
