#!/usr/bin/env bash
# Story 12.5 — интерактивный проводник деплой-репетиции по CHECKLIST.md.
# НЕ исполняет команды за оператора (Решение №1: репетиция ПРОЦЕДУРЫ — человек
# делает руками, скрипт ведёт, требует явного ответа и хронометрирует).
# Шаги = секции B–C чеклиста; --first-time добавляет секцию A в начало.
# ID шагов (A1…C6) синхронизированы с ../CHECKLIST.md — правки только синхронно.
#
# Ответы на шаг:
#   y            — выполнено
#   n            — провал (после подтверждения репетиция останавливается, exit 1)
#   s <причина>  — пропуск ТОЛЬКО с непустой причиной
# Пустой ввод / «Enter = да» не принимаются — вопрос повторяется.
#
# Лог: INSTALL_DIR/rehearsals/deploy-rehearsal-<UTC-ts>.log — пишется ПО ХОДУ
# (прерванная репетиция оставляет честный частичный журнал со строкой INTERRUPTED).
set -Eeuo pipefail

INSTALL_DIR="${INSTALL_DIR:-$(cd "$(dirname "$0")" && pwd)}"

# Ревью 12.5: неизвестный аргумент — ошибка, не молчание (опечатка в --first-time
# давала бы «урезанную» репетицию с зелёным вердиктом без секции A).
FIRST_TIME=0
if [ "$#" -gt 1 ]; then
  echo "Использование: bash deploy-rehearsal.sh [--first-time]" >&2; exit 2
fi
case "${1:-}" in
  "") ;;
  --first-time) FIRST_TIME=1 ;;
  *) echo "Неизвестный аргумент: '$1'. Использование: bash deploy-rehearsal.sh [--first-time]" >&2; exit 2 ;;
esac

# ── шаги: "ID|текст" (единственный источник; зеркало CHECKLIST.md) ──────────
STEPS_A=(
  "A1|Docker установлен на сервере контура, версия записана в чеклист"
  "A2|Базовые образы загружены: docker load -i postgres-16.tar и -i redis-7-alpine.tar (НЕ в бандле 12.2)"
  "A3|Install-каталог создан, compose и скрипты (install/smoke/backup/restore) на месте"
  "A4|.env доставлен ОТДЕЛЬНО от бандла и заполнен по .env.example"
  "A5|systemd-юниты vaps-backup.{service,timer} установлены и включены"
)
STEPS_BC=(
  "B1|bash bundle.sh отработал; тег релиза записан в шапку чеклиста"
  "B2|PINNED-SHA переписан НА БУМАГУ из sha256sums-<тег>.txt и сверен посимвольно"
  "B3|Состав носителя сверен чекбоксами (tar/manifest/sums/compose/скрипты/юниты/чеклист)"
  "B4|Носитель передан несущему; ФИО несущего записано в шапке"
  "C1|Версия БЫЛО записана: cat installed-tag (пусто = первичная)"
  "C2|sha256sum -c по обоим файлам — ЦЕЛ (провал = СТОП до изменений)"
  "C3|bash install.sh <тег> <sha-с-бумаги-B2> — зелёный финал"
  "C4|bash smoke.sh зелёный"
  "C5|Версия СТАЛО записана: cat installed-tag == тег рейса"
  "C6|ls backups/ALERT-* пуст (утро после первой ночи); секция D чеклиста заполнена по ходу"
)
STEPS=()
if [ "$FIRST_TIME" -eq 1 ]; then STEPS+=("${STEPS_A[@]}"); fi
STEPS+=("${STEPS_BC[@]}")

TS="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_DIR="${INSTALL_DIR}/rehearsals"
# -$$: два запуска в одну секунду не сливают журналы в один файл (ревью 12.5).
LOG_FILE="${LOG_DIR}/deploy-rehearsal-${TS}-$$.log"
mkdir -p "$LOG_DIR"

_log() { printf '%s\n' "$*" >>"$LOG_FILE"; }

CUR_ID="-"
_interrupted() {
  # INT/TERM/EOF: честная строка в журнал, СВОЙ код выхода; сводка не печатается.
  local sig="${1:-INT}" code="${2:-130}"
  _log "$(date -u +%FT%TZ) INTERRUPTED at ${CUR_ID} (${sig})" || true
  echo "" >&2
  echo "Репетиция прервана (${sig}) на шаге ${CUR_ID}. Лог: ${LOG_FILE}" >&2
  exit "$code"
}
trap '_interrupted INT 130' INT
trap '_interrupted TERM 143' TERM

echo "=== VAPS deploy-rehearsal (Story 12.5) ==="
echo "Лог: ${LOG_FILE}"
# Шапка пишется ДО вопросов: прерывание на первом же вопросе оставляет валидный лог.
_log "# VAPS deploy-rehearsal"
_log "started_utc: $(date -u +%FT%TZ)"
read -r -p "Кто проводит репетицию (ФИО): " OPERATOR || _interrupted EOF 130
read -r -p "Релиз-тег репетиции (или '-' если без бандла): " REL_TAG || _interrupted EOF 130
[ -n "$OPERATOR" ] || OPERATOR="(не назван)"
[ -n "$REL_TAG" ] || REL_TAG="-"

_log "operator: ${OPERATOR}"
_log "release_tag: ${REL_TAG}"
_log "first_time: ${FIRST_TIME}"
_log "steps_total: ${#STEPS[@]}"
_log "---"

START_TOTAL=$SECONDS
N_OK=0; N_SKIP=0; N_FAIL=0
SKIPPED=()   # "ID|причина"
FAILED_ID=""

for entry in "${STEPS[@]}"; do
  CUR_ID="${entry%%|*}"
  text="${entry#*|}"

  echo ""
  echo "[${CUR_ID}] ${text}"
  step_start=$SECONDS
  while :; do
    read -r -p "  [${CUR_ID}] выполнено? (y / n / s <причина>): " answer || _interrupted EOF 130
    case "$answer" in
      y|Y|yes|да|Да)
        dur=$((SECONDS - step_start))
        _log "$(date -u +%FT%TZ) ${CUR_ID} OK (${dur}s) — ${text}"
        N_OK=$((N_OK + 1)); break ;;
      n|N|no|нет|Нет)
        read -r -p "  Провал шага ${CUR_ID} — завершить репетицию с FAIL? (y/n): " confirm || _interrupted EOF 130
        case "$confirm" in
          y|Y|yes|да|Да)
            dur=$((SECONDS - step_start))
            _log "$(date -u +%FT%TZ) ${CUR_ID} FAIL (${dur}s) — ${text}"
            N_FAIL=1; FAILED_ID="$CUR_ID"; break ;;
          *) echo "  Ок, возвращаемся к шагу ${CUR_ID}." ;;
        esac ;;
      s|"s "*|S|"S "*)
        reason="${answer#? }"
        [ "$reason" != "$answer" ] || reason=""
        reason="$(printf '%s' "$reason" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
        if [ -z "$reason" ]; then
          echo "  Пропуск требует причину: s <причина>. Повторите."
          continue
        fi
        dur=$((SECONDS - step_start))
        _log "$(date -u +%FT%TZ) ${CUR_ID} SKIP (${dur}s) — причина: ${reason} — ${text}"
        N_SKIP=$((N_SKIP + 1)); SKIPPED+=("${CUR_ID}|${reason}"); break ;;
      *)
        echo "  Не понял. Ответ: y — выполнено, n — провал, s <причина> — пропуск." ;;
    esac
  done
  if [ "$N_FAIL" -eq 1 ]; then break; fi
done

CUR_ID="-"
TOTAL_DUR=$((SECONDS - START_TOTAL))

# NOT-REACHED для недойденных шагов при провале
if [ "$N_FAIL" -eq 1 ]; then
  seen_fail=0
  for entry in "${STEPS[@]}"; do
    id="${entry%%|*}"
    if [ "$seen_fail" -eq 1 ]; then
      _log "$(date -u +%FT%TZ) ${id} NOT-REACHED — ${entry#*|}"
    fi
    [ "$id" = "$FAILED_ID" ] && seen_fail=1
  done
fi

_log "---"
if [ "$N_FAIL" -eq 1 ]; then
  verdict="REHEARSAL FAIL на шаге ${FAILED_ID}"
  exit_code=1
elif [ "$N_SKIP" -gt 0 ]; then
  verdict="REHEARSAL INCOMPLETE (${N_SKIP} skipped)"
  exit_code=1
else
  verdict="REHEARSAL OK"
  exit_code=0
fi
# Перечень пропусков — ДО вердикта: verdict — финальная строка журнала (ревью 12.5).
if [ "${#SKIPPED[@]}" -gt 0 ]; then
  for s in "${SKIPPED[@]}"; do
    _log "skipped: ${s%%|*} — ${s#*|}"
  done
fi
_log "TOTAL ${N_OK} OK / ${N_SKIP} SKIP / ${N_FAIL} FAIL, duration ${TOTAL_DUR}s"
_log "verdict: ${verdict}"

echo ""
echo "=== ${verdict} ==="
echo "Шагов OK: ${N_OK}, пропущено: ${N_SKIP}, провалено: ${N_FAIL}; длительность: ${TOTAL_DUR}s"
if [ "${#SKIPPED[@]}" -gt 0 ]; then
  echo "Пропущенные шаги (чеклист НЕ заполнен без пропусков):"
  for s in "${SKIPPED[@]}"; do
    echo "  - ${s%%|*}: ${s#*|}"
  done
fi
echo "Лог: ${LOG_FILE}"
exit "$exit_code"
