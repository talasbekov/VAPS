# Стенд в контуре (Story 7.0)

Минимальный, ПОСТОЯННО работающий мини-вариант VAPS внутри контура (сеть без
выхода наружу), где реально живут данные донора. Не прод-топология 12.1 —
специально урезан (без nginx-фронта, без Celery — в проекте его нет), но
использует ТОТ ЖЕ офлайн bundle-путь (`docker load` из `.tar`, без `build:`),
что и [спайк 1.9](../spike-1.9/), — ранняя проверка пути 12.2–12.3 в миниатюре.

**Прецедент:** [`../spike-1.9/`](../spike-1.9/) — контур-проба пути носителя
(одна nginx-страница-маркер). Этот стенд наследует паттерн скрипта
(`install-*.sh` с явными «сюрпризами → RUNBOOK.md»), но поднимает полную
мини-топологию: `db` + `redis` + `backend` (uvicorn/ASGI).

## Состав

- `docker-compose.yml` — db (Postgres 16) + redis (channel layer для WS) + backend (uvicorn)
- `.env.example` — шаблон переменных окружения (скопировать в `.env`, заполнить, НЕ коммитить)
- `install-stand.sh` — sha256-проверка → `docker load` → `docker compose up -d` → `migrate`
- `systemd/vaps-parallel-run-diff.{service,timer}` — ночной запуск diff-джобы (Story 6.9) внутри стенда

## Установка на целевом сервере контура

> **Физическая установка на реальном сервере контура — операционное
> действие вне этого репозитория.** Ниже — runbook для исполнения на месте
> (Bratan/инфра-команда); из dev-окружения проверяется локально (`docker
> compose up` идемпотентен, планировщик триггерит команду вручную/по
> расписанию в тестовом прогоне) — реальный контур недоступен агенту.

1. Перенести на носитель: `docker-compose.yml`, `.env` (заполненный), `.tar`-образ(ы) backend, `sha256sums.txt`.
2. `./install-stand.sh` — sha256 → `docker load` → `docker compose up -d` → `migrate --noinput`.
   Любой неожиданный сбой скрипт печатает как `⚠ СЮРПРИЗ → ВПИСАТЬ В RUNBOOK.md` и продолжает диагностику — вписать в раздел «Сюрпризы» ниже.
3. Проверить здоровье: `curl http://127.0.0.1:8000/api/parallel-run/health/` — должен вернуть `{"status": "ok", ...}`.
4. Установить планировщик (см. `systemd/`):
   ```bash
   sudo cp systemd/vaps-parallel-run-diff.{service,timer} /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now vaps-parallel-run-diff.timer
   ```
   Расписание — правка `OnCalendar=` в `.timer` (не хардкод в коде команды).
5. Ручная выгрузка снимка на носитель (без сети): `docker compose exec backend python manage.py export_stand_snapshot`.

## Обновление стенда

Тот же bundle-путь: новый `.tar` + новый `sha256sums.txt` → повторный
`./install-stand.sh` (идемпотентен: `docker load` перегружает образ,
`docker compose up -d` пересоздаёт изменившиеся контейнеры, `migrate`
безопасен для повторного запуска).

## Сюрпризы (вести по факту установки, как в спайке 1.9)

_(заполняется на месте — антивирус карантинит .tar? политика блокирует .sh?
порт занят? docker/sha256sum отсутствует? см. `install-probe.sh` спайка 1.9
как образец формата.)_
