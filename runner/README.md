# Delivery runner

Optional. In OpenCode, start with `/autopilot` in the target repo instead.

This CLI is the local LangGraph executor for `kit/.agents/workflow-graph.md`.
No LangGraph Cloud, no LangSmith, and no extra model key. Specialist sessions
use the OpenCode service that is already running and inherit its model and
permissions.

```bash
npm test
npm run lint-kit              # static integrity checks for kit/ + templates/ sources
./bin/agents-kit status --repo /path/to/repo --parent SP-1
./bin/agents-kit run --repo /path/to/repo --parent SP-1
./bin/agents-kit resume --repo /path/to/repo --answer "the decision"
./bin/agents-kit log --repo /path/to/repo --parent SP-1   # dispatch timeline from the run log
./bin/agents-kit watch --repo /path/to/repo --parent SP-1  # live status (Ctrl+C to stop)
./bin/agents-kit watch --repo /path/to/repo --parent SP-1 --once  # single snapshot
```

Limits (optional, defaults shown): `--recursion-limit 250`, `--max-judgment-attempts 2`,
`--log-limit 50`. The LangGraph thread state is persisted to
`.agents/runner/checkpoints.json` (file-backed checkpointer), so a crashed run
can resume; the README `## Autopilot` section remains the human checkpoint.

The target repo must already have the kit installed so role agents exist.
`status` does not dispatch. `run` writes only the README `## Autopilot`
checkpoint before and after each dispatch, plus coordinator-owned commits of
refiner and reviewer files named in the closeout. It does not approve OpenCode
permission prompts.

Codex and Vibe are refused. Use in-session autopilot there; it follows the same
spec. Do not launch this CLI from inside an agent session to get around host
permissions.
