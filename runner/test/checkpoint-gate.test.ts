import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { checkpointAllows, findAllowingReadme } from "../../kit/.opencode/plugins/delivery-graph/check.js"

const checkpoint = `# Parent

## Execution queue

keep

## Autopilot

Resume: plan EP10.

\`\`\`yaml
version: 1
active_dispatch:
  role: planner
  status: pending
  name: planner-ep10
\`\`\`

## Notes

stay
`

test("a prose autopilot section does not allow dispatch", () => {
  const prose = "## Autopilot\n\n- **Active dispatch:** None\n"
  assert.equal(checkpointAllows(prose, "planner"), false)
})

test("pending checkpoint allows only the recorded role", () => {
  assert.equal(checkpointAllows(checkpoint, "planner"), true)
  assert.equal(checkpointAllows(checkpoint, "dod-auditor"), false)
  const running = checkpoint.replace("status: pending", "status: returned")
  assert.equal(checkpointAllows(running, "planner"), false)
})

test("finds the allowing README and ignores the queue", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-kit-"))
  const home = path.join(root, "docs", "stories", "EP10")
  fs.mkdirSync(home, { recursive: true })
  fs.writeFileSync(path.join(home, "README.md"), checkpoint)
  assert.equal(findAllowingReadme(root, "planner"), path.join(home, "README.md"))
  assert.equal(findAllowingReadme(root, "reviewer"), null)
})
