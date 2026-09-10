#!/usr/bin/env bash
set -euo pipefail

front_root="${FRONT_DEPS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
profile="${1:-all}"
bootstrap=0
if [[ "${2:-}" = "--bootstrap" ]]; then
  bootstrap=1
elif [[ -n "${2:-}" ]]; then
  printf 'Unknown dependency option: %s (expected --bootstrap)\n' "$2" >&2
  exit 64
fi
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

# A running Next/Playwright process can resolve new modules at any moment.
# Replacing its directory underneath it produces intermittent ENOENT. Existing
# trees therefore require an explicit bootstrap performed after consumers stop;
# a genuinely new worktree (no node_modules yet) remains self-bootstrapping.
if [[ -e node_modules || -L node_modules ]] && (( bootstrap == 0 )); then
  printf 'Frontend dependencies do not match this worktree; existing node_modules will not be replaced automatically.\n' >&2
  printf 'Stop frontend consumers, then run: npm run deps:bootstrap\n' >&2
  exit 78
fi

lock="${DEPS_INSTALL_LOCK:-$front_root/.worktree-deps-install.lock}"
wait_limit="${DEPS_LOCK_WAIT:-600}"
poll_interval="${DEPS_LOCK_POLL:-1}"
ownerless_grace="${DEPS_OWNERLESS_GRACE:-5}"
owner_token="$$.$(date +%s).${RANDOM:-0}"
owner_file="$lock/owner.$owner_token"
lock_owned=0
stage=""
backup=""
stale_claim=""

cleanup() {
  if [[ -n "$backup" && -e "$backup" && ! -e "$front_root/node_modules" ]]; then
    mv "$backup" "$front_root/node_modules"
  fi
  if [[ -n "$stage" && -d "$stage" ]]; then
    rm -rf -- "$stage"
  fi
  if [[ -n "$stale_claim" && -f "$stale_claim" ]]; then
    rm -f -- "$stale_claim"
  fi
  if (( lock_owned == 1 )) && [[ -f "$owner_file" ]]; then
    rm -f -- "$owner_file"
    rmdir "$lock" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

waited=0
until mkdir "$lock" 2>/dev/null; do
  current_owner="$(find "$lock" -maxdepth 1 -type f -name 'owner.*' -print -quit 2>/dev/null || true)"
  if [[ -n "$current_owner" ]]; then
    stale_pid="$(sed -n 's/^pid=//p' "$current_owner" 2>/dev/null | head -n 1 || true)"
    if [[ -n "$stale_pid" ]] && ! kill -0 "$stale_pid" 2>/dev/null; then
      # Claim the exact token file observed above. A contender that read the
      # same dead owner cannot move a later owner's differently named token.
      stale_claim="${lock}.stale-owner.${owner_token}"
      if mv "$current_owner" "$stale_claim" 2>/dev/null; then
        if rmdir "$lock" 2>/dev/null; then
          printf '[deps] abandoned install lock from pid %s recovered\n' "$stale_pid" >&2
          rm -f -- "$stale_claim"
          stale_claim=""
          continue
        fi
        rm -f -- "$stale_claim"
        stale_claim=""
      fi
    fi
  else
    if lock_mtime="$(stat -c %Y "$lock" 2>/dev/null)"; then
      :
    elif lock_mtime="$(stat -f %m "$lock" 2>/dev/null)"; then
      :
    else
      lock_mtime="$(date +%s)"
    fi
    lock_age=$(( $(date +%s) - lock_mtime ))
    # rmdir is the compare-and-remove operation here: it succeeds only while
    # the directory is still ownerless. If its creator publishes a token, the
    # directory becomes non-empty and cannot be removed by this contender.
    if (( lock_age >= ownerless_grace )) && rmdir "$lock" 2>/dev/null; then
      printf '[deps] abandoned ownerless install lock recovered\n' >&2
      continue
    fi
  fi
  if (( waited >= wait_limit )); then
    if [[ -n "$current_owner" ]]; then
      owner_description="$(tr '\n' ' ' < "$current_owner" 2>/dev/null || printf 'owner unknown')"
    else
      owner_description="owner not published yet"
    fi
    printf '[deps] dependency install is busy: %s\n' "$owner_description" >&2
    exit 75
  fi
  if (( waited == 0 )); then
    printf '[deps] another process is restoring this worktree; waiting up to %s seconds\n' "$wait_limit" >&2
  fi
  sleep "$poll_interval"
  waited=$((waited + poll_interval))
done
lock_owned=1
printf '%s\npid=%s\nstarted=%s\n' "$owner_token" "$$" "$(date '+%F %T')" > "$owner_file"

# The process ahead of us may already have completed the same installation.
if dependencies_ready; then
  exit 0
fi

if [[ -e node_modules || -L node_modules ]] && (( bootstrap == 0 )); then
  printf 'Frontend dependencies changed while waiting; refusing to replace an existing node_modules.\n' >&2
  printf 'Stop frontend consumers, then run: npm run deps:bootstrap\n' >&2
  exit 78
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
