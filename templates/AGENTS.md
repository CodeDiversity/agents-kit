# Agent roles

Use the requested custom role in `.codex/agents/` when supported; `.vibe/agents/`
provides the same roles for Vibe, and `.opencode/agents/` for OpenCode.
Otherwise read its definition and shared skill.
Role availability does not require delegation.

Resolve ownership once, then act. A role identifies the permitted writes; it
does not require asking another agent to perform work already within that scope.
Routine status/evidence updates and scoped commits are part of finishing the
task. Do not repeatedly debate ownership or bounce actions between roles.

Every role's write boundary, execution protocol and review cadence live in
`.agents/` — read the relevant `SKILL.md` plus the shared docs referenced by the
role before acting:

- [Story sizing](.agents/story-sizing.md): planning, refinement and scope assessment.
- [Checkpoint execution](.agents/checkpoint-execution.md): implementation/resume.
- [Review cadence](.agents/review-cadence.md): review unit and final gate.
- [Context and efficiency](.agents/context-efficiency.md): reads, handoffs and closeout.
- [Delivery state](.agents/delivery-state.md): queue, artifact homes and role updates.
- [Workflow graph](.agents/workflow-graph.md): the only delivery router, checkpoint schema, and interrupts.

For story work, read [delivery state](.agents/delivery-state.md) and the parent
README's execution queue first. Load the requested role's skill, relevant epic,
and the shared Definition of Done in `docs/epics/README.md`.

Never treat implementation completion as independent approval. The reviewer
owns the final report, user walkthrough and passing-review docs sync; the
coordinator owns deferred edits only on non-passing verdicts.

## Security and scope

Never read, display, search inside, or write credential or secret files,
including `.env` and `.env.*`. Flag exposed secrets by location without
reproducing values. Role write limits apply to every tool use, including shell
commands. Existing authorization boundaries for trackers, shared databases and
destructive actions remain in force.

<!-- Project-specific conventions: add ownership rules, domain invariants and
     tooling notes below this line. Keep workflow rules in .agents/ so a kit
     update can replace them cleanly. -->
