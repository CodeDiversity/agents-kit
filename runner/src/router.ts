import type { DeliveryState, GateRecord, RouteResult, Stage } from "./types.js";
import type { Predicate, SpecEdge, WorkflowSpec } from "./spec.js";

export function planningSatisfied(record: Pick<GateRecord, "breakdown_valid" | "plan_approval">): GateRecord["planning_satisfied"] {
  if (record.breakdown_valid === false) return false;
  if (
    record.plan_approval === "missing" ||
    record.plan_approval === "findings_open" ||
    record.plan_approval === "findings_awaiting_rereview" ||
    record.plan_approval === "stale"
  ) {
    return false;
  }
  if (record.breakdown_valid === true && record.plan_approval === "ready") return true;
  return "unknown";
}

export function neutralRecord(overrides: Partial<GateRecord> = {}): GateRecord {
  const base: GateRecord = {
    writer_ownership: "none",
    session_live: false,
    breakdown_valid: true,
    plan_approval: "ready",
    planning_satisfied: true,
    child_unfinished: false,
    needs_ui_refinement: false,
    needs_technical_refinement: false,
    eligible_child_state: "none",
    closeout_complete: true,
    all_descendants_implemented: true,
    integration_complete: true,
    open_findings: false,
    findings_owner: "none",
    review: "pass",
    walkthrough: "verified",
    retry_cycles: 0,
    same_findings: false,
    blocker_kind: "none",
    blocker_answered: true,
    entry_hint: "",
    judgment_attempts: 0,
  };
  const merged = { ...base, ...overrides };
  merged.planning_satisfied = planningSatisfied(merged);
  return merged;
}

export function toGateRecord(state: DeliveryState): GateRecord {
  const record = neutralRecord({
    writer_ownership: state.writer,
    session_live: state.sessionLive,
    breakdown_valid: state.gates.breakdown,
    plan_approval: state.gates.plan,
    child_unfinished: state.gates.childUnfinished,
    needs_ui_refinement: state.gates.ui,
    needs_technical_refinement: state.gates.refinement,
    eligible_child_state: state.gates.eligibleChildState,
    closeout_complete: state.gates.closeout,
    all_descendants_implemented: state.gates.allDescendantsImplemented,
    integration_complete: state.gates.integration,
    open_findings: state.gates.openFindings,
    findings_owner: state.gates.findingsOwner,
    review: state.gates.review,
    walkthrough: state.gates.walkthrough,
    retry_cycles: state.lastResult.cycles,
    same_findings: state.lastResult.sameFindings,
    blocker_kind: state.blocker.kind || "none",
    blocker_answered: state.blocker.kind === "none" || state.blocker.answer.trim().length > 0,
    entry_hint: state.scope.entry,
    judgment_attempts: state.judgmentAttempts,
  });
  return record;
}

function fieldValue(record: GateRecord, field: string): unknown {
  return record[field as keyof GateRecord];
}

function matches(predicate: Predicate, record: GateRecord): boolean {
  if (predicate.always === true) return true;
  if (predicate.all) return predicate.all.every((item) => matches(item, record));
  if (predicate.any) return predicate.any.some((item) => matches(item, record));
  if (!predicate.field) return false;
  const value = fieldValue(record, predicate.field);
  if (predicate.gte !== undefined) return typeof value === "number" && value >= predicate.gte;
  if (predicate.in) return predicate.in.some((item) => Object.is(item, value));
  if ("eq" in predicate) return Object.is(predicate.eq, value);
  return false;
}

export function route(spec: WorkflowSpec, record: GateRecord): RouteResult {
  const edge = spec.edges.find((item) => matches(item.when ?? {}, record));
  if (!edge) {
    throw new Error("workflow graph has no matching edge and no unmatched fallback");
  }
  if (edge.parallel) throw new Error(`edge ${edge.id} fans out; delivery is single-writer`);
  return {
    edge: edge.id,
    to: edge.to,
    assignment: edge.assignment ?? "",
    stage: (edge.stage as Stage | undefined) ?? "reconcile",
    interrupt: edge.interrupt,
    question: questionFor(edge, record),
  };
}

function questionFor(edge: SpecEdge, record: GateRecord): string {
  if (edge.id === "recorded_blocker") return record.entry_hint ? edge.question ?? "" : edge.question ?? "";
  return edge.question ?? "";
}

export function nodeById(spec: WorkflowSpec, id: string) {
  const node = spec.nodes.find((item) => item.id === id);
  if (!node) throw new Error(`unknown graph node ${id}`);
  return node;
}
