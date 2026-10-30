#!/usr/bin/env bash
# agents-kit installer
#
# Usage:
#   ./install.sh [target-repo-dir]           Install (copy) into a repo
#   ./install.sh --dry-run [target-repo]     Preview what would be written
#   ./install.sh --force  [target-repo]      Update an existing install
#   ./install.sh --project NAME [target]     Project display name (default from kit/kit.toml)
#   ./install.sh --wizard [target-repo]      Also fill docs/epics/README.md interactively
#
# Copies kit/ into the target repo's root (.codex, .vibe, .opencode, .agents)
# and seeds docs/ + AGENTS.md templates only where missing. Existing project
# files are never overwritten without --force.
#
# The project name replaces {{PROJECT}}, {{PROJECT_lower}} and
# {{PROJECT_upper}} placeholders in every copied or seeded file, so kit
# sources stay project-agnostic and a target repo never sees a placeholder.
# kit/kit.toml is the manifest; it is never copied into the target repo.
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
KIT="$SOURCE_DIR/kit"
TEMPLATES="$SOURCE_DIR/templates"

DRY_RUN=false
FORCE=false
WIZARD=false
TARGET=""
PROJECT="$(grep -m1 '^name *= *"' "$KIT/kit.toml" 2>/dev/null | sed 's/^name *= *"\(.*\)"$/\1/')"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true ;;
    --force)   FORCE=true ;;
    --wizard)  WIZARD=true ;;
    --project)
      if [[ $# -lt 2 || -z "$2" ]]; then echo "error: --project requires a name" >&2; exit 2; fi
      PROJECT="$2"; shift ;;
    -h|--help)
      sed -n '2,18p' "$0"; exit 0 ;;
    *)
      if [[ -n "$TARGET" ]]; then echo "error: multiple targets given" >&2; exit 2; fi
      TARGET="$1" ;;
  esac
  shift
done

if [[ ! -d "$KIT" ]]; then
  echo "error: kit directory not found at $KIT" >&2
  exit 1
fi

if [[ -n "$TARGET" ]]; then
  mkdir -p "$TARGET"
  TARGET="$(cd "$TARGET" && pwd)"
else
  TARGET="$PWD"
fi

if [[ ! -d "$TARGET/.git" ]] && [[ ! -f "$TARGET/.git" ]]; then
  echo "warning: $TARGET does not look like a git repo (installing anyway)" >&2
fi

if [[ -z "$PROJECT" ]]; then PROJECT="{{PROJECT}}"; fi
PROJECT_LOWER="$(echo "$PROJECT" | tr '[:upper:]' '[:lower:]')"
PROJECT_UPPER="$(echo "$PROJECT" | tr '[:lower:]' '[:upper:]')"
sed_project="$(printf '%s' "$PROJECT"      | sed -e 's/[\\&|]/\\&/g')"
sed_lower="$(printf  '%s' "$PROJECT_LOWER" | sed -e 's/[\\&|]/\\&/g')"
sed_upper="$(printf  '%s' "$PROJECT_UPPER" | sed -e 's/[\\&|]/\\&/g')"

copied=0 skipped=0
install_file() {
  local src="$1" dst="$2"
  if [[ -e "$dst" && "$FORCE" != true ]]; then
    echo "  skip  ${dst#$TARGET/} (exists — use --force to overwrite)"
    skipped=$((skipped + 1))
    return
  fi
  mkdir -p "$(dirname "$dst")"
  if [[ "$DRY_RUN" == true ]]; then
    echo "  would copy  ${dst#$TARGET/}"
  else
    sed -e "s|{{PROJECT_lower}}|$sed_lower|g" \
        -e "s|{{PROJECT_upper}}|$sed_upper|g" \
        -e "s|{{PROJECT}}|$sed_project|g" "$src" > "$dst"
    echo "  copy   ${dst#$TARGET/}"
  fi
  copied=$((copied + 1))
}

if [[ "$DRY_RUN" == true ]]; then
  echo "== dry run: Installing agents-kit into $TARGET =="
else
  echo "== Installing agents-kit into $TARGET =="
fi

# 1. Kit manifest is kit-source-only; never copied. Renamed skills leave
#    orphaned directories in pre-placeholder installs — clean them on --force.
if [[ "$FORCE" == true ]] && compgen -G "$TARGET/.agents/skills/studypilot-*" > /dev/null; then
  for legacy in "$TARGET/.agents/skills/studypilot-"*; do
    [[ -d "$legacy" ]] || continue
    if [[ "$DRY_RUN" == true ]]; then
      echo "  would remove  legacy skill ${legacy#$TARGET/} (renamed)"
    else
      rm -rf "$legacy"
      echo "  remove   legacy skill ${legacy#$TARGET/} (renamed)"
    fi
  done
fi

# 2. Agent role definitions + shared workflow docs (kit layout mirrors target);
#    kit/kit.toml stays with the kit source.
while IFS= read -r -d '' src; do
  rel="${src#"$KIT"/}"
  [[ "$rel" == "kit.toml" ]] && continue
  install_file "$src" "$TARGET/$rel"
done < <(find "$KIT" -type f -print0)

# 3. Documentation templates — seed only, never stomp an existing docs setup.
# --force updates kit role files, not project epics, artifacts, or the Jira ledger.
seed_file() {
  local src="$1" dst="$2"
  if [[ -e "$dst" ]]; then
    echo "  skip  ${dst#$TARGET/} (project file — not replaced)"
    skipped=$((skipped + 1))
    return
  fi
  install_file "$src" "$dst"
  echo "$dst" >> "$INSTALLED_SEEDS"
}
INSTALLED_SEEDS="$(mktemp)"
trap 'rm -f "$INSTALLED_SEEDS"' EXIT
[[ -f "$TEMPLATES/docs/epics/README.md" ]] && \
  seed_file "$TEMPLATES/docs/epics/README.md" "$TARGET/docs/epics/README.md"
[[ -f "$TEMPLATES/docs/artifacts/README.md" ]] && \
  seed_file "$TEMPLATES/docs/artifacts/README.md" "$TARGET/docs/artifacts/README.md"
[[ -f "$TEMPLATES/docs/jira-sync/README.md" ]] && \
  seed_file "$TEMPLATES/docs/jira-sync/README.md" "$TARGET/docs/jira-sync/README.md"

# 4. Tool entry points — only when the target has none
for entry in AGENTS.md CLAUDE.md; do
  if [[ ! -e "$TARGET/$entry" ]]; then
    [[ -f "$TEMPLATES/$entry" ]] && install_file "$TEMPLATES/$entry" "$TARGET/$entry"
  fi
done

# 5. Per-repo wiring wizard — fill in the freshly seeded epics README.
# Only prompts on a TTY; listed values keep the template's defaults.
EPICS_README="$TARGET/docs/epics/README.md"
epics_seeded=false
[[ -f "$INSTALLED_SEEDS" ]] && grep -Fxq "$EPICS_README" "$INSTALLED_SEEDS" && epics_seeded=true

ask() { # ask PROMPT DEFAULT -> prints the answer (the default unless --wizard on a TTY)
  local prompt="$1" default="$2" reply=""
  if [[ "$WIZARD" != true || ! -t 0 ]]; then echo "$default"; return; fi
  read -r -p "$prompt [$default]: " reply || { echo "$default"; return; }
  echo "${reply:-$default}"
}

if [[ "$WIZARD" == true && "$epics_seeded" != true ]]; then
  if [[ -f "$EPICS_README" ]]; then
    echo "wizard: skipping $TARGET/docs/epics/README.md (already exists)"
  else
    echo "wizard: no epics README was seeded; nothing to fill in"
  fi
elif [[ "$WIZARD" == true ]]; then
  echo "wizard: filling $EPICS_README (empty answers keep the template value)"
  esc_sed() { printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'; }
  default_labels='`'"$PROJECT_LOWER"', mvp`'
  name="$(ask "Project display name" "$PROJECT")"
  release="$(ask "Release (milestone or version)" "<milestone or version>")"
  priority="$(ask "Priority (High / P0 / …)" "High")"
  labels="$(ask "Tracker labels (backticked, comma-separated)" "$default_labels")"
  stack="$(ask "Stack summary (one line)" "NestJS + Prisma + PostgreSQL backend; React + TypeScript + Vite frontend")"
  awk -v stack="$(esc_sed "$stack")" '
    { lines[NR] = $0 }
    END {
      inblock = 0
      for (i = 1; i <= NR; i++) {
        if (lines[i] ~ /^<!-- Backend\/frontend\/stack summary preserved/) {
          print "**Stack:** " stack; inblock = 1; continue
        }
        if (inblock) { if (lines[i] ~ /-->$/) inblock = 0; continue }
        print lines[i]
      }
    }
  ' "$EPICS_README" > "$EPICS_README.tmp" && mv "$EPICS_README.tmp" "$EPICS_README"
  sed -e "s|^\*\*Project:\*\* .*|**Project:** $(esc_sed "$name")|"  \
      -e "s|^\*\*Release:\*\* .*|**Release:** $(esc_sed "$release")|" \
      -e "s|^\*\*Priority:\*\* .*|**Priority:** $(esc_sed "$priority")|" \
      -e "s|^\*\*Labels:\*\* .*|**Labels:** $(esc_sed "$labels")|" \
      "$EPICS_README" > "$EPICS_README.tmp" && mv "$EPICS_README.tmp" "$EPICS_README"
fi

echo
echo "done: $copied written, $skipped skipped."
[[ "$DRY_RUN" == true ]] || echo "next: git add .codex .vibe .opencode .agents && commit"
