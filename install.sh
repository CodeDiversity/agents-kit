#!/usr/bin/env bash
# agents-kit installer
#
# Usage:
#   ./install.sh [target-repo-dir]           Install (copy) into a repo
#   ./install.sh --dry-run [target-repo]     Preview what would be written
#   ./install.sh --force  [target-repo]      Update an existing install
#   ./install.sh --project NAME [target]     Project display name (default from kit/kit.toml)
#   ./install.sh --wizard [target-repo]      Also fill docs/epics/README.md interactively
#   ./install.sh --only HOST [target]        Install just one host (codex | vibe | opencode)
#   ./install.sh --check [target]            Report drift between install, manifest and kit
#   ./install.sh --diff [target]             Unified diffs of installed files vs kit sources
#   ./install.sh --uninstall [target]        Remove kit-owned files recorded in the manifest
#
# Copies kit/ into the target repo's root (.codex, .vibe, .opencode, .agents)
# and seeds docs/ + AGENTS.md templates only where missing. Existing project
# files are never overwritten without --force.
#
# The project name replaces {{PROJECT}}, {{PROJECT_lower}} and
# {{PROJECT_upper}} placeholders in every copied or seeded file, so kit
# sources stay project-agnostic and a target repo never sees a placeholder.
# kit/kit.toml is the manifest; it is never copied into the target repo.
#
# Every install records a baseline in .agents/.kit-manifest — project name,
# kit source commit, and the sha256 of each written file. The read-side
# modes (--check, --diff, --uninstall) reproduce the same substitution using
# the recorded project name. They need one install (or --force) run to create
# the baseline first, and exit 0 when clean, 1 when drift/differences appear,
# 2 when they cannot run (missing manifest, bad arguments).
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
KIT="$SOURCE_DIR/kit"
TEMPLATES="$SOURCE_DIR/templates"

# ---------------------------------------------------------------- arguments
DRY_RUN=false
FORCE=false
WIZARD=false
ONLY=""
TARGET=""
MODE="install"
PROJECT="$(grep -m1 '^name *= *"' "$KIT/kit.toml" 2>/dev/null | sed 's/^name *= *"\(.*\)"$/\1/')"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true ;;
    --force)   FORCE=true ;;
    --wizard)  WIZARD=true ;;
    --check|--diff|--uninstall)
      if [[ "$MODE" != "install" ]]; then echo "error: pass at most one of --check/--diff/--uninstall" >&2; exit 2; fi
      MODE="${1#--}" ;;
    --only)
      if [[ $# -lt 2 ]]; then echo "error: --only requires a host" >&2; exit 2; fi
      case "$2" in
        codex|vibe|opencode) ONLY="$2" ;;
        *) echo "error: --only accepts codex, vibe or opencode" >&2; exit 2 ;;
      esac
      shift ;;
    --project)
      if [[ $# -lt 2 || -z "$2" ]]; then echo "error: --project requires a name" >&2; exit 2; fi
      PROJECT="$2"; shift ;;
    -h|--help)
      sed -n '2,29p' "$0"; exit 0 ;;
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

case "$MODE" in
  install)
    mkdir -p "$TARGET"
    TARGET="$(cd "$TARGET" && pwd)"
    ;;
  check|diff|uninstall)
    [[ -d "$TARGET" ]] || { echo "error: $TARGET does not exist" >&2; exit 2; }
    TARGET="$(cd "$TARGET" && pwd)"
    ;;
esac

if [[ "$MODE" == "install" && ! -d "$TARGET/.git" && ! -f "$TARGET/.git" ]]; then
  echo "warning: $TARGET does not look like a git repo (installing anyway)" >&2
fi

MANIFEST="$TARGET/.agents/.kit-manifest"

# Read-side modes must reproduce the EXACT transformation used at install
# time, so they honour the recorded project name over any --project flag.
if [[ "$MODE" != "install" && -f "$MANIFEST" ]]; then
  manifest_project="$(awk '$1 == "project" { $1 = ""; sub(/^ +/, ""); print; exit }' "$MANIFEST")"
  [[ -n "$manifest_project" ]] && PROJECT="$manifest_project"
fi

# ------------------------------------------------------- placeholder engine
[[ -z "$PROJECT" ]] && PROJECT="{{PROJECT}}"
PROJECT_LOWER="$(echo "$PROJECT" | tr '[:upper:]' '[:lower:]')"
PROJECT_UPPER="$(echo "$PROJECT" | tr '[:lower:]' '[:upper:]')"
sed_project="$(printf '%s' "$PROJECT"      | sed -e 's/[\\&|]/\\&/g')"
sed_lower="$(printf  '%s' "$PROJECT_LOWER" | sed -e 's/[\\&|]/\\&/g')"
sed_upper="$(printf  '%s' "$PROJECT_UPPER" | sed -e 's/[\\&|]/\\&/g')"
transformed() { # print a kit/template source with placeholders substituted
  sed -e "s|{{PROJECT_lower}}|$sed_lower|g" \
      -e "s|{{PROJECT_upper}}|$sed_upper|g" \
      -e "s|{{PROJECT}}|$sed_project|g" "$1"
}

hash_of() { # sha256 of a file, or of stdin with:  hash_of -
  if command -v shasum > /dev/null 2>&1; then
    if [[ "$1" == "-" ]]; then shasum -a 256 | awk '{print $1}'
    else shasum -a 256 "$1" | awk '{print $1}'; fi
  elif command -v sha256sum > /dev/null 2>&1; then
    if [[ "$1" == "-" ]]; then sha256sum | awk '{print $1}'
    else sha256sum "$1" | awk '{print $1}'; fi
  else
    echo "error: need shasum or sha256sum on PATH" >&2
    exit 1
  fi
}

manifest_entries() { # emit "rel<TAB>hash" per tracked file, in recorded order
  [[ -f "$MANIFEST" ]] || return 0
  awk '$1 == "file" && NF == 3 { print $2 "\t" $3 }' "$MANIFEST"
}
# best-matching kit source for an installed rel; empty when the kit dropped it
source_for() {
  if   [[ -f "$KIT/$1" ]]      ; then echo "$KIT/$1"
  elif [[ -f "$TEMPLATES/$1" ]]; then echo "$TEMPLATES/$1"
  else echo ""; fi
}

TMP="$(mktemp -d)"
if [[ -n "${KEEP_TMP:-}" ]]; then echo "tmp: $TMP" >&2; else trap 'rm -rf "$TMP"' EXIT; fi
WRITTEN_LIST="$TMP/written"   # rels written this run
INSTALLED_SEEDS="$TMP/seeded" # seeded docs, used by the wizard

copied=0 skipped=0
install_file() { # src dst
  local src="$1" dst="$2" rel
  rel="${dst#$TARGET/}"
  if [[ -e "$dst" && "$FORCE" != true ]]; then
    echo "  skip  $rel (exists — use --force to overwrite)"
    skipped=$((skipped + 1))
    return
  fi
  mkdir -p "$(dirname "$dst")"
  if [[ "$DRY_RUN" == true ]]; then
    echo "  would copy  $rel"
  else
    transformed "$src" > "$dst"
    echo "$rel" >> "$WRITTEN_LIST"
    echo "  copy   $rel"
  fi
  copied=$((copied + 1))
}

# =========================================================== install mode ==
if [[ "$MODE" == "install" ]]; then
  if [[ "$DRY_RUN" == true ]]; then
    echo "== dry run: Installing agents-kit into $TARGET =="
  else
    echo "== Installing agents-kit into $TARGET =="
  fi
  [[ -n "$ONLY" ]] && echo "   (host-only install: $ONLY; .agents stays shared)"

  # 1. Legacy cleanup: skill dirs from pre-placeholder installs.
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

  # 2. Agent role definitions + shared workflow docs; kit/kit.toml stays home.
  #    --only installs just that host's agent dir (.agents always shared).
  while IFS= read -r -d '' src; do
    rel="${src#"$KIT"/}"
    [[ "$rel" == "kit.toml" ]] && continue
    case "$rel" in
      .codex/*)    if [[ -n "$ONLY" && "$ONLY" != "codex"    ]]; then continue; fi ;;
      .vibe/*)     if [[ -n "$ONLY" && "$ONLY" != "vibe"     ]]; then continue; fi ;;
      .opencode/*) if [[ -n "$ONLY" && "$ONLY" != "opencode" ]]; then continue; fi ;;
    esac
    install_file "$src" "$TARGET/$rel"
  done < <(find "$KIT" -type f -print0)

  # 3. Documentation templates — seed only, never stomp an existing docs setup.
  #    --force updates kit role files, not project epics, artifacts, or ledger.
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
  #    Only prompts on a TTY; empty answers keep the template's defaults.
  EPICS_README="$TARGET/docs/epics/README.md"
  epics_seeded=false
  [[ -s "$INSTALLED_SEEDS" ]] && grep -Fxq "$EPICS_README" "$INSTALLED_SEEDS" && epics_seeded=true

  ask() { # ask PROMPT DEFAULT -> prints the answer (default unless --wizard on a TTY)
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

  # 6. Baseline manifest — merge the previous one; written files refresh their
  #    hash; kit-orphaned tracked files are dropped (and deleted on --force).
  if [[ "$DRY_RUN" != true && ( "$copied" -gt 0 || -f "$MANIFEST" ) ]]; then
    : > "$TMP/written.entries"      # rel<TAB>hash
    if [[ -s "$WRITTEN_LIST" ]]; then
      while IFS= read -r rel; do
        [[ -n "$rel" && -f "$TARGET/$rel" ]] || continue
        printf '%s\t%s\n' "$rel" "$(hash_of "$TARGET/$rel")"
      done < "$WRITTEN_LIST" | sort -u > "$TMP/written.entries"
    fi
    : > "$TMP/dropped"
    if [[ -f "$MANIFEST" ]]; then
      while IFS=$'\t' read -r oldrel _oldhash; do
        [[ -n "$oldrel" ]] || continue
        if [[ -z "$(source_for "$oldrel")" ]]; then
          echo "$oldrel" >> "$TMP/dropped"
          if [[ "$FORCE" == true && -f "$TARGET/$oldrel" ]]; then
            if [[ "$DRY_RUN" == true ]]; then
              echo "  would remove  $oldrel (no longer part of the kit)"
            else
              rm -f "$TARGET/$oldrel"
              echo "  remove   $oldrel (no longer part of the kit)"
            fi
          fi
        fi
      done < <(manifest_entries)
    fi
    kit_commit="$(cd "$SOURCE_DIR" 2>/dev/null && git -C "$SOURCE_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
    manifest_entries > "$TMP/old.entries"
    awk '$1 == "version" || $1 == "project" || $1 == "source_commit" || $1 == "" { next } { print }' \
      "$TMP/old.entries" > "$TMP/old.entries.clean"
    # merge: dropped orphans skipped; written hashes override; written-only
    # rels appended. All three inputs are "rel<TAB>hash" (or a dropped list).
    awk -F'\t' -v orf="$TMP/dropped" -v wrf="$TMP/written.entries" '
      FILENAME == orf { drop[$1] = 1; next }
      FILENAME == wrf { wr[$1] = $2; next }
      {
        rel = $1
        if (rel == "" || rel in drop) next
        h = (rel in wr) ? wr[rel] : $2
        print "file " rel " " h
        printed[rel] = 1
      }
      END {
        for (rel in wr) if (!(rel in printed)) print "file " rel " " wr[rel]
      }' "$TMP/dropped" "$TMP/written.entries" "$TMP/old.entries.clean" > "$TMP/body"
    sort -k2,2 "$TMP/body" -o "$TMP/body"
    {
      echo "# agents-kit manifest (auto-generated by install.sh — do not edit)"
      echo "version 1"
      echo "project $PROJECT"
      echo "source_commit $kit_commit"
      cat "$TMP/body"
    } > "$MANIFEST.tmp" && mv "$MANIFEST.tmp" "$MANIFEST"
    echo
    echo "manifest: $MANIFEST ($kit_commit)"
  fi

  echo
  echo "done: $copied written, $skipped skipped."
  [[ "$DRY_RUN" == true ]] || echo "next: git add .codex .vibe .opencode .agents && commit"
  exit 0
fi

# ============================================================ read modes ===
if [[ ! -f "$MANIFEST" ]]; then
  echo "error: no baseline manifest at $MANIFEST — run install (or --force) once to record it" >&2
  exit 2
fi

# ------------------------------------------------------------------- check
if [[ "$MODE" == "check" ]]; then
  attention=0 okcount=0 untracked=0 checked=0
  while IFS=$'\t' read -r rel hash; do
    [[ -n "$rel" ]] || continue
    dst="$TARGET/$rel"
    src="$(source_for "$rel")"
    checked=$((checked + 1))
    if [[ ! -e "$dst" ]]; then
      echo "missing      $rel (tracked, but not on disk)"
      attention=$((attention + 1)); continue
    fi
    cur="$(hash_of "$dst")"
    if [[ "$cur" == "$hash" ]]; then
      if [[ -z "$src" ]]; then
        echo "outdated     $rel (untouched since install; the kit no longer ships it — rerun --force to remove)"
        attention=$((attention + 1))
      else
        kit_now="$(transformed "$src" | hash_of -)"
        if [[ "$kit_now" == "$hash" ]]; then
          okcount=$((okcount + 1))
        else
          echo "update-ready $rel (untouched since install; kit changed — rerun --force)"
          attention=$((attention + 1))
        fi
      fi
    else
      if [[ -z "$src" ]]; then
        echo "locally-modified $rel (and no longer part of the kit)"
      else
        kit_now="$(transformed "$src" | hash_of -)"
        if [[ "$kit_now" == "$cur" ]]; then
          echo "locally-modified $rel (matches the kin source; rerun --force to re-record)"
        else
          echo "locally-modified $rel (the kit changed since, too)"
        fi
      fi
      attention=$((attention + 1))
    fi
  done < <(manifest_entries)
  while IFS= read -r dst; do
    [[ -n "$dst" ]] || continue
    rel="${dst#$TARGET/}"
    [[ "$dst" == "$MANIFEST" ]] && continue
    if ! grep -Fq "file $rel " "$MANIFEST"; then
      echo "untracked    $rel (not recorded by any install run)"
      untracked=$((untracked + 1))
    fi
  done < <(find "$TARGET/.agents" "$TARGET/.codex" "$TARGET/.vibe" "$TARGET/.opencode" -type f 2>/dev/null | sort)
  echo
  echo "check: $okcount in sync; $attention with findings; $untracked untracked; $checked tracked"
  if [[ "$attention" -eq 0 && "$untracked" -eq 0 ]]; then echo "install is current"; fi
  [[ "$attention" -eq 0 ]] || exit 1
  exit 0
fi

# -------------------------------------------------------------------- diff
if [[ "$MODE" == "diff" ]]; then
  changes=0 checked=0
  while IFS=$'\t' read -r rel hash; do
    [[ -n "$rel" ]] || continue
    dst="$TARGET/$rel"
    checked=$((checked + 1))
    src="$(source_for "$rel")"
    if [[ ! -f "$dst" ]]; then
      echo "missing  $rel (tracked, but not on disk)"
      changes=$((changes + 1)); continue
    fi
    if [[ -z "$src" ]]; then
      echo "removed  $rel is no longer part of the kit (rerun --force to delete the installed copy)"
      changes=$((changes + 1)); continue
    fi
    transformed "$src" > "$TMP/candidate"
    if ! cmp -s "$dst" "$TMP/candidate"; then
      echo "differs  $rel"
      diff -u --label "kit/$rel" --label "installed/$rel" "$TMP/candidate" "$dst" || true
      echo
      changes=$((changes + 1))
    fi
  done < <(manifest_entries)
  echo "diff: $changes difference(s) across $checked tracked file(s)"
  [[ "$changes" -eq 0 ]] || exit 1
  exit 0
fi

# --------------------------------------------------------------- uninstall
if [[ "$MODE" == "uninstall" ]]; then
  removed=0 kept=0
  while IFS=$'\t' read -r rel hash; do
    [[ -n "$rel" ]] || continue
    dst="$TARGET/$rel"
    case "$rel" in
      .agents/*|.codex/*|.vibe/*|.opencode/*) kit_owned=true ;;
      *) kit_owned=false ;;
    esac
    if [[ "$kit_owned" != true ]]; then
      echo "kept     $rel (project surface: entry points, docs/**)"
      kept=$((kept + 1)); continue
    fi
    if [[ ! -e "$dst" ]]; then
      echo "absent   $rel"; continue
    fi
    cur="$(hash_of "$dst")"
    if [[ "$cur" != "$hash" && "$FORCE" != true ]]; then
      echo "kept     $rel (modified since install — combine with --force to remove anyway)"
      kept=$((kept + 1)); continue
    fi
    if [[ "$DRY_RUN" == true ]]; then
      echo "would remove  $rel"
    else
      rm -f "$dst"
      echo "remove   $rel"
    fi
    removed=$((removed + 1))
  done < <(manifest_entries)
  echo "would remove  .agents/.kit-manifest (baseline)"
  if [[ "$DRY_RUN" != true ]]; then
    find "$TARGET/.agents" "$TARGET/.codex" "$TARGET/.vibe" "$TARGET/.opencode" \
      -type d -empty -delete 2>/dev/null || true
    rm -f "$MANIFEST"
    echo "removed  .agents/.kit-manifest"
  fi
  echo "uninstall done: $removed kit-owned file(s)${DRY_RUN:+ (dry run — nothing deleted)}; $kept kept."
  exit 0
fi
