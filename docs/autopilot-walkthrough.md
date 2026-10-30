# Autopilot walkthrough: from `/autopilot SP-1` to closeout

This is a narrative tour of one complete parent-review unit driven by
`/autopilot`, using the same graph that in-session autopilot and the optional
local runner both execute. The only router is `.agents/workflow-graph.md`; this
document explains the run, it does not add edges.

## 0. Before you start

1. Install the kit: `./install.sh /path/to/repo` (add `--project "Name"`).
2. Fill `docs/epics/README.md` with the stack, epics and Definition of Done,
   or run `./install.sh --wizard` to seed the header interactively.
3. Start OpenCode (or Codex/Vibe) in the repo. The runner is optional —
   in-session autopilot is the normal start.

## 1. Entry

```
/autopilot SP-1
```

`SP-1` is an entry hint, not a jump. Autopilot selects the autopilot agent,
reads `.agents/delivery-state.md` and the parent README execution queue, and
writes the `## Autopilot` checkpoint (stage `reconcile`) before any dispatch.
Every run starts at reconcile; an earlier unmet prerequisite is never skipped.

## 2. Reconcile

Autopilot re-derives the gate record from evidence: queue rows, plan-review.md,
child implementation records, review.md, walkthrough.md, git HEAD. Missing
records are unverified, not done. If HEAD or the queue changed since the last
judgment, every `unknown`-eligible gate resets to `unknown` and
`judged_at_head`/`queue_hash` are cleared.

## 3. First dispatch (planning)

With no plan review yet, the first matching edge is `plan_not_ready` →
`plan_reviewer` (reviewer). Autopilot spawns a fresh isolated reviewer
context with the plan-review handoff. The reviewer saves `plan-review.md` and
returns the closeout fields (`Status`, `Records`, `Commits`, `Verification`,
`Remaining`). The coordinator commits `plan-review.md` (coordinator-owned
commit) and writes the checkpoint.

If the plan needs correction, `plan_findings_open` → `planner` (assignment
`plan_correction`) runs next, then re-review.

## 4. Refinement

Once planning gates pass, the first queued child is selected. If it is
`Needs refinement`/`Queued`:

- `ui_needed` → `ui_refiner` (frontend children with unsettled UI/UX), then
- `tech_needed` → `refiner` (technical refinement).

An implemented child never returns to either refiner — the graph refuses it
(`implemented_child_never_returns_to_refiner` non-edge).

## 5. Implementation

`child_ready` → `implementer` (assignment `complete_child`). The implementer
is the single sequential writer: it executes the substory across all layers,
records findings in the child's `implementation.md`, reconciles checkpoint/
checklists, commits scoped code and closeout docs, and returns verified hashes.
No parallel implementers, no worktree workaround.

If a child is `In progress` or unfinished, `child_in_progress` /
`child_unfinished` resume it with `resume_checkpoint` instead of starting over.

## 6. Integration and review

When all descendants are implemented:

- `integration_incomplete` → `implementer` (assignment `integration`) for the
  combined index.
- `parent_review` → `parent_reviewer` (reviewer) produces `review.md`.
- On a passing verdict, `walkthrough_needed` → `walkthrough` (reviewer) saves
  `walkthrough.md` beside `review.md`.

`complete` fires only when review is `pass`, walkthrough is `verified`,
closeout is `true`, and no findings are open. Autopilot stops within this
parent — it never advances to the next parent or epic on its own.

## 7. Interrupts and blockers

The graph stops (one question, no relabelling) on:

- `handoff` — a writer still owns the work; obtain a safe handoff first.
- `material_decision` / `human_evidence` / `missing_permission` — recorded
  blocker; answer it, then resume.
- `stagnation` — two correction cycles with no progress.
- `missing_judgment` — two read-only judgment passes left a gate unknown.

Resume with `agents-kit resume --repo <path> --answer "<the answer>"` or by
answering in session.

## 8. Jira sync and DoD audit

`jira-sync` and `dod-auditor` are not graph nodes. Run them only on explicit
user request; they must not advance `stage`.

## Per-host setup notes

- **OpenCode**: start OpenCode in the repo, run `/autopilot`. The optional
  runner (`agents-kit run`) dispatches through the running service and inherits
  its model/permissions.
- **Codex**: use in-session autopilot; roles live in `.codex/agents/*.toml`
  with `sandbox_mode` scoping.
- **Vibe**: use in-session autopilot; roles live in `.vibe/agents/*.toml` with
  tool allowlists and `permission` blocks.

## Troubleshooting

- **Stuck writer**: a held session that is no longer live leaves
  `writer: unknown`. Answer the handoff question before any new writer.
- **Stale approval**: changed HEAD or queue resets judgment gates to `unknown`;
  the next run re-judges rather than trusting a stale `ready`.
- **Blocked child**: the first eligible child is blocked and is never skipped
  for a dependent sibling — answer its recorded question.
- **Missing judgment**: two read-only passes left a gate unknown; inspect the
  referenced files and re-run, or record the blocker.

See `.agents/workflow-graph.md` for the full edge table and checkpoint schema,
and `docs/epics/README.md` for the project's stack, epics and DoD.