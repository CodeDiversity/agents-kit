import type { DeliveryState, SpecialistReturn } from "./types.js";

const FIELDS = ["Status", "Records", "Commits", "Verification", "Remaining"] as const;

export function parseCloseout(raw: string, sessionId = ""): SpecialistReturn {
  const result: SpecialistReturn = {
    status: "",
    records: "",
    commits: "",
    verification: "",
    remaining: "",
    raw,
    sessionId,
  };
  for (const field of FIELDS) {
    const match = raw.match(new RegExp(`^${field}:\\s*(.*)$`, "im"));
    const key = field.toLowerCase() as "status" | "records" | "commits" | "verification" | "remaining";
    result[key] = match?.[1]?.trim() ?? "";
  }
  if (!result.status) result.status = "unverified";
  return result;
}

export function parseJudge(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const body = fenced ?? (start >= 0 && end > start ? raw.slice(start, end + 1) : "");
  if (!body) return null;
  try {
    const value = JSON.parse(body) as unknown;
    return value && typeof value === "object" ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function applyJudgment(state: DeliveryState, judged: Record<string, unknown>): DeliveryState {
  const next: DeliveryState = structuredClone(state);
  const gates = next.gates;
  setTri(judged.breakdown_valid, (value) => { if (gates.breakdown === "unknown") gates.breakdown = value; });
  if (gates.plan === "unknown" && typeof judged.plan_approval === "string") {
    gates.plan = judged.plan_approval as DeliveryState["gates"]["plan"];
  }
  setTri(judged.needs_ui_refinement, (value) => { if (gates.ui === "unknown") gates.ui = value; });
  setTri(judged.needs_technical_refinement, (value) => { if (gates.refinement === "unknown") gates.refinement = value; });
  setTri(judged.child_unfinished, (value) => { if (gates.childUnfinished === "unknown") gates.childUnfinished = value; });
  setTri(judged.closeout_complete, (value) => { if (gates.closeout === "unknown") gates.closeout = value; });
  setTri(judged.integration_complete, (value) => { if (gates.integration === "unknown") gates.integration = value; });
  setTri(judged.all_descendants_implemented, (value) => {
    if (gates.allDescendantsImplemented === "unknown") gates.allDescendantsImplemented = value;
  });
  setTri(judged.open_findings, (value) => { if (gates.openFindings === "unknown") gates.openFindings = value; });
  if (gates.findingsOwner === "unknown" && typeof judged.findings_owner === "string") {
    gates.findingsOwner = judged.findings_owner as DeliveryState["gates"]["findingsOwner"];
  }
  if (gates.review === "unknown" && typeof judged.review === "string") {
    gates.review = judged.review as DeliveryState["gates"]["review"];
  }
  if (gates.walkthrough === "unknown" && typeof judged.walkthrough === "string") {
    gates.walkthrough = judged.walkthrough as DeliveryState["gates"]["walkthrough"];
  }
  if (next.lastResult.sameFindings === "unknown") {
    setTri(judged.same_findings, (value) => { next.lastResult.sameFindings = value; });
  }
  if (typeof judged.blocker_kind === "string" && judged.blocker_kind !== "none" && next.blocker.kind === "none") {
    next.blocker = {
      kind: judged.blocker_kind,
      owner: "user",
      question: typeof judged.blocker_question === "string" ? judged.blocker_question : "A material decision is unanswered.",
      answer: "",
    };
  }
  next.gates.judgedAtHead = next.coordinator.head;
  return next;
}

function setTri(value: unknown, write: (value: boolean) => void): void {
  if (value === true || value === false) write(value);
}

const PLAN_APPROVAL = new Set(["missing", "findings_open", "findings_awaiting_rereview", "stale", "ready", "unknown"]);
const FINDING_OWNER = new Set(["implementer", "planner", "none", "unknown"]);
const REVIEW_GATE = new Set(["absent", "stale", "fail", "pass", "unknown"]);
const WALKTHROUGH = new Set(["missing", "stale", "verified", "unknown"]);

export function validateJudge(judged: Record<string, unknown>, _unknowns: string[]): { ok: boolean; reason: string } {
  const triKeys = ["breakdown_valid", "needs_ui_refinement", "needs_technical_refinement", "child_unfinished", "closeout_complete", "integration_complete", "all_descendants_implemented", "open_findings", "same_findings"];
  for (const key of triKeys) {
    if (key in judged) {
      const value = judged[key];
      if (typeof value !== "boolean" && value !== "unknown") {
        return { ok: false, reason: `judge field ${key} must be boolean or "unknown", got ${JSON.stringify(value)}` };
      }
    }
  }
  if ("plan_approval" in judged && typeof judged.plan_approval === "string" && !PLAN_APPROVAL.has(judged.plan_approval)) {
    return { ok: false, reason: `judge field plan_approval has invalid value ${JSON.stringify(judged.plan_approval)}` };
  }
  if ("plan_approval" in judged && typeof judged.plan_approval !== "string" && judged.plan_approval !== undefined) {
    return { ok: false, reason: `judge field plan_approval must be a string` };
  }
  if ("findings_owner" in judged && typeof judged.findings_owner === "string" && !FINDING_OWNER.has(judged.findings_owner)) {
    return { ok: false, reason: `judge field findings_owner has invalid value ${JSON.stringify(judged.findings_owner)}` };
  }
  if ("findings_owner" in judged && typeof judged.findings_owner !== "string" && judged.findings_owner !== undefined) {
    return { ok: false, reason: `judge field findings_owner must be a string` };
  }
  if ("review" in judged && typeof judged.review === "string" && !REVIEW_GATE.has(judged.review)) {
    return { ok: false, reason: `judge field review has invalid value ${JSON.stringify(judged.review)}` };
  }
  if ("review" in judged && typeof judged.review !== "string" && judged.review !== undefined) {
    return { ok: false, reason: `judge field review must be a string` };
  }
  if ("walkthrough" in judged && typeof judged.walkthrough === "string" && !WALKTHROUGH.has(judged.walkthrough)) {
    return { ok: false, reason: `judge field walkthrough has invalid value ${JSON.stringify(judged.walkthrough)}` };
  }
  if ("walkthrough" in judged && typeof judged.walkthrough !== "string" && judged.walkthrough !== undefined) {
    return { ok: false, reason: `judge field walkthrough must be a string` };
  }
  if ("blocker_kind" in judged && typeof judged.blocker_kind !== "string") {
    return { ok: false, reason: `judge field blocker_kind must be a string` };
  }
  if ("blocker_question" in judged && typeof judged.blocker_question !== "string") {
    return { ok: false, reason: `judge field blocker_question must be a string` };
  }
  // evidence: required, non-empty array of non-empty strings (file:line citations)
  if (!Array.isArray(judged.evidence)) {
    return { ok: false, reason: "judge verdict must include an evidence array of file:line citations" };
  }
  if (judged.evidence.length === 0) {
    return { ok: false, reason: "judge verdict evidence array must not be empty" };
  }
  if (!judged.evidence.every((item) => typeof item === "string" && item.trim().length > 0)) {
    return { ok: false, reason: "judge verdict evidence entries must be non-empty strings" };
  }
  return { ok: true, reason: "" };
}

export function pathsFromCloseout(text: string): string[] {
  return [...text.matchAll(/(?:^|[\s`])((?:docs|kit)\/[A-Za-z0-9_./-]+\.md)/g)].map((match) => match[1] ?? "");
}
