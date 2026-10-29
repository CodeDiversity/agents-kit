# agents-kit

Portable multi-agent delivery kit: one source of truth for the agent roster,
shared skills and workflow docs, installable (copied) into any repository.

Supports Codex (`.codex/agents/*.toml`), Vibe (`.vibe/agents/*.toml`) and
OpenCode (`.opencode/agents/*.md`). All three formats define the same roles;
only the file format differs. The substance lives in `.agents/skills/**` and
`.agents/*.md`, which every format's agents reference.

## Roles

| Role | Purpose |
|---|---|
| planner | Epics → small testable stories; queue/dependency ownership; docs only |
| refiner | Turns a story into an implementation-ready ticket, grounded in the code |
| ui-refiner | UI/UX decisions for frontend stories before implementation |
| implementer | Single sequential implementation owner across all layers |
| jira-sync | Bidirectional tracker reconciliation and durable ledger |
| reviewer | Independent plan/story review; final report + user walkthrough |
| dod-auditor | Read-only Definition-of-Done audit; writes nothing |
| autopilot | End-to-end coordination through final parent review |

## Install

```bash
# from the kit directory
./install.sh /path/to/target-repo      # install
./install.sh --dry-run /path/to/repo   # preview
./install.sh --force  /path/to/repo    # update existing installed files
```

What it does:

1. Copies `kit/` into the repo root: `.codex/`, `.vibe/`, `.opencode/`,
   `.agents/` (skills + shared workflow docs).
2. Seeds `docs/epics/README.md` (shared Definition of Done + epic index),
   `docs/artifacts/README.md` (record layout) and `docs/jira-sync/README.md`
   (ledger stub) only where missing.
3. Adds `AGENTS.md` / `CLAUDE.md` entry points only if the repo has none —
   an existing `AGENTS.md` is never overwritten (that file is project-specific):
   copy the role-routing block from `templates/AGENTS.md` into it instead.

## Layout

```text
agents-kit/
├── install.sh              # installer (idempotent, template-preserving)
├── README.md
├── kit/
│   ├── .codex/agents/      # Codex role definitions (TOML)
│   ├── .vibe/agents/       # Vibe role definitions (TOML)
│   ├── .opencode/agents/   # OpenCode role definitions (Markdown)
│   └── .agents/            # shared workflow docs + skills/studypilot-*
└── templates/              # seeded into docs/ + AGENTS.md when absent
    ├── AGENTS.md
    ├── CLAUDE.md
    └── docs/{epics,artifacts,jira-sync}/README.md
```

## Updating an existing install

Edit the file under `kit/` (or `templates/` for seeded docs), commit in this
repo, then run `./install.sh --force <repo>` on installed repos. Files you
customized per project (AGENTS.md, epic/story docs, queue) are separate copies,
so `--force` does not touch them — but confirm with `--dry-run` first.

## Delivery graph

`.agents/workflow-graph.md` is the only delivery router. Its YAML fence and the
prose edge table are the same contract; a runner test fails if they diverge.
In-session autopilot walks that table. The local runner executes the same fence
with LangGraph and does not add a model key, LangSmith, or a hosted graph service.

In an OpenCode session for the target repo, run:

```text
/autopilot
/autopilot SP-1
```

That selects the autopilot agent and follows the graph. A named story is only
an entry hint. The optional local runner is for unattended OpenCode dispatch;
it is not the normal start.

## Per-repo wiring (first install)

1. Run the installer.
2. Point `AGENTS.md` (or `CLAUDE.md`) at the roles, or adopt `templates/AGENTS.md`.
3. Fill in `docs/epics/README.md` with the project's stack, epics and DoD.
4. Start a feature with the planner; see `.agents/delivery-state.md` for the
   queue/artifact conventions all roles follow.
