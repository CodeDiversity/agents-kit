export type Tri = boolean | "unknown";

export type PlanApproval =
  | "missing"
  | "findings_open"
  | "findings_awaiting_rereview"
  | "stale"
  | "ready"
  | "unknown";

export type ReviewGate = "absent" | "stale" | "fail" | "pass" | "unknown";
export type WalkthroughGate = "missing" | "stale" | "verified" | "unknown";
export type WriterOwnership = "none" | "held" | "unknown";
export type FindingOwner = "implementer" | "planner" | "none" | "unknown";
export type DispatchStatus = "none" | "pending" | "running" | "returned" | "not_started";

export type Stage =
  | "reconcile"
  | "plan"
  | "plan_review"
  | "ui_refine"
  | "refine"
  | "implement"
  | "integration"
  | "parent_review"
  | "fix"
  | "walkthrough"
  | "blocked"
  | "complete";

export interface Gates {
  breakdown: Tri;
  plan: PlanApproval;
  ui: Tri;
  refinement: Tri;
  childUnfinished: Tri;
  eligibleChildState: string;
  closeout: Tri;
  integration: Tri;
  allDescendantsImplemented: Tri;
  review: ReviewGate;
  findingsOwner: FindingOwner;
  openFindings: Tri;
  walkthrough: WalkthroughGate;
  judgedAtHead: string;
  queueHash: string;
}

export interface DeliveryState {
  scope: {
    parent: string;
    descendants: string[];
    entry: string;
    limits: string;
  };
  stage: Stage;
  coordinator: {
    workspace: string;
    branch: string;
    baseline: string;
    head: string;
  };
  activeDispatch: {
    name: string;
    role: string;
    status: DispatchStatus;
    pointer: string;
    session: string;
    assignment: string;
  };
  lastResult: {
    evidence: string;
    findings: string;
    scopeNote: string;
    cycles: number;
    sameFindings: Tri;
  };
  gates: Gates;
  writer: WriterOwnership;
  sessionLive: Tri;
  blocker: {
    kind: string;
    owner: string;
    question: string;
    answer: string;
  };
  resume: string;
  judgmentAttempts: number;
  malformedJudgmentAttempts: number;
  readmePath: string;
}

export interface GateRecord {
  writer_ownership: WriterOwnership;
  session_live: Tri;
  breakdown_valid: Tri;
  plan_approval: PlanApproval;
  planning_satisfied: Tri;
  child_unfinished: Tri;
  needs_ui_refinement: Tri;
  needs_technical_refinement: Tri;
  eligible_child_state: string;
  closeout_complete: Tri;
  all_descendants_implemented: Tri;
  integration_complete: Tri;
  open_findings: Tri;
  findings_owner: FindingOwner;
  review: ReviewGate;
  walkthrough: WalkthroughGate;
  retry_cycles: number;
  same_findings: Tri;
  blocker_kind: string;
  blocker_answered: boolean;
  entry_hint: string;
  judgment_attempts: number;
}

export interface QueueRow {
  story: string;
  state: string;
  dependencies: string;
  nextAction: string;
  evidence: string;
}

export interface SpecialistReturn {
  status: string;
  records: string;
  commits: string;
  verification: string;
  remaining: string;
  raw: string;
  sessionId: string;
  paused?: { kind: string; question: string };
}

export interface RouteResult {
  edge: string;
  to: string;
  assignment: string;
  stage: Stage;
  interrupt?: string;
  question: string;
}
