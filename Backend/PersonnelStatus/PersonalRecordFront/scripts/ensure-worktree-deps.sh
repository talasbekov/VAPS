#!/usr/bin/env bash
set -euo pipefail

front_root="${FRONT_DEPS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
profile="${1:-all}"
cd "$front_root"

case "$profile" in
  playwright)
    required=(
      "node_modules/@playwright/test/package.json"
      "node_modules/.bin/playwright"
    )
    ;;
  next)
    required=(
      "node_modules/next/package.json"
      "node_modules/next/dist/compiled/jest-worker/processChild.js"
      "node_modules/.bin/next"
    )
    ;;
  build)
    required=(
      "node_modules/next/package.json"
      "node_modules/next/dist/compiled/jest-worker/processChild.js"
      "node_modules/typescript/bin/tsc"
      "node_modules/.bin/next"
      "node_modules/.bin/tsc"
    )
    ;;
  all)
    required=(
      "node_modules/@playwright/test/package.json"
      "node_modules/next/package.json"
      "node_modules/next/dist/compiled/jest-worker/processChild.js"
      "node_modules/typescript/bin/tsc"
      "node_modules/.bin/playwright"
      "node_modules/.bin/next"
      "node_modules/.bin/tsc"
    )
    ;;
  *)
    printf 'Unknown frontend dependency profile: %s (expected playwright, next, build or all)\n' "$profile" >&2
    exit 64
    ;;
esac

if [[ ! -f package.json || ! -f package-lock.json ]]; then
  printf 'package.json and package-lock.json are required in %s\n' "$front_root" >&2
  exit 1
fi

manifest_fingerprint() {
  node -e '
    const crypto = require("crypto");
    const fs = require("fs");
    const hash = crypto.createHash("sha256");
    for (const path of process.argv.slice(1)) {
      hash.update(fs.readFileSync(path));
      hash.update("\\0");
    }
    process.stdout.write(hash.digest("hex"));
  ' "$front_root/package.json" "$front_root/package-lock.json"
}

fingerprint="$(manifest_fingerprint)"
fingerprint_file="node_modules/.worktree-manifests.sha256"

dependencies_ready() {
  local path saved_fingerprint=""
  if [[ -f "$fingerprint_file" ]]; then
    saved_fingerprint="$(tr -d '\r\n' < "$fingerprint_file")"
  fi
  [[ "$saved_fingerprint" = "$fingerprint" ]] || return 1
  for path in "${required[@]}"; do
    [[ -f "$path" ]] || return 1
  done
}

if dependencies_ready; then
  exit 0
fi

lock="${DEPS_INSTALL_LOCK:-$front_root/.worktree-deps-install.lock}"
wait_limit="${DEPS_LOCK_WAIT:-600}"
poll_interval="${DEPS_LOCK_POLL:-1}"
owner_token="${DEPS_LOCK_OWNER:-$$:$(date +%s)}"
lock_owned=0
stage=""
backup=""

cleanup() {
  if [[ -n "$backup" && -e "$backup" && ! -e "$front_root/node_modules" ]]; then
    mv "$backup" "$front_root/node_modules"
  fi
  if [[ -n "$stage" && -d "$stage" ]]; then
    rm -rf -- "$stage"
  fi
  if (( lock_owned == 1 )) && [[ "$(head -n 1 "$lock/owner" 2>/dev/null || true)" = "$owner_token" ]]; then
    rm -rf -- "$lock"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

waited=0
until mkdir "$lock" 2>/dev/null; do
  stale_pid="$(sed -n 's/^pid=//p' "$lock/owner" 2>/dev/null | head -n 1)"
  if [[ -n "$stale_pid" ]] && ! kill -0 "$stale_pid" 2>/dev/null; then
    printf '[deps] abandoned install lock from pid %s removed\n' "$stale_pid" >&2
    rm -rf -- "$lock"
    continue
  fi
  if (( waited >= wait_limit )); then
    printf '[deps] dependency install is busy: %s\n' "$(tr '\n' ' ' < "$lock/owner" 2>/dev/null || printf 'owner unknown')" >&2
    exit 75
  fi
  if (( waited == 0 )); then
    printf '[deps] another process is restoring this worktree; waiting up to %s seconds\n' "$wait_limit" >&2
  fi
  sleep "$poll_interval"
  waited=$((waited + poll_interval))
done
lock_owned=1
printf '%s\npid=%s\nstarted=%s\n' "$owner_token" "$$" "$(date '+%F %T')" > "$lock/owner"

# The process ahead of us may already have completed the same installation.
if dependencies_ready; then
  exit 0
fi

missing=()
for path in "${required[@]}"; do
  if [[ ! -f "$path" ]]; then
    missing+=("$path")
  fi
done
if [[ -f "$fingerprint_file" ]]; then
  installed_fingerprint="$(tr -d '\r\n' < "$fingerprint_file")"
else
  installed_fingerprint="missing"
fi

printf 'Frontend dependencies need restoration in %s (profile %s):\n' "$front_root" "$profile" >&2
if (( ${#missing[@]} > 0 )); then
  printf '  - %s\n' "${missing[@]}" >&2
fi
if [[ "$installed_fingerprint" != "$fingerprint" ]]; then
  printf '  - package.json/package-lock.json fingerprint differs (%s)\n' "$installed_fingerprint" >&2
fi

# Install beside the live tree. A registry/cache failure therefore cannot
# destroy a node_modules directory that a running server or browser uses.
stage="$(mktemp -d "$front_root/.worktree-deps-stage.XXXXXX")"
cp package.json package-lock.json "$stage/"
if [[ -f .npmrc ]]; then
  ln -s "$front_root/.npmrc" "$stage/.npmrc"
fi

set +e
(
  cd "$stage" || exit 1
  npm ci --prefer-offline --no-audit --no-fund
)
npm_status=$?
set -e
if (( npm_status != 0 )); then
  printf 'npm ci failed with status %s; existing node_modules was preserved\n' "$npm_status" >&2
  exit "$npm_status"
fi

for path in "${required[@]}"; do
  staged_path="$stage/node_modules/${path#node_modules/}"
  if [[ ! -f "$staged_path" ]]; then
    printf 'npm ci completed, but required file is still missing: %s\n' "$path" >&2
    exit 1
  fi
done
printf '%s\n' "$fingerprint" > "$stage/node_modules/.worktree-manifests.sha256"

backup="$front_root/.worktree-deps-backup.$$"
had_previous=0
if [[ -e node_modules || -L node_modules ]]; then
  mv node_modules "$backup"
  had_previous=1
fi
if ! mv "$stage/node_modules" node_modules; then
  if (( had_previous == 1 )); then
    mv "$backup" node_modules
  fi
  printf 'Could not activate the restored node_modules; previous tree was restored\n' >&2
  exit 1
fi
if (( had_previous == 1 )); then
  rm -rf -- "$backup"
fi
backup=""

printf '[deps] worktree dependencies restored from package-lock.json\n' >&2
