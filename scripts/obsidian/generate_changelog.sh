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
while IFS='|' read -r hash date subject; do
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
done < <(git log --reverse --pretty=format:'%H|%ad|%s' --date=short)

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
