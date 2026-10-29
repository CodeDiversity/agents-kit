import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { edgeOrderFromProse, loadSpec, resolveSpecPath } from "../src/spec.js";
import { neutralRecord, route } from "../src/router.js";
import type { GateRecord } from "../src/types.js";

const specPath = resolveSpecPath(path.resolve(import.meta.dirname, "../.."));
const markdown = fs.readFileSync(specPath, "utf8");
const spec = loadSpec(markdown);

test("prose edge order matches the YAML contract", () => {
  assert.deepEqual(edgeOrderFromProse(markdown), spec.edges.map((edge) => edge.id));
});

test("jira sync and the DoD auditor are not routable nodes", () => {
  assert.deepEqual(spec.non_nodes, ["jira-sync", "dod-auditor"]);
  const targets = new Set(spec.edges.map((edge) => edge.to));
  assert.equal(targets.has("jira-sync"), false);
  assert.equal(targets.has("dod-auditor"), false);
});

test("no edge fans out", () => {
  assert.equal(spec.edges.some((edge) => edge.parallel), false);
});

const cases: Array<{ edge: string; patch: Partial<GateRecord> }> = [
  { edge: "wait_live_session", patch: { writer_ownership: "held", session_live: true } },
  { edge: "writer_handoff", patch: { writer_ownership: "unknown", session_live: false } },
  { edge: "recorded_blocker", patch: { blocker_kind: "material_decision", blocker_answered: false } },
  { edge: "stagnation_unknown", patch: { retry_cycles: 2, same_findings: "unknown" } },
  { edge: "stagnation", patch: { retry_cycles: 2, same_findings: true } },
  { edge: "breakdown_unknown", patch: { breakdown_valid: "unknown" } },
  { edge: "breakdown_invalid", patch: { breakdown_valid: false } },
  { edge: "plan_unknown", patch: { plan_approval: "unknown" } },
  { edge: "plan_findings_open", patch: { plan_approval: "findings_open" } },
  { edge: "plan_not_ready", patch: { plan_approval: "missing" } },
  { edge: "planning_unknown", patch: { planning_satisfied: "unknown", breakdown_valid: true, plan_approval: "ready" } },
  { edge: "child_in_progress", patch: { eligible_child_state: "In progress" } },
  { edge: "child_unfinished_unknown", patch: { child_unfinished: "unknown", eligible_child_state: "none" } },
  { edge: "child_unfinished", patch: { child_unfinished: true, eligible_child_state: "Ready" } },
  { edge: "child_blocked", patch: { eligible_child_state: "Blocked", child_unfinished: false } },
  { edge: "ui_unknown", patch: { eligible_child_state: "Needs refinement", needs_ui_refinement: "unknown" } },
  { edge: "ui_needed", patch: { eligible_child_state: "Queued", needs_ui_refinement: true } },
  { edge: "tech_unknown", patch: { eligible_child_state: "Needs refinement", needs_ui_refinement: false, needs_technical_refinement: "unknown" } },
  { edge: "tech_needed", patch: { eligible_child_state: "Needs refinement", needs_ui_refinement: false, needs_technical_refinement: true } },
  { edge: "refinement_unresolved", patch: { eligible_child_state: "Needs refinement", needs_ui_refinement: false, needs_technical_refinement: false } },
  { edge: "child_ready", patch: { eligible_child_state: "Ready", all_descendants_implemented: false } },
  { edge: "descendants_unknown", patch: { eligible_child_state: "none", all_descendants_implemented: "unknown" } },
  { edge: "descendants_incomplete", patch: { eligible_child_state: "none", all_descendants_implemented: false } },
  { edge: "integration_unknown", patch: { integration_complete: "unknown" } },
  { edge: "integration_incomplete", patch: { integration_complete: false } },
  { edge: "findings_unknown", patch: { open_findings: "unknown" } },
  { edge: "findings_owner_unknown", patch: { open_findings: true, findings_owner: "unknown" } },
  { edge: "fix_planner", patch: { open_findings: true, findings_owner: "planner" } },
  { edge: "fix_implementer", patch: { open_findings: true, findings_owner: "implementer" } },
  { edge: "parent_review", patch: { review: "absent", open_findings: false } },
  { edge: "walkthrough_unknown", patch: { walkthrough: "unknown" } },
  { edge: "walkthrough_needed", patch: { walkthrough: "stale" } },
  { edge: "closeout_unknown", patch: { closeout_complete: "unknown" } },
  { edge: "closeout_incomplete", patch: { closeout_complete: false } },
  { edge: "complete", patch: {} },
  { edge: "unmatched", patch: { open_findings: true, findings_owner: "none" } },
];

for (const item of cases) {
  test(`edge ${item.edge}`, () => {
    const record = item.edge === "planning_unknown"
      ? { ...neutralRecord(), ...item.patch }
      : neutralRecord(item.patch);
    const decision = route(spec, record);
    assert.equal(decision.edge, item.edge);
    assert.equal(typeof decision.to, "string");
    assert.equal(decision.to.includes(","), false);
  });
}

test("spec non-edges hold", () => {
  for (const rule of spec.non_edges) {
    if (rule.id === "no_fanout") continue;
    const hints = rule.entry_hints ?? [String(rule.given?.entry_hint ?? "")];
    for (const hint of hints) {
      const record = neutralRecord({ ...(rule.given ?? {}), entry_hint: hint });
      const decision = route(spec, record);
      if (rule.expect) assert.equal(decision.to, rule.expect, rule.id);
      if (rule.interrupt) assert.equal(decision.interrupt, rule.interrupt, rule.id);
      for (const forbidden of rule.never ?? []) assert.notEqual(decision.to, forbidden, rule.id);
    }
  }
});
