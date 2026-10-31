# Building and extending delivery graphs

This guide is for maintainers who want to change the graph, add a specialist
role, add a host adapter, or build a new graph from scratch. It is not a
tutorial for running a delivery. For that, see
[autopilot-walkthrough.md](autopilot-walkthrough.md).

The only router is `.agents/workflow-graph.md`. The runner reads it. The
in-session autopilot agent reads it. The OpenCode plugin reads it. None of them
may add an edge that is not listed in it. If you want new behavior, add it to
the spec first.

## Anatomy of the spec

`kit/.agents/workflow-graph.md` has these sections.

### Prose: the edge table

A Markdown table under `## Edge order`. Columns: Edge, When, Next. This is
documentation for humans. A test (`prose edge order matches the YAML contract`)
fails if the edge IDs here do not match the YAML fence in the same order.

### YAML fence: the machine contract

The second fenced code block, tagged `yaml`, contains:

- `version` — must be `1`.
- `scope` — `parent_review_unit` or similar.
- `checkpoint` — `readme_autopilot_section`.
- `queue` — `readme_execution_queue`.
- `non_nodes` — roles that are not graph nodes (jira-sync, dod-auditor).
- `nodes` — list of node definitions.
- `edges` — ordered list of conditional edges.
- `interrupts` — list of interrupt IDs.
- `non_edges` — assertions about what must never happen.

### Node definition

```yaml
- id: planner
  role: planner
  fresh_context: true
  commit: specialist
  writes: ["docs/**"]
```

Fields:

- `id` — unique node name. Used as the LangGraph node ID and the target of edges.
- `role` — the agent/skill role. The runner uses this as the OpenCode agent name.
- `fresh_context` — whether each dispatch needs a new isolated session.
- `commit` — `none`, `specialist` (the node commits its own work), or `coordinator` (the runner commits files named in the closeout).
- `read_only` — if true, the node writes nothing. Used by `judge`.
- `interrupt` — if set, this node stops the run instead of dispatching.
- `writes` — list of paths the role may write. Documentation only; not enforced by code.

### Edge definition

```yaml
- id: breakdown_invalid
  when: { field: breakdown_valid, eq: false }
  to: planner
  assignment: plan_correction
  stage: plan
```

Fields:

- `id` — unique edge name.
- `when` — a predicate. See below.
- `to` — target node ID.
- `assignment` — passed to the specialist as its task type.
- `stage` — the delivery stage to record.
- `interrupt` — if set, this edge triggers a stop instead of dispatch.
- `question` — the question to ask when interrupted.
- `parallel` — must not be set. Fan-out is forbidden.

### Predicate syntax

```yaml
# Exact match
when: { field: breakdown_valid, eq: false }

# Membership
when: { field: plan_approval, in: [missing, stale] }

# Numeric threshold
when: { field: retry_cycles, gte: 2 }

# AND
when:
  all:
    - { field: writer_ownership, eq: held }
    - { field: session_live, eq: true }

# OR
when:
  any:
    - { field: review, eq: absent }
    - { field: review, eq: stale }

# Fallback (always matches)
when: { always: true }
```

Predicates evaluate against a `GateRecord`. A predicate does not match when the field is `"unknown"` unless it explicitly checks for that value.

### Interrupt definition

```yaml
interrupts:
  - id: handoff
  - id: material_decision
```

Each interrupt is a stop condition. The `interrupt` field on an edge or node references one of these IDs.

### Non-edge definition

```yaml
non_edges:
  - id: implemented_child_never_returns_to_refiner
    given:
      eligible_child_state: "Implemented — awaiting parent review"
      needs_ui_refinement: true
    never: [refiner, ui_refiner]
```

These are tested as assertions. They verify that a given gate state never routes to a forbidden node. They do not affect routing.

## Adding a new node

1. Add the node to `nodes:` in the YAML fence.
2. Add a row to the prose `## Edge order` table.
3. Add at least one edge that targets the new node.
4. If the node is a specialist, create the agent definition and skill (see below).
5. If the node needs a new gate field, add it to `Gates`, `GateRecord`, the checkpoint schema, and `toGateRecord`/`neutralRecord` in the runner.
6. Add a test fixture for every new edge.

## Adding a new specialist role

Three files are required.

### Agent definition

Create `kit/.opencode/agents/<role>.md`, `kit/.codex/agents/<role>.toml`, and `kit/.vibe/agents/<role>.toml`. Follow the existing ones. The autopilot agent has `mode: all`. Subagents have `mode: subagent`. The `description` field is shown to the model choosing which agent to launch.

### Skill

Create `kit/.agents/skills/studypilot-<role>/SKILL.md`. Write the role's instructions. End with a `## Graph node` section:

```markdown
## Graph node

Node `<node_id>` in [workflow-graph.md](../../workflow-graph.md). Assignment:
`<assignment>`. Return the shared closeout fields. Do not route the next
specialist; the graph does that.
```

### Node contract

Add the node to `workflow-graph.md` under `nodes:`. The `role` field must match the agent ID in the target repo's `.opencode/agents/` directory.

## Adding a host adapter

The runner only supports OpenCode. Codex and Vibe are refused. To add a host:

1. Create `runner/src/hosts/<name>.ts` implementing `HostAdapter`:

```ts
export interface HostAdapter {
  id: string
  dispatch(input: DispatchInput): Promise<SpecialistReturn>
  sessionLive(sessionId: string): Promise<Tri>
  wait(sessionId: string, signal?: AbortSignal): Promise<SpecialistReturn>
}
```

2. `dispatch` must create one isolated session, send the handoff as a prompt, and wait for completion. Return a `SpecialistReturn` parsed from the model's closeout fields (`Status:`, `Records:`, `Commits:`, `Verification:`, `Remaining:`). If a permission prompt appears, return `{ paused: { kind: "missing_permission", question: ... } }`.

3. `sessionLive` returns `true` if the session is still running, `false` if finished, `"unknown"` if the host cannot say.

4. Wire the adapter into `runner/src/cli.ts`. Replace the `args.host !== "opencode"` refusal with a branch that calls your adapter.

5. Add a test with a fake host that verifies the graph routes correctly without dispatching.

Constraints:

- One session per dispatch. No forked history.
- No parallel writers. The runner dispatches one specialist at a time.
- Do not auto-approve permission prompts. Surface them as `missing_permission`.
- Do not start a second host process. Use the one already running.

## Runner file map

| File | Purpose |
|---|---|
| `src/types.ts` | `DeliveryState`, `GateRecord`, `QueueRow`, `SpecialistReturn`, `RouteResult` |
| `src/spec.ts` | Parses `workflow-graph.md`. Extracts YAML fence, validates nodes/edges, reads prose edge order |
| `src/router.ts` | Pure first-match router. `planningSatisfied()`, `neutralRecord()`, `toGateRecord()`, `route()` |
| `src/reconcile.ts` | Reads README queue, Git state, artifact files. `parseQueue()`, `selectEligible()`, `gitFacts()`, `reconcile()` |
| `src/checkpoint.ts` | Serializes/parses the `## Autopilot` YAML section. `upsertSection()` replaces only that section |
| `src/handoff.ts` | `buildHandoff()` (compact specialist handoff), `judgePrompt()` (read-only judge prompt) |
| `src/closeout.ts` | `parseCloseout()`, `parseJudge()`, `applyJudgment()`, `pathsFromCloseout()` |
| `src/git.ts` | `commitOwned()`, `allowedCommitPath()`. Coordinator commits with per-role allowlists |
| `src/graph.ts` | LangGraph `StateGraph`. `compileGraph()`, `invokeGraph()`. Nodes: reconcile, judge, wait, specialists, handoff, blocked, complete |
| `src/hosts/types.ts` | `HostAdapter` interface |
| `src/hosts/opencode.ts` | OpenCode adapter. One session per dispatch, permission surface, poll fallback |
| `src/cli.ts` | `status`, `run`, `resume` commands |

## Adding a gate field

If you need a new gate (for example, `security_review_complete`):

1. **`src/types.ts`** — add to `Gates` interface and `GateRecord`.
2. **`src/checkpoint.ts`** — add to the checkpoint YAML schema, `serializeCheckpoint`, and `parseCheckpoint`.
3. **`src/reconcile.ts`** — compute it mechanically if possible (file existence, queue state). Reset it to `unknown` when HEAD or the queue changes.
4. **`src/router.ts`** — add to `neutralRecord()` and `toGateRecord()`. Add edge conditions that use it.
5. **`workflow-graph.md`** — add the field to the checkpoint schema in the spec.
6. **`runner/test/router.test.ts`** — add a test fixture for any new edge.

## Adding a coordinator commit

If a specialist's output needs a coordinator commit (like refiner/reviewer files):

1. Set `commit: coordinator` on the node in `workflow-graph.md`.
2. In `runner/src/git.ts`, add the role to `allowedCommitPath()`. List the paths the role may commit.
3. The specialist's closeout must name the files in its `Records:` or `Commits:` lines. `pathsFromCloseout()` in `runner/src/closeout.ts` extracts them.
4. `applyReturn()` in `runner/src/graph.ts` calls `commitOwned()` automatically when `commit === "coordinator"`.

The runner refuses to commit if unrelated staged work is present, if a path escapes the allowlist, or if a path matches a secret pattern (`.env`).

## The in-session path

The in-session autopilot agent (`kit/.opencode/agents/autopilot.md`) reads `workflow-graph.md` as its only router. It does not use the runner. It dispatches via OpenCode's native `subagent` tool.

The OpenCode plugin (`kit/.opencode/plugins/delivery-graph/`) enforces that the parent README has a version-1 `## Autopilot` checkpoint before any `subagent` call from the autopilot agent. The checkpoint must name the role being spawned with `status: pending` or `status: running`.

If you add a new node, the plugin does not need changes. It checks the checkpoint shape, not the role identity.

## Testing

Run the full suite:

```bash
cd runner && npm test
```

Tests are in `runner/test/`:

- `router.test.ts` — one fixture per edge, plus non-edge assertions. Verifies prose/YAML parity.
- `checkpoint.test.ts` — round-trip serialization, queue preservation.
- `reconcile.test.ts` — queue parsing, child selection, dependency handling, mechanical gates.
- `host.test.ts` — permission surface, commit allowlist.
- `graph.test.ts` — end-to-end graph traversal with a fake host.
- `checkpoint-gate.test.ts` — the OpenCode plugin's checkpoint validation.

Add a test for every new edge. The test should construct a `GateRecord` that makes that edge the first match, call `route()`, and assert the edge ID and target node.

## Installing

```bash
./install.sh /path/to/target-repo          # fresh
./install.sh --force /path/to/target-repo  # update (overwrites kit files, not project docs)
```

The installer copies `kit/` into the target repo. It does not copy `runner/`. The runner stays in agents-kit and is invoked against target repos with `--repo`.

The installer seeds `docs/epics/README.md`, `docs/artifacts/README.md`, and `docs/jira-sync/README.md` only where missing. It never overwrites project story docs or the Jira ledger.

## The one rule

The spec is the router. The runner reads it. The agent reads it. The plugin reads it. None of them may add an edge that is not in it. If you want new behavior, add it to `workflow-graph.md` first. Then update the runner, the agent, and the tests. In that order.
