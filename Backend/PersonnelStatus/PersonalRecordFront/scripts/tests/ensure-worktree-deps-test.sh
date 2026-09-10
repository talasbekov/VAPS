#!/usr/bin/env bash
set -u

script_root="$(cd "$(dirname "$0")/.." && pwd)"
subject="$script_root/ensure-worktree-deps.sh"
runner="$script_root/run-with-worktree-deps.sh"
failed=0

check() {
  local what="$1" want="$2" got="$3"
  if [ "$want" = "$got" ]; then
    printf '  ✓ %s\n' "$what"
  else
    printf '  ✘ %s\n      ждали: %s\n      вышло: %s\n' "$what" "$want" "$got"
    failed=$((failed + 1))
  fi
}

line_count() {
  local path="$1"
  if [ -f "$path" ]; then
    wc -l < "$path"
  else
    printf '0\n'
  fi
}

fixture_root="$(mktemp -d)" || exit 1
trap 'rm -rf "$fixture_root"' EXIT

make_project() {
  local name="$1"
  local root="$fixture_root/$name"
  mkdir -p "$root/fake-bin"
  printf '{"name":"deps-test","private":true}\n' > "$root/package.json"
  printf '{"name":"deps-test","lockfileVersion":3,"packages":{"":{"name":"deps-test"}}}\n' > "$root/package-lock.json"
  cat > "$root/fake-bin/npm" <<'EOF'
#!/usr/bin/env bash
set -u
printf '%s\n' "$$" >> "$FAKE_NPM_CALLS"
if [ "${FAKE_NPM_SLEEP:-0}" != 0 ]; then
  sleep "$FAKE_NPM_SLEEP"
fi
if [ "${FAKE_NPM_FAIL:-0}" = 1 ]; then
  exit 42
fi
mkdir -p \
  node_modules/@playwright/test \
  node_modules/next/dist/compiled/jest-worker \
  node_modules/typescript/bin \
  node_modules/.bin
printf '{}\n' > node_modules/@playwright/test/package.json
printf '{}\n' > node_modules/next/package.json
printf '// worker\n' > node_modules/next/dist/compiled/jest-worker/processChild.js
printf '#!/bin/sh\n' > node_modules/typescript/bin/tsc
cat > node_modules/.bin/playwright <<'EOF_PLAYWRIGHT'
#!/bin/sh
printf 'playwright:%s\n' "$*"
EOF_PLAYWRIGHT
printf '#!/bin/sh\n' > node_modules/.bin/next
printf '#!/bin/sh\n' > node_modules/.bin/tsc
chmod +x node_modules/.bin/playwright node_modules/.bin/next node_modules/.bin/tsc
EOF
  chmod +x "$root/fake-bin/npm"
  printf '%s\n' "$root"
}

run_ensure() {
  local root="$1" profile="$2"
  shift 2
  FRONT_DEPS_ROOT="$root" \
    DEPS_INSTALL_LOCK="$root/.test-install.lock" \
    DEPS_LOCK_WAIT=10 \
    PATH="$root/fake-bin:$PATH" \
    "$@" \
    bash "$subject" "$profile"
}

echo 'ensure-worktree-deps.sh:'

# 1. Профиль Playwright не должен требовать Next/TypeScript.
profile_root="$(make_project profile)"
calls="$profile_root/npm-calls"
mkdir -p "$profile_root/node_modules/@playwright/test" "$profile_root/node_modules/.bin"
printf '{}\n' > "$profile_root/node_modules/@playwright/test/package.json"
printf '#!/bin/sh\n' > "$profile_root/node_modules/.bin/playwright"
chmod +x "$profile_root/node_modules/.bin/playwright"
fingerprint="$(node -e 'const fs=require("fs"),c=require("crypto");const h=c.createHash("sha256");for(const p of process.argv.slice(1)){h.update(fs.readFileSync(p));h.update("\\0")}process.stdout.write(h.digest("hex"))' "$profile_root/package.json" "$profile_root/package-lock.json")"
printf '%s\n' "$fingerprint" > "$profile_root/node_modules/.worktree-manifests.sha256"
FAKE_NPM_CALLS="$calls" run_ensure "$profile_root" playwright
check 'Playwright не переустанавливается из-за отсутствующего Next' '0' "$(line_count "$calls")"

# 2. Изменение package-lock/package.json обязано запустить npm ci.
printf ' \n' >> "$profile_root/package-lock.json"
FAKE_NPM_CALLS="$calls" run_ensure "$profile_root" playwright
check 'новый lock-файл вызывает одну установку' '1' "$(line_count "$calls")"

# 3. package.json и .bin также часть целостности.
rm -f "$profile_root/node_modules/.bin/playwright"
FAKE_NPM_CALLS="$calls" run_ensure "$profile_root" playwright
check 'пропавший .bin/playwright восстанавливается' '2' "$(line_count "$calls")"
printf ' \n' >> "$profile_root/package.json"
FAKE_NPM_CALLS="$calls" run_ensure "$profile_root" playwright
check 'изменённый package.json вызывает установку' '3' "$(line_count "$calls")"

# 4. Два одновременных запуска делят один npm ci и повторно проверяют состояние после lock.
parallel_root="$(make_project parallel)"
parallel_calls="$parallel_root/npm-calls"
FAKE_NPM_CALLS="$parallel_calls" FAKE_NPM_SLEEP=1 run_ensure "$parallel_root" build >"$parallel_root/one.log" 2>&1 &
one=$!
FAKE_NPM_CALLS="$parallel_calls" FAKE_NPM_SLEEP=1 run_ensure "$parallel_root" build >"$parallel_root/two.log" 2>&1 &
two=$!
wait "$one"; one_status=$?
wait "$two"; two_status=$?
check 'оба параллельных вызова успешны' '0:0' "$one_status:$two_status"
check 'параллельные вызовы делают один npm ci' '1' "$(line_count "$parallel_calls")"

# 5. Неудачная/сетевая установка не разбирает существующий node_modules.
failure_root="$(make_project failure)"
failure_calls="$failure_root/npm-calls"
mkdir -p "$failure_root/node_modules"
printf 'keep-me\n' > "$failure_root/node_modules/existing-sentinel"
set +e
FAKE_NPM_CALLS="$failure_calls" FAKE_NPM_FAIL=1 run_ensure "$failure_root" playwright >"$failure_root/failure.log" 2>&1
failure_status=$?
set -e
check 'ошибка npm ci возвращается вызывающему' '42' "$failure_status"
check 'прежний node_modules сохранён при ошибке' 'keep-me' "$(cat "$failure_root/node_modules/existing-sentinel" 2>/dev/null)"

# 6. Wrapper восстанавливает зависимости ДО прямого Playwright-запуска и передаёт ему аргументы.
wrapper_root="$(make_project wrapper)"
wrapper_calls="$wrapper_root/npm-calls"
set +e
wrapper_output="$(
  FRONT_DEPS_ROOT="$wrapper_root" \
    DEPS_INSTALL_LOCK="$wrapper_root/.test-install.lock" \
    FAKE_NPM_CALLS="$wrapper_calls" \
    PATH="$wrapper_root/fake-bin:$PATH" \
    bash "$runner" playwright playwright --list 2>/dev/null
)"
wrapper_status=$?
set -e
check 'wrapper завершается кодом Playwright' '0' "$wrapper_status"
check 'wrapper запускает восстановленный .bin/playwright' 'playwright:--list' "$wrapper_output"
check 'wrapper выполняет npm ci один раз' '1' "$(line_count "$wrapper_calls")"

if [ "$failed" -gt 0 ]; then
  printf 'ensure-worktree-deps.sh: провалено проверок — %s\n' "$failed"
  exit 1
fi
printf 'ensure-worktree-deps.sh: все проверки пройдены\n'
