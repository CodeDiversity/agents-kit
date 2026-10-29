import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { emptyState, parseCheckpoint, serializeCheckpoint, upsertSection, writeCheckpoint } from "../src/checkpoint.js";

test("checkpoint round-trips and leaves the queue alone", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-kit-"));
  const readme = path.join(dir, "README.md");
  const queue = [
    "# Parent",
    "",
    "## Execution queue",
    "",
    "| Story | State | Dependencies / blockers | Next action | Evidence / artifacts |",
    "| --- | --- | --- | --- | --- |",
    "| SP-1A | Ready | None | implement | |",
    "",
  ].join("\n");
  fs.writeFileSync(readme, queue);
  const state = emptyState({
    readmePath: readme,
    scope: { parent: "SP-1", descendants: ["SP-1A"], entry: "implement SP-1A", limits: "this parent only" },
    stage: "implement",
    lastResult: { evidence: "artifacts/SP-1A/implementation.md", findings: "none", scopeNote: "partial", cycles: 1, sameFindings: false },
    gates: { ...emptyState().gates, breakdown: true, plan: "ready", eligibleChildState: "Ready" },
    resume: "Implement SP-1A.",
  });
  writeCheckpoint(readme, state);
  const saved = fs.readFileSync(readme, "utf8");
  assert.match(saved, /\| SP-1A \| Ready \|/);
  assert.equal(saved.indexOf("## Execution queue") < saved.indexOf("## Autopilot"), true);
  const parsed = parseCheckpoint(saved.slice(saved.indexOf("## Autopilot")), readme);
  assert.equal(parsed?.scope.parent, "SP-1");
  assert.equal(parsed?.scope.entry, "implement SP-1A");
  assert.equal(parsed?.gates.plan, "ready");
  assert.equal(parsed?.lastResult.cycles, 1);
  assert.equal(parsed?.resume, "Implement SP-1A.");
});

test("upsert replaces only the Autopilot section", () => {
  const original = "# Doc\n\n## Execution queue\n\nkeep\n\n## Autopilot\n\nold\n\n## Notes\n\nstay\n";
  const next = upsertSection(original, "## Autopilot\n\nResume: next\n\n```yaml\nversion: 1\n```\n");
  assert.match(next, /keep/);
  assert.match(next, /## Notes\n\nstay/);
  assert.doesNotMatch(next, /old/);
  assert.match(serializeCheckpoint(emptyState()), /version: 1/);
});
