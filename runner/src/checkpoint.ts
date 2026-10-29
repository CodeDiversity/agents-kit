import fs from "node:fs";
import { parse, stringify } from "yaml";
import type { DeliveryState, DispatchStatus, FindingOwner, PlanApproval, ReviewGate, Stage, Tri, WalkthroughGate, WriterOwnership } from "./types.js";

const HEADING = "## Autopilot";

export function emptyState(partial: Partial<DeliveryState> = {}): DeliveryState {
  const base: DeliveryState = {
    scope: { parent: "", descendants: [], entry: "", limits: "enclosing parent review unit" },
    stage: "reconcile",
    coordinator: { workspace: "", branch: "", baseline: "", head: "" },
    activeDispatch: { name: "", role: "", status: "none", pointer: "", session: "", assignment: "" },
    lastResult: { evidence: "", findings: "", scopeNote: "", cycles: 0, sameFindings: "unknown" },
    gates: {
      breakdown: "unknown",
      plan: "unknown",
      ui: "unknown",
      refinement: "unknown",
      childUnfinished: "unknown",
      eligibleChildState: "unknown",
      closeout: "unknown",
      integration: "unknown",
      allDescendantsImplemented: "unknown",
      review: "unknown",
      findingsOwner: "unknown",
      openFindings: "unknown",
      walkthrough: "unknown",
      judgedAtHead: "",
      queueHash: "",
    },
    writer: "none",
    sessionLive: "unknown",
    blocker: { kind: "none", owner: "", question: "", answer: "" },
    resume: "",
    judgmentAttempts: 0,
    readmePath: "",
  };
  return {
    ...base,
    ...partial,
    scope: { ...base.scope, ...partial.scope },
    coordinator: { ...base.coordinator, ...partial.coordinator },
    activeDispatch: { ...base.activeDispatch, ...partial.activeDispatch },
    lastResult: { ...base.lastResult, ...partial.lastResult },
    gates: { ...base.gates, ...partial.gates },
    blocker: { ...base.blocker, ...partial.blocker },
  };
}

interface CheckpointFile {
  version?: number;
  scope?: DeliveryState["scope"];
  stage?: Stage;
  coordinator?: DeliveryState["coordinator"];
  active_dispatch?: {
    name?: string;
    role?: string;
    status?: DispatchStatus;
    pointer?: string;
    session?: string;
    assignment?: string;
  };
  last_result?: {
    evidence?: string;
    findings?: string;
    scope_note?: string;
    cycles?: number;
    same_findings?: Tri;
  };
  gates?: {
    breakdown?: Tri;
    plan?: PlanApproval;
    ui?: Tri;
    refinement?: Tri;
    child_unfinished?: Tri;
    eligible_child_state?: string;
    closeout?: Tri;
    integration?: Tri;
    all_descendants_implemented?: Tri;
    review?: ReviewGate;
    findings_owner?: FindingOwner;
    open_findings?: Tri;
    walkthrough?: WalkthroughGate;
    judged_at_head?: string;
    queue_hash?: string;
  };
  writer?: WriterOwnership;
  session_live?: Tri;
  blocker?: DeliveryState["blocker"];
  resume?: string;
  judgment_attempts?: number;
}

export function serializeCheckpoint(state: DeliveryState): string {
  const body = stringify({
    version: 1,
    scope: state.scope,
    stage: state.stage,
    coordinator: state.coordinator,
    active_dispatch: {
      name: state.activeDispatch.name,
      role: state.activeDispatch.role,
      status: state.activeDispatch.status,
      pointer: state.activeDispatch.pointer,
      session: state.activeDispatch.session,
      assignment: state.activeDispatch.assignment,
    },
    last_result: {
      evidence: state.lastResult.evidence,
      findings: state.lastResult.findings,
      scope_note: state.lastResult.scopeNote,
      cycles: state.lastResult.cycles,
      same_findings: state.lastResult.sameFindings,
    },
    gates: {
      breakdown: state.gates.breakdown,
      plan: state.gates.plan,
      ui: state.gates.ui,
      refinement: state.gates.refinement,
      child_unfinished: state.gates.childUnfinished,
      eligible_child_state: state.gates.eligibleChildState,
      closeout: state.gates.closeout,
      integration: state.gates.integration,
      all_descendants_implemented: state.gates.allDescendantsImplemented,
      review: state.gates.review,
      findings_owner: state.gates.findingsOwner,
      open_findings: state.gates.openFindings,
      walkthrough: state.gates.walkthrough,
      judged_at_head: state.gates.judgedAtHead,
      queue_hash: state.gates.queueHash,
    },
    writer: state.writer,
    session_live: state.sessionLive,
    blocker: state.blocker,
    resume: state.resume,
    judgment_attempts: state.judgmentAttempts,
  }).trimEnd();
  const resume = state.resume || "Reconcile the graph and take the first matching edge.";
  return `${HEADING}\n\nResume: ${resume}\n\n\`\`\`yaml\n${body}\n\`\`\`\n`;
}

export function parseCheckpoint(section: string, readmePath = ""): DeliveryState | null {
  const fence = section.match(/```yaml\n([\s\S]*?)```/);
  if (!fence?.[1] || !/^version:\s*1\s*$/m.test(fence[1])) return null;
  const raw = parse(fence[1]) as CheckpointFile;
  const state = emptyState({ readmePath });
  state.scope = { ...state.scope, ...raw.scope };
  state.stage = raw.stage ?? "reconcile";
  state.coordinator = { ...state.coordinator, ...raw.coordinator };
  state.activeDispatch = {
    name: raw.active_dispatch?.name ?? "",
    role: raw.active_dispatch?.role ?? "",
    status: raw.active_dispatch?.status ?? "none",
    pointer: raw.active_dispatch?.pointer ?? "",
    session: raw.active_dispatch?.session ?? "",
    assignment: raw.active_dispatch?.assignment ?? "",
  };
  state.lastResult = {
    evidence: raw.last_result?.evidence ?? "",
    findings: raw.last_result?.findings ?? "",
    scopeNote: raw.last_result?.scope_note ?? "",
    cycles: raw.last_result?.cycles ?? 0,
    sameFindings: raw.last_result?.same_findings ?? "unknown",
  };
  state.gates = {
    ...state.gates,
    breakdown: raw.gates?.breakdown ?? "unknown",
    plan: raw.gates?.plan ?? "unknown",
    ui: raw.gates?.ui ?? "unknown",
    refinement: raw.gates?.refinement ?? "unknown",
    childUnfinished: raw.gates?.child_unfinished ?? "unknown",
    eligibleChildState: raw.gates?.eligible_child_state ?? "unknown",
    closeout: raw.gates?.closeout ?? "unknown",
    integration: raw.gates?.integration ?? "unknown",
    allDescendantsImplemented: raw.gates?.all_descendants_implemented ?? "unknown",
    review: raw.gates?.review ?? "unknown",
    findingsOwner: raw.gates?.findings_owner ?? "unknown",
    openFindings: raw.gates?.open_findings ?? "unknown",
    walkthrough: raw.gates?.walkthrough ?? "unknown",
    judgedAtHead: raw.gates?.judged_at_head ?? "",
    queueHash: raw.gates?.queue_hash ?? "",
  };
  state.writer = raw.writer ?? "none";
  state.sessionLive = raw.session_live ?? "unknown";
  state.blocker = { ...state.blocker, ...raw.blocker };
  state.resume = raw.resume ?? "";
  state.judgmentAttempts = raw.judgment_attempts ?? 0;
  state.readmePath = readmePath;
  return state;
}

export function readCheckpoint(readmePath: string): { markdown: string; state: DeliveryState | null; legacy: boolean } {
  const markdown = fs.readFileSync(readmePath, "utf8");
  const section = sectionBody(markdown);
  if (section === null) return { markdown, state: null, legacy: false };
  const state = parseCheckpoint(section, readmePath);
  return { markdown, state, legacy: state === null };
}

export function writeCheckpoint(readmePath: string, state: DeliveryState): void {
  const markdown = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf8") : "";
  const next = upsertSection(markdown, serializeCheckpoint(state));
  fs.writeFileSync(readmePath, next);
}

export function upsertSection(markdown: string, section: string): string {
  const start = markdown.indexOf(`\n${HEADING}`) >= 0 ? markdown.indexOf(`\n${HEADING}`) + 1 : markdown.startsWith(HEADING) ? 0 : -1;
  const block = section.endsWith("\n") ? section : `${section}\n`;
  if (start < 0) {
    const sep = markdown.endsWith("\n") || markdown.length === 0 ? "" : "\n";
    return `${markdown}${sep}\n${block}`;
  }
  const rest = markdown.slice(start + HEADING.length);
  const next = rest.search(/\n## /);
  const end = next < 0 ? markdown.length : start + HEADING.length + next + 1;
  return `${markdown.slice(0, start)}${block}${markdown.slice(end)}`;
}

function sectionBody(markdown: string): string | null {
  const start = markdown.indexOf(HEADING);
  if (start < 0) return null;
  const rest = markdown.slice(start + HEADING.length);
  const next = rest.search(/\n## /);
  return next < 0 ? markdown.slice(start) : markdown.slice(start, start + HEADING.length + next);
}
