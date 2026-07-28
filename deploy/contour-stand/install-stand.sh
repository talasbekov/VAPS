#!/usr/bin/env bash
# Story 7.0 — установка минимального стенда в контуре. Прямой наследник
# паттерна ../spike-1.9/install-probe.sh (образ из .tar, offline, никакого
# `build:`), расширен на полную мини-топологию (db+redis+backend) и миграции.
#
# Запускать ИЗ каталога с перенесёнными файлами (.tar, sha256sums.txt,
# docker-compose.yml, .env). Любой сюрприз — вписать в RUNBOOK.md (см. README.md).
set -euo pipefail
cd "$(dirname "$0")"

test -f .env || { echo "✗ .env отсутствует — скопировать .env.example → .env и заполнить"; exit 1; }
set -a; source .env; set +a

SURPRISE=0
note_surprise() { SURPRISE=1; echo "  ⚠ СЮРПРИЗ → ВПИСАТЬ В RUNBOOK.md: $1"; }

echo "[1/4] Проверка целостности архива (sha256)..."
if [ ! -s sha256sums.txt ]; then
  SHA_OK=0
  note_surprise "sha256sums.txt отсутствует или пуст — нечего грузить (docker load ПРОПУЩЕН)"
elif sha256sum -c sha256sums.txt; then
  SHA_OK=1
else
  SHA_OK=0
  note_surprise "sha256 не совпал ИЛИ .tar отсутствует/недоступен (docker load ПРОПУЩЕН)"
fi

UP_OK=0
if [ "$SHA_OK" -eq 1 ]; then
  echo "[2/4] docker load из перечисленных в sha256sums.txt архивов (offline)..."
  LOAD_OK=1
  while read -r _ tarfile; do
    [ -z "${tarfile:-}" ] && continue
    docker load -i "${tarfile}" || LOAD_OK=0
  done < sha256sums.txt
  if [ "$LOAD_OK" -eq 1 ]; then
    echo "[3/4] docker compose up -d (без build: — образы уже загружены)..."
    if docker compose up -d; then
      UP_OK=1
    else
      note_surprise "docker compose up упал — порт занят? нет прав? docker compose отсутствует/старый?"
    fi
  else
    note_surprise "docker load упал — docker отсутствует/не в PATH/нет прав? битый образ внутри .tar?"
  fi
else
  echo "[2/4] docker load — ПРОПУЩЕН."
  echo "[3/4] docker compose up — ПРОПУЩЕН."
fi

if [ "$UP_OK" -eq 1 ]; then
  echo "[4/4] Миграции (идемпотентно при повторном запуске)..."
  docker compose exec -T backend python manage.py migrate --noinput || \
    note_surprise "migrate упал — см. логи backend (docker compose logs backend)"
  HEALTH_OUT="$(docker compose exec -T backend python3 -c 'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:8000/api/parallel-run/health/", timeout=3).read().decode())' 2>/dev/null || echo '<недоступен>')"
  echo "Health: ${HEALTH_OUT}"
else
  echo "[4/4] Миграции — ПРОПУЩЕНЫ (стенд не поднят)."
fi

if [ "$SURPRISE" -eq 1 ]; then
  echo
  echo "ИТОГ: ⚠ были сюрпризы (см. выше) — внести в RUNBOOK.md перед повтором. Exit 1."
  exit 1
fi
echo
echo "ИТОГ: ✓ стенд поднят. Следующий шаг — установить планировщик: см. README.md, раздел «Установка на целевом сервере контура», шаг 4."
