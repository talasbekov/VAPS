# E18-6 — локальные проверки разработчика

Назначение: быстрый и честный запуск уже имеющихся проверок MVP. Это не
инструкция по приёмке релиза: полный GitHub Actions и полный зелёный backend e2e
в рамках E18 ещё не подтверждены.

Связано: [[2026-09-15-MVP-CONTINUATION]], [[15_QUALITY_GATES]],
[[14_ROADMAP_AND_BACKLOG]].

## Границы репозитория

Рабочий код находится в `/home/erda/Музыка/smart_qoldau` (проверено на
`main@2df1cc0`). Шесть пакетов: `backend/` (NestJS), `web/` (Next.js),
`admin/` (Vite/React), `app_client/` и `app_expert/` (Flutter),
`packages/shared/` (общий Dart-код). В аргументах скрипта мобильные пакеты
называются **`app-client`** и **`app-expert`**, не именами директорий с `_`.

Прототип v2 хранится в vault: `RAW/SmartQoldau (1)` (111 файлов на момент
проверки); это источник раскладок. Он не меняет без решения владельца денежные
правила, статусы и роли — см. [[2026-09-15-MVP-CONTINUATION]].

## Подготовка окружения — отдельно

`check-all.sh` намеренно не устанавливает зависимости. До проверки один раз
подготовьте нужные пакеты:

```bash
cd /home/erda/Музыка/smart_qoldau/backend && npm ci
cd /home/erda/Музыка/smart_qoldau/web && npm ci
cd /home/erda/Музыка/smart_qoldau/admin && npm ci
cd /home/erda/Музыка/smart_qoldau/packages/shared && flutter pub get
cd /home/erda/Музыка/smart_qoldau/app_client && flutter pub get
cd /home/erda/Музыка/smart_qoldau/app_expert && flutter pub get
```

`node_modules/` и `.dart_tool/` — runtime-артефакты окружения, а не изменение
исходников. Скрипт требует их наличия и запускает Flutter с `--no-pub`.
Генерация Dart-кода, миграции, seed и запуск сервисов также не являются его
действием; делать их следует отдельной, осознанной командой по задаче.

## Обычные проверки

Из корня репозитория:

```bash
scripts/check-all.sh
scripts/check-all.sh --package backend
scripts/check-all.sh --package app-client,shared
scripts/check-all.sh --package app-expert
```

Без аргументов проверяются все шесть пакетов. Для Node-пакетов это `npm run
lint` и unit-тесты; для Flutter — `flutter analyze --no-pub` и `flutter test
--no-pub`. Скрипт не выполняет e2e.

`lint` — проверка без изменения файлов. `lint:fix` существует только у
`backend` и может переписать форматирование:

```bash
cd /home/erda/Музыка/smart_qoldau/backend && npm run lint:fix
```

Не подменяйте им обычную проверку и перед коммитом смотрите `git diff`.

## Integration — только выделенные локальные сервисы

Это opt-in запуск backend `test:integration`, а не замена unit- или e2e-тестам:

```bash
cd /home/erda/Музыка/smart_qoldau
CHECK_ALL_DEDICATED_TEST_ENV=1 \
DATABASE_URL='postgresql://sq:sq@localhost:5433/smartqoldau_test' \
REDIS_URL='redis://localhost:6379' \
S3_ENDPOINT='http://localhost:9000' \
S3_ACCESS_KEY='…' S3_SECRET_KEY='…' \
S3_BUCKET_DOCUMENTS='…' S3_BUCKET_AVATARS='…' S3_BUCKET_CONTENT='…' \
scripts/check-all.sh --package backend --integration
```

Пример использует выделенные localhost-сервисы и тестовую БД; замените учётные
данные, порт и имена бакетов на свои выделенные тестовые значения. Требования
скрипта: `test` должно быть в имени БД (пути `DATABASE_URL`), а не просто в
произвольной части URL; `DATABASE_URL`, `REDIS_URL` и `S3_ENDPOINT` указывают
на `localhost`, `127.0.0.1` или `[::1]`; заданы все показанные `S3_*`
переменные. Скрипт не создаёт, не мигрирует, не seed'ит и не очищает сервисы —
миграции и подготовку пользователь выполняет отдельно.

Коды завершения: `0` — все выбранные проверки прошли; `1` — хотя бы одна
упала; `2` — нет команды/зависимости либо не выполнены условия integration;
`64` — неверный аргумент или `--integration` без backend. Если есть и падение,
и недоступная проверка, приоритет у `1`.

## Что сейчас делает CI

Workflow-файлы `.github/workflows/` подтверждают состав команд, но не являются
доказательством их недавнего успешного полного прогона. `backend.yml` ставит
зависимости, поднимает PostgreSQL/Redis/MinIO, затем выполняет миграции, seed,
lint, unit, integration и e2e. `web.yml` и `admin.yml` выполняют `npm ci`,
lint, тесты и build. `app_client.yml` и `app_expert.yml` делают `flutter pub
get`, при необходимости генерацию, проверку закоммиченного generated-кода,
analyze и test. Для локальной быстрой обратной связи используйте `check-all`;
для приёмки — отдельный подтверждённый прогон CI и требуемых e2e.
