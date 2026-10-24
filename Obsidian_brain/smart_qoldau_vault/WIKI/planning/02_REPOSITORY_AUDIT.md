# 02 — Аудит репозитория (AS-IS, факты)

Статус: готов · Дата: 2026-09-13 · Источник истины: код в `main` (HEAD `310dde3` = `96d2887` main без диффа), не документация.
Связано: [[03_AS_IS_ARCHITECTURE]], [[04_FEATURE_INVENTORY]], [[15_QUALITY_GATES]], [[16_RISKS_QUESTIONS_AND_ADRS]].

## 1. Снимок состояния

| Параметр | Значение |
|---|---|
| Репозиторий | `https://github.com/talasbekov/smart_qoldau`, локально `/home/erda/Музыка/smart_qoldau` |
| Ветка / HEAD | `feature/premium-prices-from-api` @ `310dde3` — содержимое идентично `main` (`git diff main --stat` пуст) |
| `git status --short` | пусто на старте и после аудита |
| Ветки | 13 локальных `feature/*`, **все смержены в main**; `remotes/origin/claude/gallant-haibt-965a79` — отдельный worktree в `.claude/worktrees/` |
| История | 327 коммитов, 2026-08-19 → 2026-09-02; один автор (владелец) с ИИ-исполнителем |
| Удалённые каталоги в истории | `landing/` → переименован в `web/` (`5640250`, git mv, история сохранена); `brain` (симлинк на хранилище Obsidian) удалён `33a5f15` 2026-09-01; каталоги frontend/mobile никогда не удалялись |

## 2. Проверка предварительных сведений брифа (§4)

| Утверждение брифа | Статус | Доказательство |
|---|---|---|
| В корне только `backend/` и `infra/`, web и mobile нет | **CONTRADICTED** | `git ls-tree main`: `admin/ app_client/ app_expert/ backend/ docs/ infra/ packages/ web/` |
| Backend — NestJS + TypeScript | CONFIRMED | `backend/package.json`: `@nestjs/core ^11`, Express 5 |
| Prisma + PostgreSQL | CONFIRMED | `backend/prisma/schema.prisma` (905 строк), 30 миграций |
| Redis для realtime/таймеров/очередей | CONFIRMED | `src/presence/presence.service.ts` (set+hash presence), `src/requests/offer-timer.service.ts`, throttler storage `@nest-lab/throttler-storage-redis`, `@socket.io/redis-adapter` |
| MinIO для документов | CONFIRMED | `src/storage/storage.service.ts` (`@aws-sdk/client-s3`, три бакета: документы, аватары, контент) |
| Socket.IO для realtime | CONFIRMED | `src/ws/events.gateway.ts` namespace `/ws` |
| LiveKit для аудио/видео | CONFIRMED | `src/media/media.service.ts`, `livekit-webhook.controller.ts` |
| JWT + SMS-коды | CONFIRMED | `src/auth/*`; плюс гость по `deviceId`, плюс отдельная идентичность сотрудников (`AdminUser`, email+пароль+TOTP) — брифом не упомянута |
| Swagger/OpenAPI | CONFIRMED | `/v1/docs` (`SWAGGER_ENABLED`), дамп `docs/openapi.json` (108 путей, 123 операции) |
| Unit- и e2e-тесты | CONFIRMED | 45 unit-наборов (191 тест), 101 e2e-набор |
| Docker Compose | CONFIRMED | `infra/docker-compose.{dev,prod,stand}.yml` + `nginx.stand.conf` |
| CI: миграции, lint, unit, e2e | PARTIALLY CONFIRMED | `.github/workflows/backend.yml` делает всё это, **но** `lint` = `eslint --fix` (мутирующий), а сервисов MinIO в CI нет, хотя `StorageService.onModuleInit` требует S3 (см. §7) |
| Root README не соответствует структуре | CONFIRMED | README перечисляет `backend/ infra/ brain/ docs/ .github/` — нет `web/ admin/ app_*/ packages/`, ссылка на `brain/` мёртвая |
| `backend/README.md` — стандартный NestJS | CONFIRMED | шапка с логотипом Nest; ниже есть проектные разделы («Границы приёма данных»), но файл начинается с бойлерплейта |
| `brain/` и `docs/` могут отсутствовать | PARTIALLY | `docs/` есть (прототип v1, `openapi.json`, `deeplinks.md`); `brain/` в дереве нет — это отдельный репозиторий Obsidian (`smart_qoldau_vault`) |
| Модули Auth…Redis | CONFIRMED + OUTDATED | все перечисленные есть, плюс 17 не перечисленных: `account, admin, booking, content, devices, ledger, maintenance, notifications, payments, payouts, premium, reviews, tickets, cli, common, config` |
| Prisma: User, Expert, Request, RequestCandidate, Consultation, ChatMessage, ExpertNote, Review | CONFIRMED + OUTDATED | плюс 24 модели денег, уведомлений, админки, тикетов, подписок, контента (см. [[03_AS_IS_ARCHITECTURE]] §4) |
| Индексы raw SQL | CONFIRMED | 5 частичных уникальных индексов в миграциях (§7 таблица) |
| Связи без FK — осознанно | CONFIRMED | комментарии в `schema.prisma` у `Favorite`, `Consultation`, `PaymentMethod`, `Device`, `Ticket`: «сознательно БЕЗ FK, join вручную» |
| Матчинг: конкуренция, дедлайны, broadcast, инварианты | CONFIRMED | `requests.service.ts` (45/20 с), `escalation.service.ts` (120/300 с), тесты `matching-accept-race`, `request-emergency`, `request-timers` |
| Шифрование чата AES-256-GCM серверное, не E2E | CONFIRMED | `src/chat/message-cipher.ts`: ключ `CHAT_ENCRYPTION_KEY` из env, сервер шифрует и расшифровывает → **application-level / server-side encryption at rest**, не end-to-end |

## 3. Карта репозитория

| Путь | Назначение | Точка входа / runtime | Владелец ответственности | Тесты | Документация | Проблемы | Действие |
|---|---|---|---|---|---|---|---|
| `backend/` | API + WebSocket + бизнес-логика (модульный монолит NestJS 11) | `src/main.ts` → `bootstrap.ts`, Node 22/24, порт 3000, префикс `/v1` | API | 45 unit / 101 e2e | `backend/README.md` (частично бойлерплейт), Swagger | lint-дрейф 66 prettier-ошибок в 19 файлах; unit-спеки `prisma/*`, `storage/*`, `audit` требуют живых Postgres/MinIO/Redis (это интеграционные тесты под именем unit) | KEEP + HARDEN |
| `backend/prisma/` | схема, 30 миграций, seed (темы) | `npx prisma migrate deploy`, `prisma db seed` | API | `test/*schema*` | комментарии в схеме — образцовые | — | KEEP |
| `backend/test/` | 101 e2e-набор (supertest + socket.io-client, виртуальное время `ClockService`) | `npm run test:e2e` (heap 8 ГБ) | API | — | `jest-e2e.json` | требует Postgres 5433 + Redis + **MinIO** | KEEP |
| `backend/loadtest/` | сценарий 500 экспертов / 200 сессий | `npm run loadtest` | API | — | `loadtest/README.md`, `OUTPUT/2026-08-26-нагрузочный-тест.md` | — | KEEP |
| `backend/scripts/dump-openapi.ts`, `src/cli/*` | дамп OpenAPI, сид суперадмина, ручная верификация эксперта | `npm run openapi:dump / admin:seed / expert:verify` | API | — | README backend | `openapi:dump` пишет в отслеживаемый `docs/openapi.json` — генерация типов веба зависит от свежести | KEEP |
| `web/` | Next.js 15 (App Router, next-intl ru/kz): публичный сайт (лендинг, каталог, профили, темы, материалы, Premium, юрстраницы, поддержка), кабинет клиента, кабинет эксперта, BFF | `next start` (standalone), порт 3000; `middleware.ts` | WEB | 64 Jest + 7 Playwright | `web/README.md` (частично устарел: описывает «лендинг», цену 2 990) | нет `.well-known` для deep links (`docs/deeplinks.md` требует); README устарел | KEEP + HARDEN |
| `admin/` | Vite + React 19 SPA сотрудников: вход/TOTP, верификация, модерация профилей, флаг <4.0, модерация отзывов, тикеты, выплаты, контент, сотрудники, настройки(TOTP) | `vite`, порт 5173; `VITE_API_BASE_URL` вшивается в бандл | ADMIN | 28 Vitest | `admin/README.md` | нет дашборда, клиентов, финансов, жалоб, B2B/B2G, рассылок (прототип v2); токены в `localStorage` | KEEP + HARDEN (расширять по прототипу v2) |
| `app_client/` | Flutter-приложение клиента (iOS/Android; web-сборка выключена) | `lib/main.dart`, `lib/router.dart` (go_router, 33 маршрута) | APP-CLIENT | 62 widget/unit + 1 integration | `android/README-build.md` | 8 TODO; iOS ни разу не собирался; `web/` каталог остался | KEEP + HARDEN |
| `app_expert/` | Flutter-приложение эксперта | `lib/main.dart`, `lib/router.dart` (23 маршрута) | APP-EXPERT | 29 + 1 integration | — | `linux/ macos/ windows/ web/` каталоги-заготовки без применения | KEEP + HARDEN (RETIRE лишние платформенные каталоги после решения) |
| `packages/shared/` | Dart-пакет: `SqApi` (Dio) с контрактным тестом по OpenAPI, freezed-модели, socket.io-шина, `CallEngine` (LiveKit), пуши (Firebase), разрешения, дизайн-токены, виджеты, аналитика PostHog | библиотека | SHARED (mobile) | 41 | комментарии в pubspec | — | KEEP |
| `infra/` | compose dev/prod/stand, nginx стенда, `.env.prod.example`, README с обоснованиями | `docker compose -f …` | INFRA | — | `infra/README.md` (хороший) | нет TLS/бэкапов/мониторинга/LiveKit prod (осознанно, задокументировано) | KEEP + HARDEN |
| `docs/` | прототип **v1** (92 файла), `openapi.json`, `deeplinks.md` | — | DOCS | — | — | прототип v1 устарел относительно v2 в хранилище; `.well-known`-требования deeplinks не выполнены | HARDEN (обновить на v2 после решения владельца) |
| `.github/workflows/` | 5 workflow: backend, web, admin, app_client(+shared), app_expert(+shared) | GitHub Actions | INFRA | — | — | backend lint мутирующий; нет MinIO; статус прогонов недоступен офлайн (UNKNOWN) | HARDEN |
| `_bmad/`, `_bmad-output/`, `.claude/skills/bmad-*` | инструментарий BMAD (308 КБ), не используется (по решению владельца работа идёт через superpowers) | — | — | — | — | мёртвый вес в репозитории | RETIRE (после подтверждения владельца) |
| `.claude/worktrees/gallant-haibt-965a79` | worktree облачной сессии на `96d2887` (= main) | — | — | — | — | локальный артефакт, в git не входит | RETIRE локально |
| `CLAUDE.md` | правила: прототип, `ui-ux-pro-max`, учёт в Obsidian/Plane/Todoist, TDD | — | — | — | — | ссылается на `docs/Прототип/` (v1) и «92 экрана» — после v2 устареет | HARDEN |
| `README.md` (корень) | обзор | — | — | — | — | OUTDATED (см. §2) | HARDEN |

## 4. Приложения и единицы развёртывания

| Единица | Образ / артефакт | Сборка | Раздача (стенд) | Обязательные внешние сервисы |
|---|---|---|---|---|
| API | `smartqoldau-backend` (`backend/Dockerfile`, multi-stage, `USER node`, ~840 МБ) | `nest build` | `proxy → backend:3000` (`/v1/`, `/socket.io/`) | PostgreSQL 16, Redis 7 (appendonly), S3/MinIO (3 бакета), LiveKit, SMS (Mobizon, `dev` в dev), push (mock; боевого FCM-адаптера нет), платёжный/payout провайдер (mock) |
| migrate | тот же образ, `prisma migrate deploy` одноразово | — | — | PostgreSQL |
| WEB | `smartqoldau-web` (`web/Dockerfile`, standalone) | `next build` | `proxy → web:3000` (`/`) | API по внутреннему имени (`API_BASE_URL` runtime) |
| ADMIN | `smartqoldau-admin` (`admin/Dockerfile`, nginx) | `tsc -b && vite build` (адрес API — build-arg) | `proxy → admin:80` (`/admin/`) | API (CORS `ADMIN_ORIGINS`) |
| APP-CLIENT / APP-EXPERT | APK (debug собраны 2026-08-26), iOS — не собирался | `flutter build apk` (нужен JDK 21, compileSdk 37) | сторы (не опубликовано) | API, FCM (mock на бэкенде), LiveKit |

[FACT] На машине владельца запущен боевой контур пилота (`smartqoldau-*` контейнеры из `docker-compose.prod.yml` + `stand.yml`, порт 8080) — он не затрагивался аудитом.

## 5. Инструментарий и скрипты

| Пакет | Скрипты | Замечания |
|---|---|---|
| backend | `build, start*, lint(--fix!), test, test:e2e (DATABASE_URL 5433, THROTTLE_ENABLED=false, heap 8 ГБ), openapi:dump, admin:seed, expert:verify, loadtest` | Jest unit: `rootDir=src`, `maxWorkers 50 %`, timeout 15 с |
| web | `dev, build, start, lint (next lint), test (jest), api:generate (openapi:dump → openapi-typescript → lib/api/generated.ts), e2e (playwright), start:standalone` | `generated.ts` актуален (содержит `/experts/me/clients`, `/earnings/daily`, `/premium/plans`, `/me/expert-visibility`) |
| admin | `dev, build, preview, lint, test (vitest)` | — |
| app_client / app_expert / shared | `flutter analyze`, `flutter test`, `build_runner`, `gen-l10n` (CI проверяет, что кодоген закоммичен) | без корневого оркестратора: 6 независимых lock-файлов, npm workspaces не используются (осознанно, `web/README.md`) |

## 6. Тесты — инвентаризация

| Пакет | Unit/widget | Integration/e2e | Что покрыто (по именам наборов) |
|---|---|---|---|
| backend | 45 наборов / 191 тест | 101 набор | auth (guest/code/verify), account-delete, admin (auth/2fa/lockout/session/staff/verification/lifecycle), booking (create/cancel/reschedule/money/lifecycle), chat, consultations (create/complete/lifecycle/access-log), content (list/paywall/progress/admin), cors, devices, errors, experts (profile/documents/heartbeat/status/schedule/photo/about/public/pagination/clients/visibility-consent/reviews), favorites, health, ledger, limits, matching (accept-race/fairness/lifecycle/online-count/perf/scoring-batch), media, money-lifecycle, notifications (center/chat/dispatch/domain/lifecycle), offer-push-fallback, openapi, outbox, payments (methods/hold/settle/sweep), payouts (+admin), premium (charge/discount/priority/renewal/subscribe), profile-moderation, request (emergency/flow/timers), retention, reviews (+moderation/tags), scheduled (schema/sweep), slots, sms-fallback-budget, throttling, tickets (admin/assignment/create/notifications/reply-author), topics |
| web | 64 Jest | 7 Playwright (`a11y, cabinet, catalog, expert, login, materials`) — против живого стенда | компоненты кабинетов, BFF-маршруты (session/verify-code/proxy/realtime token), CSRF, i18n |
| admin | 28 Vitest | — | страницы, API-обёртки, tokenStore, RoleGate, SLA |
| app_client | 62 | 1 (`integration_test`, играет роль эксперта через `dio`) | — |
| app_expert | 29 | 1 | — |
| packages/shared | 41 (в т.ч. контрактный тест `SqApi` по `docs/openapi.json`) | — | — |

Регресс, заявленный в LOG 2026-09-02: бэкенд 191 unit + 529 e2e, веб 298 Jest + 19 Playwright, админка 74, shared 270, app_client 361, app_expert 110 (числа тестов, не наборов).

## 7. Baseline (немутирующий прогон 2026-09-13)

Команды и условия — в [[15_QUALITY_GATES]] §1; логи — scratchpad сессии. Инфраструктура: `infra/docker-compose.dev.yml` сервисы `postgres_test` (5433), `redis`, `minio` (поднят позже старта, см. ниже).

| Шаг | Команда | Результат | Доверие |
|---|---|---|---|
| Prisma schema | `npx prisma validate` | OK | высокое |
| Backend build | `npm run build` | OK (5 с) | высокое |
| Backend lint без `--fix` | `npx eslint "{src,apps,libs,test}/**/*.ts"` | **66 ошибок, все `prettier/prettier`, 19 файлов** (account/consent*, experts/clients*, dto expert-*, payments/daily-earnings*, earnings.controller, payments.service, premium*.controller, ws/redis-io.adapter.spec, test/expert-clients.e2e-spec) — код последних коммитов E16/E17 не отформатирован; CI этого не видит, потому что `npm run lint` = `eslint --fix` | высокое |
| Backend unit (1-й прогон, до миграции тестовой БД и без MinIO) | `npm test -- --ci` | 34 passed / 11 failed наборов: `prisma/*.spec` (таблиц нет), `storage/*.spec` (ECONNREFUSED :9000), `audit.service.spec` — **интеграционные тесты под именем unit** | средняя (ошибка окружения) |
| Миграции + сид тестовой БД | `prisma migrate deploy`, `prisma db seed` | OK | высокое |
| Backend e2e (1-й прогон) | `npm run test:e2e -- --ci` | **все наборы упали при старте приложения: `ECONNREFUSED 127.0.0.1:9000`** — `StorageService.onModuleInit → ensureBucket` требует S3 | высокое: e2e невозможны без MinIO |
| Backend unit + e2e (2-й прогон с MinIO) | те же | см. дополнение §7.1 ниже | — |
| web lint / unit / build; admin lint / unit / build; flutter analyze/test ×3; compose config | по скрипту baseline | см. дополнение §7.1 | — |
| `git status --short` после прогона | — | пусто (сборочные артефакты `dist/ .next/ build/` в `.gitignore`) | высокое |

[RISK] `.github/workflows/backend.yml` не поднимает MinIO, а приложение при старте требует бакеты → либо e2e в CI падают с 2026-08-23 (когда появился `ensureBucket` аватаров/контента), либо CI не запускался; статус прогонов Actions офлайн проверить не удалось (`gh` без авторизации) — **UNKNOWN, проверить первым делом** (см. [[14_ROADMAP_AND_BACKLOG]] E18).

### 7.1 Дополнение по второму прогону (с MinIO, 18:33–19:11)

| Шаг | Результат |
|---|---|
| Backend unit с инфраструктурой | **45/45 наборов, 191/191 тестов** |
| Backend e2e с MinIO | **98/100 наборов, 525/529 тестов, 38 мин**; упали `content-admin` и `content-list` (4 теста): тесты ожидают пустую таблицу материалов, а `prisma db seed` засевает 8 — дефект изоляции тестов, не кода (E18-3) |
| web lint / unit / build | OK / 58 наборов, 298 тестов / OK |
| admin lint / unit / build | OK / 28 файлов, 74 теста / OK |
| flutter test shared / app_client / app_expert | 271 / 363 / 110 пройдено |
| `flutter analyze --no-pub` | падение analysis-server в неинтерактивном режиме (не ошибки кода); `dart analyze` ×3 — **No issues found** |
| compose config dev / prod | OK / OK |
| `git status --short` | пусто |

Полная таблица команд — [[15_QUALITY_GATES]] §1.

## 8. Несоответствия документации и кода

| # | Источник | Расхождение | Статус |
|---|---|---|---|
| D-1 | `README.md` | структура без `web/ admin/ app_*/ packages/`, мёртвая ссылка `brain/`, «Быстрый старт» без веба/админки | OUTDATED |
| D-2 | `backend/README.md` | шапка NestJS-бойлерплейта | OUTDATED (частично) |
| D-3 | `web/README.md` | «Известные ограничения»: цена Premium 2 990 (сейчас 4 990 из `GET /v1/premium/plans`), ссылки на несуществующие разделы | OUTDATED |
| D-4 | `CLAUDE.md` | прототип `docs/Прототип/` (v1, 92 экрана); владелец 2026-09-13 назвал эталоном v2 (113) | OUTDATED после решения |
| D-5 | `docs/deeplinks.md` | требует `/.well-known/assetlinks.json` и `apple-app-site-association` от веба — в `web/` их нет | NOT FOUND (долг) |
| D-6 | `WIKI/ТЗ MVP` §5.6, PRD P1 | цена Premium 2 990/23 900 против решения 2026-09-02 (4 990/39 900) и кода `premium.constants.ts` | CONTRADICTED (ТЗ не обновлено) |
| D-7 | `WIKI/ТЗ MVP` §2 «Вне MVP: веб-версия клиента» | реализована E16-B | OUTDATED |
| D-8 | `WIKI/ТЗ MVP` §4.1 «имя/контакты не передаются эксперту никогда» | Р-27 (E17): имя передаётся с согласия | CONTRADICTED (ТЗ не обновлено, E17-8 у владельца) |
| D-9 | Прототип v2 (RAW) | вводит правила, которых нет ни в ТЗ, ни в коде (тарифы специалистов, отмены 50 %, жалобы, B2B/B2G, коридор 15–35 тыс. ₸, Premium без скидки) | CONTRADICTED — см. [[16_RISKS_QUESTIONS_AND_ADRS]] Q-01…Q-14 |
| D-10 | `infra/README.md`, `WIKI/Готовность к пилоту` | «в репозитории нет Dockerfile» — устарело: Dockerfile есть у backend/web/admin | OUTDATED (в WIKI) |

## 9. Мёртвый и неиспользуемый код

| Что | Доказательство | Действие |
|---|---|---|
| `_bmad/`, `_bmad-output/`, `.claude/skills/bmad-*` | не упоминаются ни в скриптах, ни в CI; память владельца: bmad не использовать | RETIRE (вопрос владельцу Q-17) |
| `app_expert/{linux,macos,windows}/`, `app_client/web/`, `app_expert/web/` | Flutter Web выключен E16-13 (`nginx.stand.conf`: «сборки Flutter Web выключены»); desktop-сборок нет ни в CI, ни в планах | RETIRE после решения |
| TODO/FIXME | backend 4, web 6, app_client 8, app_expert 3, admin 0, shared 0 | HARDEN: перевести в задачи или закрыть |
| Крупнейшие файлы | `consultations.service.ts` 752, `requests.service.ts` 653, `payments.service.ts` 602, `tickets.service.ts` 527 строк | кандидаты на SPLIT при следующем касании, не «ради красоты» |

## 10. Отсутствующие части (по коду, не по мнению)

- `.well-known` файлы для deep links (D-5).
- Боевой push-адаптер (FCM/APNs): `PUSH_PROVIDER=mock`, боевого нет (`src/notifications/provider/`).
- Боевой платёжный и payout-провайдер: `PAYMENT_PROVIDER=mock`.
- Сущности прототипа v2: Complaint, B2B/B2G Contract, Tariff, Mailing — в схеме отсутствуют.
- Экспорт данных пользователя (`GET /v1/me/export`) — нет; удаление есть.
- iOS-сборка, публикация в сторах, TestFlight.
- TLS-терминация, бэкапы томов, мониторинг/алерты (осознанно вне репозитория, но обязательны к пилоту).
- Корневой оркестратор проверок (Makefile/скрипт), единый `docs/planning` в репозитории (этот пакет живёт в хранилище по решению владельца).
