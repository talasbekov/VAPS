#!/usr/bin/env bash
# Story 12.3 — smoke после установки/отката: живость всех HTTP-поверхностей
# через nginx. БЕЗ секретов: «health» = каждый контекст отвечает <500,
# «логин» = негативная auth-проба (мусорный Bearer → 401/403, НЕ 5xx) —
# Решение №2 стори: полный логин требует живого JWT-издателя, которого у
# smoke нет и быть не должно; истинный вход оператора — 12.7/12.8.
#
# Запросы идут БЕЗ Origin-заголовка — cross-origin guard nginx (12.1) их
# не касается; 401/403 здесь — ответ ПРИЛОЖЕНИЯ, т.е. цепочка жива.
#
# Использование: smoke.sh [BASE_URL]   (дефолт http://localhost:${VAPS_HTTP_PORT:-8080})
set -Eeuo pipefail

BASE_URL="${1:-http://localhost:${VAPS_HTTP_PORT:-8080}}"
FAILED=0

# Прелюдия готовности: smoke зовётся сразу после `compose up -d`, а nginx
# (без healthcheck) биндится не мгновенно — без ожидания первые пробы ловят
# обрыв соединения на живой системе (поймано живым прогоном 12.3).
# Ждём именно 200 от `/` (статика nginx), а не «любой ответ» — 5xx-заглушка
# не должна пробивать ожидание (ревью 12.3). 30с бюджета; не дождались —
# пробы ниже честно зафиксируют FAIL.
for _ in $(seq 1 30); do
  ready_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "${BASE_URL}/" || true)"
  if [ "$ready_code" = "200" ]; then
    break
  fi
  sleep 1
done

# probe <описание> <ожидание> <url> [curl-доп-аргументы]
# ожидание: "eq200" | "lt500" | "auth" (строго 401)
probe() {
  local label="$1" expect="$2" url="$3"; shift 3
  local code
  # curl при обрыве сам пишет '000' в -w и выходит ненулевым — || true, а не
  # || echo (дописывал бы второй код: артефакт «000000» первого прогона).
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@" "$url" || true)"
  [ -n "$code" ] || code=000
  local ok=0
  case "$expect" in
    eq200) [ "$code" = "200" ] && ok=1 ;;
    lt500) [ "$code" != "000" ] && [ "$code" -lt 500 ] && ok=1 ;;
    # Строго 401, НЕ 401|403 (ревью 12.3): мусорный Bearer при
    # сконфигурированном JWT даёт 401 от JWTAuthentication; 403 означал бы
    # «Bearer молча проигнорирован» (JWT НЕ сконфигурирован — misconfig
    # VAPS_DEBUG=1 в проде) — проба обязана такой мир КРАСНИТЬ.
    auth)  [ "$code" = "401" ] && ok=1 ;;
  esac
  if [ "$ok" = 1 ]; then
    echo "PASS  ${label} (${code})"
  else
    echo "FAIL  ${label} (${code}, ожидалось ${expect})"
    FAILED=1
  fi
}

echo "smoke: ${BASE_URL}"

# SPA + Django-поверхность (страница логина admin рендерится = Django и
# статика живы; сам логин НЕ выполняется).
probe "/ (SPA)"            eq200 "${BASE_URL}/"
probe "/admin/login/"      eq200 "${BASE_URL}/admin/login/"

# Каждый /api/<context>/ из config/urls.py — «жив и отвечает осмысленно»:
# 401/403/404 допустимы (auth/permissions работают), ≥500 и обрыв — провал.
for ctx in core operations audit notifications documents; do
  probe "/api/${ctx}/"     lt500 "${BASE_URL}/api/${ctx}/"
done

# Негативная auth-проба: мусорный Bearer обязан дать ровно 401 —
# штатный отказ JWTAuthentication. Не 5xx (цепочка не падает) и не 403
# (это значило бы, что Bearer молча проигнорирован = JWT не сконфигурирован).
probe "auth-проба (мусорный Bearer)" auth "${BASE_URL}/api/notifications/" \
  -H "Authorization: Bearer smoke-invalid-token"

if [ "$FAILED" = 1 ]; then
  echo "SMOKE: FAIL"
  exit 1
fi
echo "SMOKE: OK"
