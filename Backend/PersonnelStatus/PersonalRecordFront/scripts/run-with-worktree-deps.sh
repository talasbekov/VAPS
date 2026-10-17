#!/usr/bin/env bash
set -euo pipefail

if (( $# < 2 )); then
  printf 'Usage: %s <playwright|next|build|all> <command> [arguments...]\n' "$0" >&2
  exit 64
fi

profile="$1"
shift
script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
front_root="${FRONT_DEPS_ROOT:-$(cd "$script_root/.." && pwd)}"

bash "$script_root/ensure-worktree-deps.sh" "$profile"
export PATH="$front_root/node_modules/.bin:$PATH"
cd "$front_root"
exec "$@"
