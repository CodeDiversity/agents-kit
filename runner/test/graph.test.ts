import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeCheckpoint, emptyState } from "../src/checkpoint.js";
import { compileGraph, invokeGraph } from "../src/graph.js";
import { hashText, parseQueue } from "../src/reconcile.js";
import { readSpecFile, resolveSpecPath } from "../src/spec.js";
import type { HostAdapter } from "../src/hosts/types.js";

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

test("a verified passing parent completes without dispatching", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-kit-"));
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "kit@example.com"]);
  git(dir, ["config", "user.name", "kit"]);
  const home = path.join(dir, "docs", "stories", "EP", "SP-1");
  const artifacts = path.join(home, "artifacts");
  fs.mkdirSync(path.join(artifacts, "SP-1A"), { recursive: true });
  fs.mkdirSync(path.join(artifacts, "SP-1"), { recursive: true });
  fs.writeFileSync(path.join(home, "plan-review.md"), "Verdict: Plan Ready\n");
  fs.writeFileSync(path.join(artifacts, "SP-1", "review.md"), "Verdict: pass\n");
  fs.writeFileSync(path.join(artifacts, "SP-1", "walkthrough.md"), "Verified\n");
  fs.writeFileSync(path.join(artifacts, "SP-1", "implementation.md"), "index\n");
  fs.writeFileSync(path.join(artifacts, "SP-1A", "implementation.md"), "done\n");
  const readme = path.join(home, "README.md");
  const queue = [
    "**Artifact root:** docs/stories/EP/SP-1/artifacts",
    "",
    "## Execution queue",
    "",
    "| Story | State | Dependencies / blockers | Next action | Evidence / artifacts |",
    "| --- | --- | --- | --- | --- |",
    "| SP-1A | Reviewed | None | none | artifacts/SP-1A/implementation.md |",
    "",
  ].join("\n");
  fs.writeFileSync(readme, queue);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "story"]);
  const head = git(dir, ["rev-parse", "HEAD"]);
  const parsed = parseQueue(queue);
  const state = emptyState({
    readmePath: readme,
    scope: { parent: "SP-1", descendants: ["SP-1A"], entry: "", limits: "this parent" },
    coordinator: { workspace: dir, branch: "main", baseline: head, head },
    gates: {
      ...emptyState().gates,
      breakdown: true,
      plan: "ready",
      ui: false,
      refinement: false,
      childUnfinished: false,
      eligibleChildState: "none",
      closeout: true,
      integration: true,
      allDescendantsImplemented: true,
      review: "pass",
      findingsOwner: "none",
      openFindings: false,
      walkthrough: "verified",
      judgedAtHead: head,
      queueHash: hashText(parsed.hash ? parsed.rows.map((row) => `${row.story}|${row.state}|${row.dependencies}`).join("\n") : ""),
    },
  });
  state.gates.queueHash = parsed.hash;
  writeCheckpoint(readme, state);
  const host: HostAdapter = {
    id: "opencode",
    async dispatch() { throw new Error("dispatch should not run"); },
    async sessionLive() { return false; },
    async wait() { throw new Error("wait should not run"); },
  };
  const spec = readSpecFile(resolveSpecPath(dir));
  const compiled = compileGraph({ spec, host, repo: dir });
  const finalState = await invokeGraph(compiled, state, "complete-test");
  assert.equal(finalState.stage, "complete");
});

test("unknown writer ownership interrupts instead of starting another writer", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-kit-"));
  const home = path.join(dir, "docs", "stories", "EP", "SP-2");
  fs.mkdirSync(home, { recursive: true });
  const readme = path.join(home, "README.md");
  fs.writeFileSync(readme, "## Execution queue\n\n| Story | State |\n| --- | --- |\n| SP-2A | Ready |\n");
  const state = emptyState({
    readmePath: readme,
    scope: { parent: "SP-2", descendants: ["SP-2A"], entry: "", limits: "this parent" },
    writer: "unknown",
    activeDispatch: { name: "old", role: "implementer", status: "running", pointer: "", session: "ses_old", assignment: "complete_child" },
  });
  writeCheckpoint(readme, state);
  const spec = readSpecFile(resolveSpecPath(dir));
  const compiled = compileGraph({
    spec,
    repo: dir,
    host: {
      id: "opencode",
      async dispatch() { throw new Error("must not dispatch"); },
      async sessionLive() { return false; },
      async wait() { throw new Error("must not wait"); },
    },
  });
  const finalState = await invokeGraph(compiled, state, "handoff-test");
  assert.equal(finalState.stage, "blocked");
  assert.equal(finalState.blocker.kind, "handoff");
});
