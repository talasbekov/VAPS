#!/usr/bin/env bash
# scripts/obsidian/generate_changelog.sh
# Classifies every commit in git log by top-level path touched, appends
# one line per commit to the matching module's obsidian-vault Changelog.md.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

declare -A SEEN  # "<hash>|<module>" -> 1, avoids duplicate lines if a commit
                  # touches multiple paths that map to the same module

classify_path() {
  case "$1" in
    Backend/PersonnelStatus*|Backend/VAPS*) echo "Personnel-Records" ;;
    frontend*|"Smart Josparlau"*|"Прототип"*|ds-bundle*) echo "Frontend" ;;
    _bmad*|_bmad-output*) echo "BMAD-Process" ;;
    *) echo "Infrastructure" ;;
  esac
}

# tmp buffers, one per module, so we can sort/write once at the end
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
for m in Personnel-Records VisitX Accreditation Frontend Infrastructure BMAD-Process; do
  : > "$TMP_DIR/$m.txt"
done

# NOTE: deliberately using process substitution `< <(...)` instead of piping
# `git log | while read`. A trailing pipe runs the while-loop body in a
# subshell, so writes to the SEEN associative array would be lost at the end
# of each iteration of the *inner* per-commit path loop and would not persist
# across it either way it's nested. Process substitution keeps the whole loop
# (including the nested per-path loop) in the current shell, so SEEN persists
# correctly and dedup works as intended.
#
# NOTE: `git log --pretty=format:...` (with no trailing %n) does NOT emit a
# trailing newline after the last commit's record. `read` returns failure
# (EOF) on an unterminated final line WITHOUT populating $hash/$date/$subject,
# so `while read ...; do ... done` silently drops the last commit. Wrapping in
# `{ git log ...; echo; }` guarantees a trailing newline so `read` sees a
# terminated final record; the resulting single trailing empty read is
# skipped by the `[ -z "$hash" ] && continue` guard below.
while IFS='|' read -r hash date subject; do
  [ -z "$hash" ] && continue
  short="${hash:0:8}"
  while IFS= read -r path; do
    [ -z "$path" ] && continue
    # Classify against the full path, not just the top-level segment: the
    # patterns distinguish Backend/PersonnelStatus* from Backend/VAPS*, so
    # truncating to the first path component (as the brief's draft did)
    # collapses both to "Backend" and always falls through to the
    # Infrastructure default. Verified this was the actual cause of an
    # under-populated Personnel-Records changelog before this fix.
    mod=$(classify_path "$path")
    key="$hash|$mod"
    if [ -z "${SEEN[$key]:-}" ]; then
      SEEN[$key]=1
      echo "- $date \`$short\` $subject" >> "$TMP_DIR/$mod.txt"
    fi
  done < <(git show --name-only --pretty=format: "$hash")
done < <({ git log --reverse --pretty=format:'%H|%ad|%s' --date=short; echo; })

for m in Personnel-Records VisitX Accreditation Frontend Infrastructure BMAD-Process; do
  target="obsidian-vault/$m/Changelog.md"
  if [ -s "$TMP_DIR/$m.txt" ]; then
    {
      echo ""
      echo "## История (git log)"
      echo ""
      cat "$TMP_DIR/$m.txt"
    } >> "$target"
  else
    {
      echo ""
      echo "## История (git log)"
      echo ""
      echo "_Коммитов, задевающих этот модуль, пока не найдено._"
    } >> "$target"
  fi
done

echo "Done. Line counts:"
for m in Personnel-Records VisitX Accreditation Frontend Infrastructure BMAD-Process; do
  echo "  $m: $(wc -l < "obsidian-vault/$m/Changelog.md")"
done

# --- Verification: no commit silently dropped ---------------------------
# Union every hash written to any module's changelog and diff it against
# the full set of commit hashes in git log. The only hashes allowed to be
# missing are true no-diff commits (e.g. empty merges) whose
# `git show --name-only` prints no paths at all, so the inner path loop
# never runs and no SEEN entry is ever recorded for them.
ALL_HASHES=$(mktemp)
WRITTEN_HASHES=$(mktemp)
EMPTY_HASHES=$(mktemp)
trap 'rm -rf "$TMP_DIR" "$ALL_HASHES" "$WRITTEN_HASHES" "$EMPTY_HASHES"' EXIT

git log --pretty=format:'%H' | sort -u > "$ALL_HASHES"

grep -ho '`[0-9a-f]\{8\}`' obsidian-vault/*/Changelog.md 2>/dev/null \
  | tr -d '`' > "$TMP_DIR/short_hashes.txt" || true
# Expand each written short hash back to full via git rev-parse, dedup.
if [ -s "$TMP_DIR/short_hashes.txt" ]; then
  sort -u "$TMP_DIR/short_hashes.txt" | while read -r sh; do
    git rev-parse "$sh"
  done | sort -u > "$WRITTEN_HASHES"
else
  : > "$WRITTEN_HASHES"
fi

# Commits with zero touched paths (e.g. empty merges) are legitimately
# never written to any changelog.
git log --pretty=format:'%H' | while read -r h; do
  if [ -z "$(git show --name-only --pretty=format: "$h")" ]; then
    echo "$h"
  fi
done | sort -u > "$EMPTY_HASHES"

MISSING=$(comm -23 "$ALL_HASHES" "$WRITTEN_HASHES" | comm -23 - "$EMPTY_HASHES")
if [ -n "$MISSING" ]; then
  echo "VERIFY FAILED: commits missing from all changelogs (not empty merges):"
  echo "$MISSING"
  exit 1
else
  echo "Verify OK: every non-empty commit is present in at least one module's Changelog.md."
fi
