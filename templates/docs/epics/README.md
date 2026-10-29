# Shared Reference and Definition of Done

**Project:** <name>
**Release:** <milestone or version>
**Priority:** <High / P0>
**Labels:** `<project-label>`

<!-- Backend/frontend/stack summary preserved from source kit:
     NestJS + Prisma + PostgreSQL backend; React + TypeScript + Vite frontend.
     Replace with the target project's stack. -->

## Epics

| Epic | Title | File | Dependencies | Tracker ID |
|---|---|---|---|---|
| EP01 | <Title> | [EP01-<slug>.md](./EP01-<slug>.md) | None | <ID or dash> |

Breakdown and sequencing guidance belong in each epic file; this table stays the
one-look index. Story folders live under `docs/stories/<epic>/` per
[delivery state](../../.agents/delivery-state.md).

## Definition of Done

Every completed story must satisfy the following applicable conditions:

1. The functional acceptance criteria pass.
2. Frontend and backend validation handle invalid input.
3. Data is scoped to the authenticated user (where multi-user).
4. API errors produce actionable messages.
5. Loading, empty, and error states are handled.
6. Core interactions support keyboard accessibility.
7. Responsive layouts work on desktop and mobile.
8. Business rules have automated tests.
9. API changes and migrations are documented.
10. The feature has been reviewed in an integrated development environment.
11. Before final completion, the reviewer has saved a user-facing walkthrough
    explaining the code, evidence for correctness after review corrections,
    and manual test steps/expected results for each applicable workflow.

Item 11 is a final reviewer-owned deliverable, once per complete parent review
unit (or standalone story). Save `walkthrough.md` beside the resolved final
`review.md`; verify both before marking `Reviewed` or complete.

**Target accessibility:** WCAG 2.2 AA.

## Release Milestones

| Milestone | Included Epics | Outcome |
|---|---|---|
| M1 | EP01– | <short outcome> |
