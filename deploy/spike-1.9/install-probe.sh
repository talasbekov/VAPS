#!/usr/bin/env bash
# Спайк 1.9 — установка пробы на СТОРОНЕ КОНТУРА (или offline-реплики, путь B).
# Прото-install.sh + smoke.sh (минимальная механика для 12.3); БЕЗ бэкапа / migrate / отката N-1 / smoke по API — это E12.
#
# Запускать ИЗ каталога с перенесёнными файлами (.tar, sha256sums.txt, docker-compose.yml).
# Любой сюрприз по ходу (антивирус карантинит .tar? политика блокирует запуск .sh? порт закрыт?)
# — НЕМЕДЛЕННО вписать в RUNBOOK.md. В этом ценность спайка для 12.7.
#
# Ревью пр.7 (2026-06-19, решение Bratan — D1, вариант «точечные guard'ы»):
# ОЖИДАЕМЫЕ сюрпризы пути носителя (битый/карантиненный .tar, отсутствие docker/sha256sum,
# занятый порт) больше НЕ роняют скрипт сырым `set -e`-крашем — каждый печатает «⚠ СЮРПРИЗ →
# RUNBOOK» и пропускает зависимые шаги, НО наблюдение времени [4/5] (не зависит от docker)
# снимается в любом случае. В конце — exit 1, если были сюрпризы (прогон не «чист»). Раньше:
# timedatectl/exec/hostname были мягкими, а sha-чек/load/up — жёсткими; непоследовательность
# устранена, диагностический payload [4/5]/[5/5] больше не теряется на раннем сбое.
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="vaps-probe:spike-1.9"
export PORT="${PORT:-8080}"   # export: чтобы дочерний `docker compose` интерполировал ${PORT} в проброс порта (а не только в печатаемый URL)

SURPRISE=0
note_surprise() { SURPRISE=1; echo "  ⚠ СЮРПРИЗ → ВПИСАТЬ В RUNBOOK.md: $1"; }

echo "[1/5] Проверка целостности архива (sha256) — битый/изменённый/отсутствующий архив => НЕ грузим..."
if sha256sum -c sha256sums.txt; then
  SHA_OK=1
else
  SHA_OK=0
  note_surprise "sha256 не совпал ИЛИ .tar/sha256sums.txt отсутствует/недоступен — антивирус карантинит .tar? недонос носителем? битьё при копировании? нет sha256sum (BusyBox)? (docker load ПРОПУЩЕН — непроверенный архив не грузим)"
fi

UP_OK=0
if [ "$SHA_OK" -eq 1 ]; then
  TAR="$(awk '{print $2}' sha256sums.txt | head -n1)"
  echo "[2/5] docker load -i ${TAR}  (offline: ничего не тянется из сети)..."
  if docker load -i "${TAR}"; then
    echo "[3/5] docker compose up -d  (offline: образ уже загружен docker load, в compose нет build: → реестр не трогается)..."
    if docker compose up -d; then
      UP_OK=1
    else
      note_surprise "docker compose up упал — порт ${PORT} занят? нет прав? docker compose отсутствует/старый? (сюрприз-класс AC-1 «политики/firewall»: повторить с PORT=<свободный> ./install-probe.sh)"
    fi
  else
    note_surprise "docker load упал — docker отсутствует/не в PATH/нет прав (не в группе docker)? битый образ внутри .tar?"
  fi
else
  echo "[2/5] docker load — ПРОПУЩЕН (архив не прошёл проверку целостности, см. сюрприз выше)."
  echo "[3/5] docker compose up — ПРОПУЩЕН."
fi

echo "[4/5] Наблюдение ВРЕМЕНИ (секция «Время» рунбука; задел для спайка 3.13 «часы без NTP») — снимается ДАЖЕ при сбое выше:"
echo "  date (хост):        $(date)"
echo "  date -u (UTC):       $(date -u)"
if command -v timedatectl >/dev/null 2>&1; then
  timedatectl | sed 's/^/    /'
else
  echo "    timedatectl недоступен — зафиксировать в RUNBOOK.md (tz/NTP выяснить вручную)"
fi
if [ "$UP_OK" -eq 1 ]; then
  echo "  date в контейнере:   $(docker compose exec -T probe date 2>/dev/null || echo '<exec недоступен — записать в рунбук>')"
else
  echo "  date в контейнере:   <проба не поднята — н/д>"
fi

echo "[5/5] LAN-URL — ОТКРЫТЬ С КЛИЕНТСКОЙ машины в Firefox ~100:"
if [ "$UP_OK" -eq 1 ]; then
  # '|| true': без 'hostname -I' (BusyBox/locked-down/старый util-linux) pipefail+set -e
  # иначе рушит скрипт ДО печати LAN-URL; ниже срабатывает fallback ${IP:-<IP-сервера>}
  # (ревью спайка 1.9, пр.3 — благоприятный сюрприз не должен быть жёстким сбоем).
  IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  echo "  http://${IP:-<IP-сервера>}:${PORT}/"
  echo
  echo "ВАЖНО: 'curl http://localhost:${PORT}' с этого же сервера НЕ доказывает LAN-доступ"
  echo "       (firewall/порт/IP). Доказательство — страница-маркер, открытая С ОТДЕЛЬНОГО клиентского ПК."
  echo "Остановить пробу:  docker compose down"
else
  echo "  <проба НЕ поднята — см. сюрпризы выше; LAN-URL недоступен>"
fi

if [ "$SURPRISE" -eq 1 ]; then
  echo
  echo "ИТОГ: ⚠ были сюрпризы (см. выше) — ОБЯЗАТЕЛЬНО внести в RUNBOOK.md перед повтором. Exit 1."
  exit 1
fi
