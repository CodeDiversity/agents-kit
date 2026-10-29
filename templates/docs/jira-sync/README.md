# Sync ledger

Bidirectional story/epic reconciliation between `docs/epics/`, `docs/stories/`
and the external tracker. The ledger tracks sync identity and baselines, not
implementation state.

## Conventions

- Record per-item identity (tracker key/URL), last known baseline and pending
  operations here or in colocated `<id>.sync.md` files.
- Preview is the default; explicit sync modes require authorization.
- Explicit prune may remove verified completed specifications only after the
  final review gate; keep parent queues, traceability, contracts and artifacts.
  Preserve tombstones to prevent re-import.
- Reopened items return as drafts to the planner, never automatically as active
  implementation.
