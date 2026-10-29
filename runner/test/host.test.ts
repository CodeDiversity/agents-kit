import assert from "node:assert/strict";
import test from "node:test";
import { OpenCodeHost, type OpenCodeSessionClient } from "../src/hosts/opencode.js";
import { allowedCommitPath } from "../src/git.js";

test("a pending permission is surfaced and never approved", async () => {
  let replied = false;
  const client: OpenCodeSessionClient = {
    session: {
      async create() { return { id: "ses_test" }; },
      async active() { return {}; },
      async get() { return { id: "ses_test", time: { idle: 1 } }; },
      async prompt() { return undefined; },
      form: { async list() { return []; } },
    },
    experimental: { session: { async wait() { return undefined; } } },
    message: { async list() { return { data: [] }; } },
    permission: {
      async list() {
        replied = false;
        return [{ id: "perm_1", action: "shell", resources: ["git push"] }];
      },
    },
    agent: { async list() { return { data: [{ id: "implementer", name: "implementer" }] }; } },
  };
  const host = new OpenCodeHost(client, 1000, 1);
  const result = await host.dispatch({
    role: "implementer",
    taskName: "implementer-one",
    handoff: "do the child",
    workspace: "/tmp/workspace",
    readOnly: false,
  });
  assert.equal(replied, false);
  assert.equal(result.paused?.kind, "missing_permission");
  assert.match(result.paused?.question ?? "", /will not approve/);
});

test("coordinator commit allowlist excludes secrets and application code", () => {
  assert.equal(allowedCommitPath("reviewer", "docs/stories/EP/SP-1/artifacts/SP-1/review.md"), true);
  assert.equal(allowedCommitPath("refiner", "docs/stories/EP/SP-1/SP-1A.md"), true);
  assert.equal(allowedCommitPath("refiner", "docs/stories/EP/SP-1/README.md"), false);
  assert.equal(allowedCommitPath("reviewer", ".env"), false);
  assert.equal(allowedCommitPath("implementer", "src/app.ts"), false);
  assert.equal(allowedCommitPath("reviewer", "docs/stories/../../.env"), false);
});
