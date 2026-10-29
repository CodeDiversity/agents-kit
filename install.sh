#!/usr/bin/env bash
# agents-kit installer
#
# Usage:
#   ./install.sh [target-repo-dir]        Install (copy) into a repo
#   ./install.sh --dry-run [target-repo]  Preview what would be written
#   ./install.sh --force  [target-repo]   Update an existing install
#
# Copies kit/ into the target repo's root (.codex, .vibe, .opencode, .agents)
# and seeds docs/ + AGENTS.md templates only where missing. Existing project
# files are never overwritten without --force.
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
KIT="$SOURCE_DIR/kit"
TEMPLATES="$SOURCE_DIR/templates"

DRY_RUN=false
FORCE=false
TARGET=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --force)   FORCE=true ;;
    -h|--help)
      sed -n '2,12p' "$0"; exit 0 ;;
    *)
      if [[ -n "$TARGET" ]]; then echo "error: multiple targets given" >&2; exit 2; fi
      TARGET="$arg" ;;
  esac
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
    cp "$src" "$dst"
    echo "  copy   ${dst#$TARGET/}"
  fi
  copied=$((copied + 1))
}

if [[ "$DRY_RUN" == true ]]; then
  echo "== dry run: Installing agents-kit into $TARGET =="
else
  echo "== Installing agents-kit into $TARGET =="
fi

# 1. Agent role definitions + shared workflow docs (kit layout mirrors target)
while IFS= read -r -d '' src; do
  rel="${src#"$KIT"/}"
  install_file "$src" "$TARGET/$rel"
done < <(find "$KIT" -type f -print0)

# 2. Documentation templates — seed only, never stomp an existing docs setup.
# --force updates kit role files, not project epics, artifacts, or the Jira ledger.
seed_file() {
  local src="$1" dst="$2"
  if [[ -e "$dst" ]]; then
    echo "  skip  ${dst#$TARGET/} (project file — not replaced)"
    skipped=$((skipped + 1))
    return
  fi
  install_file "$src" "$dst"
}
[[ -f "$TEMPLATES/docs/epics/README.md" ]] && \
  seed_file "$TEMPLATES/docs/epics/README.md" "$TARGET/docs/epics/README.md"
[[ -f "$TEMPLATES/docs/artifacts/README.md" ]] && \
  seed_file "$TEMPLATES/docs/artifacts/README.md" "$TARGET/docs/artifacts/README.md"
[[ -f "$TEMPLATES/docs/jira-sync/README.md" ]] && \
  seed_file "$TEMPLATES/docs/jira-sync/README.md" "$TARGET/docs/jira-sync/README.md"

# 3. Tool entry points — only when the target has none
for entry in AGENTS.md CLAUDE.md; do
  if [[ ! -e "$TARGET/$entry" ]]; then
    [[ -f "$TEMPLATES/$entry" ]] && install_file "$TEMPLATES/$entry" "$TARGET/$entry"
  fi
done

echo
echo "done: $copied written, $skipped skipped."
[[ "$DRY_RUN" == true ]] || echo "next: git add .codex .vibe .opencode .agents && commit"
