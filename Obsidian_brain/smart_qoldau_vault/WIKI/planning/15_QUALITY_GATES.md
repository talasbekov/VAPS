# 15 — Качество: baseline, тестовая стратегия, DoR/DoD, гейты релиза

Статус: готов · Дата: 2026-09-13.
Связано: [[02_REPOSITORY_AUDIT]] §7, [[13_MIGRATION_PLAN]], [[18_AI_EXECUTION_RULES]].

## 1. Baseline 2026-09-13 (немутирующие команды)

Окружение: Node 24.13.0 / npm 11.6.2, Flutter stable (`~/dev/flutter`), Docker 29; тестовая инфраструктура `infra/docker-compose.dev.yml` (`postgres_test:5433`, `redis:6379`, `minio:9000`); `DATABASE_URL=postgresql://sq:sq@localhost:5433/smartqoldau_test`, `SMS_PROVIDER=dev`, `THROTTLE_ENABLED=false` (задаёт скрипт e2e). Зависимости не переустанавливались (`npm ci` пропущен: диск 98 %); lock-файлы не тронуты.

| # | Команда (cwd) | Результат | Комментарий |
|---|---|---|---|
| 1 | `npx prisma validate` (backend) | OK | |
| 2 | `npm run build` (backend) | OK, 5 с | |
| 3 | `npx eslint "{src,apps,libs,test}/**/*.ts"` (backend, без `--fix`) | **66 ошибок / 0 предупреждений, все `prettier/prettier`, 19 файлов** | CI использует `npm run lint` = `eslint --fix` → дрейф невидим |
| 4 | `npm test -- --ci` (backend) без инфраструктуры | 34/45 наборов | 11 наборов (`prisma/*`, `storage/*`, `audit`) требуют БД/MinIO |
| 5 | `npx prisma migrate deploy && npx prisma db seed` (тестовая БД) | OK | |
| 6 | `npm test -- --ci` (backend) с инфраструктурой | **45/45 наборов, 191/191 тестов** | |
| 7 | `npm run test:e2e -- --ci` (backend) **без MinIO** | 100/100 наборов упали при bootstrap (`ECONNREFUSED :9000`), Jest не завершился (открытые хэндлы) — остановлен вручную через 27 мин | e2e требуют S3 при старте приложения; в CI сервиса MinIO нет |
| 8 | `npm run test:e2e -- --ci` (backend) с MinIO | **98/100 наборов, 525/529 тестов, 38 мин** | упали `content-admin`, `content-list` (4 теста) — причина в §1.1 |
| 9 | `npm run lint` / `npm test -- --ci` / `npm run build` (web) | OK / **58 наборов, 298 тестов** / OK (19 с) | `next lint` немутирующий |
| 10 | `npm run lint` / `npm test` / `npm run build` (admin) | OK / **28 файлов, 74 теста** / OK | |
| 11 | `flutter test` (packages/shared, app_client, app_expert) | **271 / 363 / 110** пройдено | |
| 12 | `flutter analyze --no-pub` ×3 | rc=255 — падение analysis-server (`FormatException` в LSP-канале), не ошибки кода | воспроизводимо при неинтерактивном запуске |
| 13 | `dart analyze` ×3 | **No issues found** ×3 | |
| 14 | `docker compose -f docker-compose.dev.yml config -q`; `… prod.yml --env-file .env.prod.example config -q` | OK / OK | |
| 15 | Playwright (web) | **не запускался** — требует живого стенда с бэкендом; последний зафиксированный прогон 2026-09-02: 19 тестов зелёные | |
| 16 | `git status --short` после всех прогонов | пусто | |

Доверие к baseline: высокое для сборок/юнитов/e2e с инфраструктурой; среднее для Playwright и устройств (не прогонялись). Логи — scratchpad сессии (`baseline/*.log`), копии ключевых чисел — здесь.

### 1.1 Два упавших контентных e2e-набора
`content-admin.e2e-spec.ts:125` ожидает `GET /v1/content` длиной 0, получает 8 (материалы из `prisma/seed.ts`); `content-list.e2e-spec.ts:167,180` ожидает первым «Как справиться с тревогой», получает «Квадратное дыхание» (сидовый материал). Причина — тесты E13 написаны в предположении пустой таблицы, а сид контента добавлен позже; в CI сид тоже выполняется, значит эти наборы красные и там (если CI вообще доходит до e2e — см. MinIO). Дефект тестов, не продукта → E18-3: очистка/префикс в `beforeAll`.

Дополнительно: e2e без MinIO не запускаются вовсе (`StorageService.onModuleInit`), а при провале bootstrap Jest не завершается — E18-3/E18-5.

## 2. Тестовая стратегия

| Уровень | Где | Что обязательно | Инструмент |
|---|---|---|---|
| Unit | backend `src/**/*.spec.ts` (только без инфраструктуры), web/admin компоненты и чистые функции, Dart-модели/контроллеры | правила, форматирование, редьюсеры, шаблоны | Jest, Vitest, flutter_test |
| Integration | backend `test/integration` (новый профиль): Prisma-спеки, storage, audit, cipher с БД | инварианты БД (partial unique), шифрование, ретенция | Jest + docker |
| e2e API | backend `test/*.e2e-spec.ts` (101) | все переходы состояний, конкурентные сценарии (accept-race, slot-race, single-active), виртуальное время (таймеры, sweep, ретраи), вебхуки (подпись, дедуп), доступ чужого | supertest + socket.io-client + ClockService |
| Contract | `packages/shared` тест по OpenAPI; `contracts.yml` (drift `openapi.json` ↔ `generated.ts`); [TO-BE] схема WS-событий | совместимость клиентов | jest/dart |
| WebSocket | e2e с socket.io-client (`chat`, `matching-lifecycle`), unit `RedisIoAdapter` | ready, комнаты, chat.send/typing/error, дубли после reconnect | — |
| DB concurrency | `matching-accept-race`, `booking-create` (слот), `expert_single_active` | гонки | e2e |
| Migration | [TO-BE] прогон `migrate deploy` на копии дампа стенда перед релизом | обратимость | скрипт |
| UI component | web Jest+RTL (58 наборов), admin Vitest (28), Flutter widget (~500) | состояния экрана (loading/empty/error/forbidden) | — |
| Frontend integration | web BFF route-тесты, Flutter `integration_test` (1+1) | сквозные потоки | — |
| Browser e2e | Playwright (`a11y, cabinet, catalog, expert, login, materials`) против стенда | каталог → профиль → заявка → сессия; доступность axe | Playwright |
| Visual regression | [TO-BE] Playwright screenshots ключевых экранов | дизайн-система | после DS |
| Accessibility | axe в Playwright, ручной клавиатурный проход | WCAG AA | — |
| Performance | `backend/loadtest` (500 экспертов / 200 сессий; результаты 2026-08-26) | p95 подбора ≤ 5 с | ts-node |
| Security | ASVS-чеклист, `npm audit --omit=dev` [TO-BE в CI], сканер секретов [TO-BE] | — | — |
| Smoke / prod health | `GET /v1/health` (db, redis); [TO-BE] синтетический сценарий «гость → заявка → отмена» по расписанию | — | — |

### Пирамида критических потоков

| Поток | Unit | Integration/e2e | UI | Browser/устройство |
|---|---|---|---|---|
| Параллельный accept | scoring | `matching-accept-race` | OfferList | ручной на 2 устройствах |
| Истечение оффера / broadcast / callback | — | `request-timers`, `request-emergency` | таймер по `deadlineAt` | Playwright cabinet |
| Повторная доставка события / реконнект | `socket.test`, `sq_socket_test` | `chat` | [TO-BE] тест ресинка после `ready` | ручной (обрыв сети) |
| Потеря Redis | — | [TO-BE] e2e: рестарт Redis → офферы истекают по `deadlineAt`, presence восстанавливается heartbeat | — | стенд |
| Откат транзакции | — | `consultations-create` (unique), `payments-hold` | — | — |
| No-show / завершение | `no-show`, `settle` | `consultation-lifecycle`, `money-lifecycle` | Session/complete | — |
| Доступ к чужим данным | — | `chat`, `expert-notes`, [TO-BE] генерируемая матрица | forbidden-state | — |
| Шифрование / ротация | `message-cipher.spec` | [TO-BE] `keyVersion` | — | — |
| Upload validation | `file-signature` | `experts-documents`, `expert-photo` | ошибки формата | — |
| LiveKit webhook replay | — | `media` (+ [TO-BE] дедуп) | — | — |

## 3. Definition of Ready (история берётся в работу только если)

понятен пользователь и роль (R-*) · понятен outcome (одно предложение) · перечислены UI-состояния (loading/empty/error/forbidden/success) · определён API-контракт (эндпоинт, DTO, коды ошибок) или явно «API не меняется» · определены права (строка матрицы [[06_ROLES_AND_PERMISSIONS]]) · определены данные (модель/миграция, аддитивность) · описаны ошибки и их тексты ru/kz · указаны зависимости (эпики, решения Q-*) · есть проверяемые acceptance criteria · есть тестовый план по пирамиде · нет незакрытого `[QUESTION]`, влияющего на историю · для UI — экран прототипа v2 назван по ID реестра.

## 4. Definition of Done

acceptance criteria выполнены и продемонстрированы конкретным потоком · сборка всех затронутых пакетов · lint без `--fix` чист · unit зелёные · integration/e2e зелёные (в т.ч. новые) · права проверены тестом «чужой субъект» · loading/empty/error/forbidden реализованы · локализация ru/kz добавлена (ключи в обоих файлах, тест паритета) · доступность проверена (axe/клавиатура для веба, семантика для Flutter) · `openapi.json` перегенерирован и `generated.ts` совпадает · документация обновлена (README пакета, [[17_TRACEABILITY_MATRIX]], реестр экранов) · миграция аддитивна и есть путь отката · нет fake-кнопок и «скоро» · нет необработанных TODO (или заведены задачи) · запись в `LOG.md`, статус в Plane и Todoist.

## 5. Гейты релиза (Phase 6)

Все workflow зелёные · e2e с MinIO в CI · Playwright против стенда зелёные · ASVS-чеклист датирован текущим релизом · нагрузочный прогон повторён при изменении матчинга/денег · миграции прогнаны на копии дампа · бэкап/восстановление проверены · runbook поддержки обновлён · критерии ТЗ §11 (8) с отметкой «подтверждён на проде/устройстве» · юрдокументы актуальной версии опубликованы.
