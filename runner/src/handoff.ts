import type { DeliveryState } from "./types.js";
import type { SpecNode } from "./spec.js";

export function buildHandoff(state: DeliveryState, node: SpecNode, assignment: string): string {
  const role = node.role || node.id;
  const story = state.gates.eligibleChildState === "none" ? state.scope.parent : state.scope.descendants.join(", ");
  const answer = state.blocker.answer.trim();
  return [
    `Role / task / write boundary: ${role}; ${assignment || node.id}; one bounded assignment; return before the next task.`,
    `Authorization: parent ${state.scope.parent}; descendants ${state.scope.descendants.join(", ") || "see queue"}; limits ${state.scope.limits}. Entry hint is not permission to skip prerequisites.`,
    `Read first: AGENTS.md, .agents/workflow-graph.md, the ${role} role definition and skill, ${state.readmePath}`,
    `Inputs: ${story}; checkpoint or review pointer ${state.activeDispatch.pointer || "queue"}; relevant contracts and Definition of Done.`,
    `Repository: ${state.coordinator.workspace}; branch ${state.coordinator.branch}; baseline ${state.coordinator.baseline}; HEAD ${state.coordinator.head}.`,
    answer ? `Settled answer: ${answer}` : "Settled answer: none.",
    node.read_only
      ? "Write nothing. Do not save a report, edit the queue, or approve a gate. Return one JSON object and no other prose."
      : "Preserve unrelated work. Never read or write secret files. Do not dispatch another agent.",
    "Return:",
    "Status:",
    "Records:",
    "Commits:",
    "Verification:",
    "Remaining:",
  ].join("\n");
}

export function judgePrompt(state: DeliveryState, unknown: string[]): string {
  return [
    "You are a read-only delivery reconciler. Write nothing. Do not approve a gate.",
    `Parent: ${state.scope.parent}`,
    `README: ${state.readmePath}`,
    `Workspace: ${state.coordinator.workspace}`,
    `HEAD: ${state.coordinator.head}`,
    `Unknown gates: ${unknown.join(", ")}`,
    "Read the execution queue, plan-review.md, checkpoints, implementation records, review.md, and walkthrough.md only as needed.",
    "Missing files are unverified, not done. An implemented child never needs refinement.",
    "Return only this JSON object, with no markdown fence:",
    JSON.stringify({
      breakdown_valid: "unknown",
      plan_approval: "unknown",
      needs_ui_refinement: "unknown",
      needs_technical_refinement: "unknown",
      child_unfinished: "unknown",
      closeout_complete: "unknown",
      integration_complete: "unknown",
      all_descendants_implemented: "unknown",
      open_findings: "unknown",
      findings_owner: "unknown",
      review: "unknown",
      walkthrough: "unknown",
      same_findings: "unknown",
      blocker_kind: "none",
      blocker_question: "",
      evidence: [],
    }, null, 2),
    "Use true or false for boolean gates. plan_approval is missing, findings_open, findings_awaiting_rereview, stale, ready, or unknown.",
    "review is absent, stale, fail, pass, or unknown. walkthrough is missing, stale, verified, or unknown.",
    "findings_owner is implementer, planner, none, or unknown. blocker_kind is none, material_decision, or human_evidence.",
    "evidence must be a non-empty array of \"file:line\" citations for every gate you set.",
    "Do not contradict a missing file. If plan-review.md is absent, plan_approval is missing.",
  ].join("\n");
}
