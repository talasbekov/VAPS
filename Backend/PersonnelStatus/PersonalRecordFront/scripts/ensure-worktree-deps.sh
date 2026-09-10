#!/usr/bin/env bash
set -euo pipefail

front_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$front_root"

required=(
  "node_modules/@playwright/test/package.json"
  "node_modules/next/package.json"
  "node_modules/next/dist/compiled/jest-worker/processChild.js"
  "node_modules/typescript/bin/tsc"
)

missing=()
for path in "${required[@]}"; do
  if [[ ! -f "$path" ]]; then
    missing+=("$path")
  fi
done

if (( ${#missing[@]} == 0 )); then
  exit 0
fi

printf 'Frontend dependencies are incomplete in %s:\n' "$front_root" >&2
printf '  - %s\n' "${missing[@]}" >&2
printf 'Restoring this worktree from package-lock.json with npm ci.\n' >&2
npm ci --prefer-offline --no-audit --no-fund

for path in "${required[@]}"; do
  if [[ ! -f "$path" ]]; then
    printf 'npm ci completed, but required file is still missing: %s\n' "$path" >&2
    exit 1
  fi
done
