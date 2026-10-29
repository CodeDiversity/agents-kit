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

export function pathsFromCloseout(text: string): string[] {
  return [...text.matchAll(/(?:^|[\s`])((?:docs|kit)\/[A-Za-z0-9_./-]+\.md)/g)].map((match) => match[1] ?? "");
}
