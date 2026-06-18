#!/usr/bin/env bash
# Спайк 1.9 — установка пробы на СТОРОНЕ КОНТУРА (или offline-реплики, путь B).
# Прото-install.sh + smoke.sh (минимальная механика для 12.3); БЕЗ бэкапа / migrate / отката N-1 / smoke по API — это E12.
#
# Запускать ИЗ каталога с перенесёнными файлами (.tar, sha256sums.txt, docker-compose.yml).
# Любой сюрприз по ходу (антивирус карантинит .tar? политика блокирует запуск .sh? порт закрыт?)
# — НЕМЕДЛЕННО вписать в RUNBOOK.md. В этом ценность спайка для 12.7.
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="vaps-probe:spike-1.9"
export PORT="${PORT:-8080}"   # export: чтобы дочерний `docker compose` интерполировал ${PORT} в проброс порта (а не только в печатаемый URL)

echo "[1/5] Проверка целостности архива (sha256) — битый/изменённый архив => СТОП до изменений..."
sha256sum -c sha256sums.txt

TAR="$(awk '{print $2}' sha256sums.txt | head -n1)"
echo "[2/5] docker load -i ${TAR}  (offline: ничего не тянется из сети)..."
docker load -i "${TAR}"

echo "[3/5] docker compose up -d  (offline: образ уже загружен docker load, в compose нет build: → реестр не трогается)..."
docker compose up -d

echo "[4/5] Наблюдение ВРЕМЕНИ (секция «Время» рунбука; задел для спайка 3.13 «часы без NTP»):"
echo "  date (хост):        $(date)"
echo "  date -u (UTC):       $(date -u)"
if command -v timedatectl >/dev/null 2>&1; then
  timedatectl | sed 's/^/    /'
else
  echo "    timedatectl недоступен — зафиксировать в RUNBOOK.md (tz/NTP выяснить вручную)"
fi
echo "  date в контейнере:   $(docker compose exec -T probe date 2>/dev/null || echo '<exec недоступен — записать в рунбук>')"

# '|| true': без 'hostname -I' (BusyBox/locked-down/старый util-linux) pipefail+set -e
# иначе рушит скрипт ДО печати LAN-URL; ниже срабатывает fallback ${IP:-<IP-сервера>}
# (ревью спайка 1.9, пр.3 — благоприятный сюрприз не должен быть жёстким сбоем).
IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
echo "[5/5] LAN-URL — ОТКРЫТЬ С КЛИЕНТСКОЙ машины в Firefox ~100:"
echo "  http://${IP:-<IP-сервера>}:${PORT}/"
echo
echo "ВАЖНО: 'curl http://localhost:${PORT}' с этого же сервера НЕ доказывает LAN-доступ"
echo "       (firewall/порт/IP). Доказательство — страница-маркер, открытая С ОТДЕЛЬНОГО клиентского ПК."
echo "Остановить пробу:  docker compose down"
