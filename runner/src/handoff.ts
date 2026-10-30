import fs from "node:fs";
import path from "node:path";
import type { DeliveryState } from "./types.js";
import type { SpecNode } from "./spec.js";

// Map: assignment -> list of (skill dir name, section headings to inline).
// Only the listed sections are inlined into the handoff; the rest of the
// skill is skipped unless the specialist finds the handoff ambiguous.
const SECTION_MAP: Record<string, Array<[string, string[]]>> = {
  plan_correction: [["planner", ["Graph node", "Planning workflow", "Planning validation", "Plan-review handoff and replanning"]]],
  plan_review: [["reviewer", ["Graph node", "Plan review (before implementation)", "Severity and verdict contract"]]],
  ui_refine: [["ui-refiner", ["Graph node"]]],
  technical_refine: [["refiner", ["Graph node", "Security rules", "Framework note"]]],
  complete_child: [["implementer", ["Graph node", "Implementation loop", "Required findings record and committed closeout", "Security"]], ["backend", ["Technical requirements", "Security rules"]], ["frontend", ["Technical requirements", "Security rules"]]],
  resume_checkpoint: [["implementer", ["Graph node", "Implementation loop"]]],
  integration: [["implementer", ["Graph node", "Implementation loop", "Required findings record and committed closeout"]], ["backend", ["Technical requirements"]], ["frontend", ["Technical requirements"]]],
  parent_review: [["reviewer", ["Graph node", "Implementation review (completed work)", "Severity and verdict contract", "Final user walkthrough"]]],
  walkthrough: [["reviewer", ["Graph node", "Final user walkthrough", "Severity and verdict contract"]]],
  fix: [["implementer", ["Graph node", "Implementation loop", "Required findings record and committed closeout"]]],
  closeout: [["implementer", ["Graph node", "Required findings record and committed closeout"]]],
};

function findSkillFile(workspace: string, skillDir: string): string | null {
  const candidates = [
    path.join(workspace, ".agents", "skills", skillDir, "SKILL.md"),
    path.join(workspace, "kit", ".agents", "skills", skillDir, "SKILL.md"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function extractSections(workspace: string, skillDir: string, headings: string[]): string {
  const file = findSkillFile(workspace, skillDir);
  if (!file) return "";
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const out: string[] = [];
  for (const heading of headings) {
    const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
    if (start < 0) continue;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) { end = i; break; }
    }
    out.push(`### ${heading}`);
    out.push(lines.slice(start + 1, end).join("\n").trim());
    out.push("");
  }
  return out.join("\n").trim();
}

function inlinedSkills(workspace: string, assignment: string): string {
  const map = SECTION_MAP[assignment];
  if (!map) return "";
  const blocks: string[] = [];
  for (const [skill, headings] of map) {
    const content = extractSections(workspace, skill, headings);
    if (content) blocks.push(`[${skill}]\n${content}`);
  }
  return blocks.join("\n\n");
}

function compactGates(state: DeliveryState): string {
  const g = state.gates;
  const parts: string[] = [];
  if (g.breakdown !== "unknown") parts.push(`breakdown=${g.breakdown}`);
  if (g.plan !== "unknown") parts.push(`plan=${g.plan}`);
  if (g.ui !== "unknown") parts.push(`ui=${g.ui}`);
  if (g.refinement !== "unknown") parts.push(`refinement=${g.refinement}`);
  if (g.childUnfinished !== "unknown") parts.push(`childUnfinished=${g.childUnfinished}`);
  if (g.eligibleChildState !== "unknown" && g.eligibleChildState !== "none") parts.push(`eligible=${g.eligibleChildState}`);
  if (g.closeout !== "unknown") parts.push(`closeout=${g.closeout}`);
  if (g.integration !== "unknown") parts.push(`integration=${g.integration}`);
  if (g.allDescendantsImplemented !== "unknown") parts.push(`allDescendants=${g.allDescendantsImplemented}`);
  if (g.review !== "unknown") parts.push(`review=${g.review}`);
  if (g.findingsOwner !== "unknown" && g.findingsOwner !== "none") parts.push(`findingsOwner=${g.findingsOwner}`);
  if (g.openFindings !== "unknown") parts.push(`openFindings=${g.openFindings}`);
  if (g.walkthrough !== "unknown") parts.push(`walkthrough=${g.walkthrough}`);
  return parts.length ? parts.join(", ") : "all unknown";
}

export function buildHandoff(state: DeliveryState, node: SpecNode, assignment: string): string {
  const role = node.role || node.id;
  const lines: string[] = [];
  lines.push(`Role/task: ${role} / ${assignment || node.id}. One bounded assignment; return before the next task.`);
  lines.push(`Read first: AGENTS.md, .agents/workflow-graph.md, ${state.readmePath}`);
  const story = state.gates.eligibleChildState === "none" ? state.scope.parent : state.scope.descendants.join(", ");
  lines.push(`Scope: ${state.scope.parent} (${state.scope.limits}); active child ${story}; entry ${state.scope.entry || "select from queue"}.`);
  lines.push(`Repo: ${state.coordinator.workspace}; branch ${state.coordinator.branch}; baseline ${state.coordinator.baseline}; HEAD ${state.coordinator.head}.`);
  if (state.blocker.answer.trim()) lines.push(`Settled answer: ${state.blocker.answer.trim()}.`);
  if (state.lastResult.findings.trim()) lines.push(`Findings to fix: ${state.lastResult.findings.trim()}.`);
  if (state.lastResult.evidence.trim() && state.lastResult.evidence.trim() !== "none") lines.push(`Evidence: ${state.lastResult.evidence.trim()}.`);
  const gates = compactGates(state);
  if (gates !== "all unknown") lines.push(`Gates: ${gates}.`);
  lines.push(`Eligible child state: ${state.gates.eligibleChildState}.`);
  lines.push(node.read_only
    ? "Write nothing. Return one JSON object and no other prose."
    : "Preserve unrelated work. Never read/write secrets. Do not dispatch another agent.");
  const skillContent = inlinedSkills(state.coordinator.workspace, assignment);
  if (skillContent) {
    lines.push("");
    lines.push("Skill guidance (relevant sections only — do not re-read the full skill unless ambiguous):");
    lines.push(skillContent);
  }
  lines.push("Return: Status, Records, Commits, Verification, Remaining.");
  return lines.join("\n");
}

export function judgePrompt(state: DeliveryState, unknown: string[]): string {
  const template: Record<string, unknown> = { evidence: [] };
  for (const key of unknown) {
    if (key === "breakdown_valid") template.breakdown_valid = "unknown";
    else if (key === "plan_approval") template.plan_approval = "unknown";
    else if (key === "needs_ui_refinement") template.needs_ui_refinement = "unknown";
    else if (key === "needs_technical_refinement") template.needs_technical_refinement = "unknown";
    else if (key === "child_unfinished") template.child_unfinished = "unknown";
    else if (key === "closeout_complete") template.closeout_complete = "unknown";
    else if (key === "integration_complete") template.integration_complete = "unknown";
    else if (key === "all_descendants_implemented") template.all_descendants_implemented = "unknown";
    else if (key === "open_findings") template.open_findings = "unknown";
    else if (key === "findings_owner") template.findings_owner = "unknown";
    else if (key === "review") template.review = "unknown";
    else if (key === "walkthrough") template.walkthrough = "unknown";
    else if (key === "same_findings") template.same_findings = "unknown";
  }
  template.blocker_kind = "none";
  template.blocker_question = "";
  return [
    "Read-only reconciler. Write nothing. Do not approve a gate.",
    `Parent: ${state.scope.parent}  README: ${state.readmePath}  HEAD: ${state.coordinator.head}`,
    `Unknown: ${unknown.join(", ")}`,
    "Read queue, plan-review.md, checkpoints, records, review.md, walkthrough.md as needed. Missing files are unverified, not done.",
    "Return only this JSON object, no fence:",
    JSON.stringify(template, null, 2),
    "Use true/false for booleans. plan_approval: missing|findings_open|findings_awaiting_rereview|stale|ready|unknown.",
    "review: absent|stale|fail|pass|unknown. walkthrough: missing|stale|verified|unknown.",
    "findings_owner: implementer|planner|none|unknown. blocker_kind: none|material_decision|human_evidence.",
    "evidence: non-empty array of \"file:line\" citations for every gate set.",
    "Do not contradict a missing file. If plan-review.md is absent, plan_approval is missing.",
  ].join("\n");
}