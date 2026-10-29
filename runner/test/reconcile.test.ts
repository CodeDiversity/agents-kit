import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dependenciesMet, parseQueue, selectEligible } from "../src/reconcile.js";
import type { QueueRow } from "../src/types.js";

function row(story: string, state: string, dependencies = "None"): QueueRow {
  return { story, state, dependencies, nextAction: "", evidence: "" };
}

test("parses the execution queue and ignores other tables", () => {
  const markdown = [
    "| Story | State | Dependencies / blockers | Next action | Evidence / artifacts |",
    "| --- | --- | --- | --- | --- |",
    "| OTHER | Ready | None | no | |",
    "",
    "## Execution queue",
    "",
    "| Story | State | Dependencies / blockers | Next action | Evidence / artifacts |",
    "| --- | --- | --- | --- | --- |",
    "| SP-1A | Implemented - awaiting parent review | None | review | |",
    "| SP-1B | Needs refinement | SP-1A | refine | |",
  ].join("\n");
  const queue = parseQueue(markdown);
  assert.deepEqual(queue.rows.map((item) => item.story), ["SP-1A", "SP-1B"]);
  assert.equal(queue.rows[0]?.state, "Implemented — awaiting parent review");
});

test("does not select an implemented child for refinement", () => {
  const rows = [
    row("SP-1A", "Implemented — awaiting parent review"),
    row("SP-1B", "Ready", "SP-1A"),
  ];
  assert.equal(dependenciesMet(rows[1]!, rows), true);
  const selected = selectEligible(rows);
  assert.equal(selected !== "unknown" && selected ? selected.story : "", "SP-1B");
  assert.equal(selectEligible([row("SP-1A", "Implemented — awaiting parent review")]), null);
});

test("does not skip a blocked dependency for a later child", () => {
  const rows = [
    row("SP-1A", "Blocked"),
    row("SP-1B", "Ready", "SP-1A"),
  ];
  const selected = selectEligible(rows);
  assert.equal(selected !== "unknown" && selected ? selected.story : "", "SP-1A");
});

test("can continue an independent later child while another is blocked", () => {
  const rows = [
    row("SP-1A", "Blocked"),
    row("SP-1B", "Ready", "None"),
  ];
  const selected = selectEligible(rows);
  assert.equal(selected !== "unknown" && selected ? selected.story : "", "SP-1B");
});

test("missing plan review is a mechanical missing approval", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-kit-"));
  const home = path.join(dir, "docs", "stories", "EP", "SP-9");
  fs.mkdirSync(home, { recursive: true });
  const readme = path.join(home, "README.md");
  fs.writeFileSync(readme, [
    "**Artifact root:** docs/stories/EP/SP-9/artifacts",
    "",
    "## Execution queue",
    "",
    "| Story | State | Dependencies / blockers | Next action | Evidence / artifacts |",
    "| --- | --- | --- | --- | --- |",
    "| SP-9A | Ready | None | implement | |",
  ].join("\n"));
  const { reconcile } = await import("../src/reconcile.js");
  const state = await reconcile({ repo: dir, readmePath: readme, sessionLive: false });
  assert.equal(state.gates.plan, "missing");
  assert.equal(state.gates.review, "absent");
  assert.equal(state.gates.walkthrough, "missing");
  assert.equal(state.gates.eligibleChildState, "Ready");
  assert.equal(state.scope.parent, "SP-9");
});
