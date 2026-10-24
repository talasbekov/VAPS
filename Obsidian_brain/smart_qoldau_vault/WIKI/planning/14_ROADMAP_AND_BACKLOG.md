# 14 — Дорожная карта и бэклог

Статус: готов (план; исполнение только после `PLAN APPROVED — START IMPLEMENTATION`) · Дата: 2026-09-13.
Нумерация эпиков продолжает мастер-план (E1–E17 закрыты, E0/E11 открыты). Сложность: S ≤ 1 дня, M ≤ 3, L ≤ 7, XL > 7 (ИИ-исполнение с ревью).
Связано: [[13_MIGRATION_PLAN]], [[15_QUALITY_GATES]], [[16_RISKS_QUESTIONS_AND_ADRS]], [[17_TRACEABILITY_MATRIX]].

## Фазы

| Фаза | Содержание | Эпики | Гейт |
|---|---|---|---|
| Phase 0 — Audit & Baseline | карта репозитория, baseline, противоречия, инвентаризация, реестр рисков | этот пакет | G0 |
| Phase 1 — Product & Architecture Decisions | определение продукта, роли, ADR-001…008, целевая архитектура, IA, стратегия контрактов; **решения Q-01…Q-20 → ТЗ v1.1, Р-28+** | E19 | G2 |
| Phase 2 — UX Foundation | реестр экранов v2, потоки, словарь статусов, план дизайн-системы (сделано в 11); осталось: токены как данные, кликабельный обход прототипа v2 с владельцем, usability-проверка экстренного пути | E19-UX | — |
| Phase 3 — Engineering Foundation | CI честный, integration-профиль, contracts/, check-all, наблюдаемость, тестовые основания | E18, E28 | G1, G3 |
| Phase 4 — Core Vertical Slices | по зависимостям: жалобы → админка v2 → callback-очередь → (по решениям) отмены/тарифы/B2B → push/VoIP | E20, E21, E22, E23, E24, E25, E26 | DoD каждого |
| Phase 5 — Security & Reliability | T-05…T-17, realtime recovery, key version, мониторинг | E29, E28 | G4 |
| Phase 6 — Release Readiness | E11 + iOS/сторы + провайдеры + бэкапы/TLS + runbook + юрдокументы + приёмка §11 | E27, E30, E11, E0 | G6 |

## Эпики

### E18 — Гигиена и честный CI (Phase 3) — M
- **Outcome:** зелёный CI отражает реальное состояние; `npm test` бэкенда проходит без инфраструктуры; документация описывает реальную структуру.
- Пользователь: разработчик/ИИ-исполнитель. Зависимости: нет. Модули: `.github/workflows`, `backend/package.json`, спеки, README, CLAUDE.md.
- Scope: (1) `lint` без `--fix` в CI (+ отдельный `format`); один коммит форматирования 19 файлов; (2) сервис MinIO в `backend.yml` + `S3_*` env; (3) `prisma/*.spec`, `storage/*.spec`, `audit.spec` → профиль `test:integration`; (4) разбор `content-admin`/`content-list` e2e: тесты предполагают пустую таблицу контента, а `prisma db seed` засевает 8 материалов → изолировать (очистка в `beforeAll` или префикс) — **дефект теста, не кода**; (5) `--forceExit`/закрытие app при провале bootstrap (Jest висел 27 мин); (6) README корня/backend/web, CLAUDE.md → прототип v2 после Q-*; (7) `scripts/check-all.sh`; (8) `npm audit --omit=dev` как предупреждение; (9) удалить `_bmad*`, desktop/web-каталоги Flutter (после Q-18).
- Out of scope: любые продуктовые изменения. Тесты: сами workflow. Откат: revert. Acceptance: все 5 workflow зелёные на PR с пустым диффом кода; `npm test` без docker зелёный; `git status` чист после `check-all`.

### E19 — Решения по прототипу v2 и ТЗ v1.1 (Phase 1–2) — M (владелец + документы)
- Outcome: таблица Q-01…Q-20 заполнена решениями Р-28+; ТЗ v1.1; прототип v2 перенесён в `docs/Прототип` (v1 архивирован); реестр экранов помечен «в объёме/вне».
- Зависимости: владелец. Acceptance: ни одного открытого `[QUESTION]`, блокирующего Phase 4.

### E20 — Жалобы и споры (Phase 4, при Q-05 = да) — L
- Outcome: клиент подаёт жалобу на консультацию в течение 48 ч, специалист отвечает, команда качества принимает решение; обе стороны видят статус.
- Роли: R-CLIENT, R-EXPERT-VERIFIED, R-ADM-QUALITY. Модули: новый `complaints` (Prisma `Complaint`: consultationId, type, reason, description, status NEW/IN_REVIEW/CLOSED, expertResponse, resolution, adminComment, deadlines), уведомления `complaint.*`, audit.
- Экраны: CL «Подать жалобу», «Мои жалобы» (моб.+веб), EX «Жалоба на вас», «Мои жалобы и споры» (моб.+веб), AD «Жалобы».
- API: `POST /consultations/{id}/complaint`, `GET /complaints` (свои), `POST /complaints/{id}/respond`, admin `GET /admin/complaints`, `POST /admin/complaints/{id}/resolve`. События: `complaint.updated`.
- Деньги: **без** денежных решений до Q-03 (resolution = отказ/принято/страйк; «страйк» инкрементирует счётчик в Expert). Безопасность: только участник; текст жалобы — чувствительные данные (без PII в audit).
- Тесты: e2e (окно 48 ч на виртуальном времени, чужой участник → 403, решения), UI-тесты экранов, Playwright. Миграция: аддитивная. Откат: revert + drop таблицы. Acceptance: полный поток на стенде; статусы по словарю §5; уведомления обеим сторонам.
- Истории: E20-1 модель+миграция+сервис (M) · E20-2 API клиента/эксперта + e2e (M) · E20-3 admin API + роли + e2e (S) · E20-4 экраны клиента (моб.+веб) (M) · E20-5 экраны эксперта (моб.+веб) (M) · E20-6 раздел админки (M) · E20-7 уведомления и словарь статусов (S) · E20-8 трассируемость/документация (S).

### E21 — Админка по прототипу v2: дашборд, специалисты, клиенты, финансы, настройки, callback (Phase 4) — L
- Outcome: суперадмин видит картину дня; операторы работают со списками специалистов и клиентов; финконтроль видит ledger; callback-заявки не теряются.
- Зависимости: E20 (счётчик жалоб), Q-09, Q-16, [[Дашборд метрик админки]].
- Scope: `GET /admin/metrics/overview` (агрегаты по формулам WIKI); `GET /admin/experts` (список/карточка/финистория); `User.isBlocked` + `POST /admin/clients/{code}/block` + guard; `GET /admin/ledger` и `GET /admin/finance/summary` + CSV; `GET /admin/audit` (просмотр); `GET /admin/callbacks` (заявки `CALLBACK_REQUESTED`, отметка «связались»); темы CRUD (`/admin/topics`); экраны admin по AD-реестру; корень → дашборд.
- Out of scope: рассылки, B2B/B2G, пакеты (Q-02). Безопасность: роли по [[06_ROLES_AND_PERMISSIONS]]; блокировка клиента отзывает токены (T-06).
- Тесты: e2e по каждому эндпоинту с ролевой матрицей; Vitest страниц. Acceptance: дашборд показывает те же числа, что e2e-фикстура; заблокированный клиент получает 403 на `POST /requests`.
- Истории (8): E21-1 метрики API · E21-2 дашборд UI · E21-3 клиенты (модель+API+UI) · E21-4 специалисты (API+UI) · E21-5 ledger/финансы (API+UI+CSV) · E21-6 audit view · E21-7 callback-очередь + текст экрана клиента · E21-8 темы CRUD.

### E22 — Политика отмен и no-show v2 (Phase 4, при Q-03 = да) — L (деньги; построчное ревью)
- Outcome: для плановых консультаций: отмена >2 ч — полный void; <2 ч — capture 50 % клиенту в возврат/50 % эксперту; no-show клиента — capture 100 % эксперту (по решению); no-show эксперта (`EXPERT_NO_SHOW`) — void + страйк.
- Зависимости: партиальный capture у эквайера (E0), E20 (споры). Модули: `payments` (partial capture), `consultations` (новые исходы), `ledger`, уведомления, тексты на всех поверхностях, оферта.
- Тесты: e2e денежного цикла для каждого исхода на виртуальном времени; ledger дебет=кредит. Откат: feature-flag `CANCELLATION_POLICY=v1|v2`. Acceptance: таблица исходов × суммы совпадает с решением владельца.

### E23 — Тарифы специалистов (Phase 4/R3, при Q-02 = да) — XL
- Outcome: специалист выбирает пакет; комиссия и видимость зависят от пакета; ежемесячная плата списывается; Старт — 30 дней 0 %.
- Зависимости: Q-02, оферта Р-07, E0. Модули: `Tariff`/`Expert.tier`, `matching` (видимость — приоритетные уровни), `payments` (снимок ставки — есть), новый биллинг эксперта (`charge()` по образцу Premium), админ «Настройки → пакеты», экраны EX «Тарифы», EW/EX профиль, WB «Стать психологом».
- Риск: конфликт с Р-02 и обещанием «лучший по скору». Acceptance: комиссия в ledger соответствует пакету на момент consultation.startedAt.

### E24 — B2B/B2G (Phase 4/R3, при Q-06/Q-07 = да) — XL
- Минимальный срез сейчас (S): формы «Для бизнеса» и «Для вузов» → тикеты категории `OTHER`/новая `PARTNERSHIP` с маршрутизацией в SUPPORT. Полный объём: контракты, коды, пулы сессий, `Payment.source=corporate`, «оплачено компанией», практиканты (второй поток верификации, супервизор, HEAVY_TOPICS), отчётность без тем/личностей.

### E25 — Способы оплаты Kaspi/Apple/Google Pay (Phase 4, при Q-12 и после E0) — L
- Outcome: клиент платит выбранным способом; холд/capture/void сохраняются. Зависит от возможностей эквайера; порт `PaymentProvider` расширяется `initiate(method)`.

### E26 — Рассылки и инцидент-алерты (после пилота, при Q-13) — M
- Outcome: суперадмин отправляет push по сегменту; согласие на маркетинг хранится; история рассылок. Email-канал — отдельное решение.

### E27 — Доставка офферов на устройства и готовность сторов (Phase 6) — L
- Outcome: FCM/APNs-адаптер за `PushProvider`, VoIP-push/CallKit исследование с прототипом (iOS), ConnectionService (Android), `.well-known` файлы в `web/public`, iOS-сборка и TestFlight, Data Safety, скриншоты ru/kz, демо-аккаунты для ревью.
- Acceptance: p95 доставки ≤ 3 с на 5 устройствах включая убитое приложение; deep links проверены на обеих платформах.

### E28 — Realtime и контракты (Phase 3/5) — M
- Outcome: `contracts/` (openapi git mv, ws-events, errors, design-tokens), `contracts.yml`, `GET /me/events?since`, `version` в payload, ресинк после `ready` во всех клиентах, дедуп LiveKit-вебхуков, `Idempotency-Key` на create-эндпоинтах, `X-Request-Id`.
- Acceptance: e2e «обрыв → реконнект → ресинк без потери оффера»; contracts drift = красный CI.

### E29 — Безопасность до пилота (Phase 5) — M
- T-05 токены админки (память + httpOnly refresh-cookie), T-13 CSP в prod, T-06 блокировка отзывает токены/WS + `User.isBlocked`, T-09 audit чтения документов, T-12 дедуп LiveKit, T-14 тест PII в audit, T-15 плейсхолдеры секретов + проверка на старте, T-02 throttle по IP, T-23 audit зависимостей; проектирование `keyVersion` (T-16).
- Acceptance: ASVS-чеклист обновлён; e2e на каждую угрозу.

### E30 — Эксплуатация (Phase 6) — M
- TLS-прокси (Caddy/nginx) в `infra/`, бэкапы томов с проверкой восстановления, централизованные логи, алерты (`settle_exhausted`, очередь верификации >24 ч, доля no-show, доставка пушей), синтетический smoke по расписанию, runbook поддержки, LiveKit prod + TURN, минимальная версия клиента в `/health`.

### E11 / E0 (открытые в Plane) — пилот и оргблокеры: без изменений; их выход — приёмка ТЗ §11 на проде эквайера и устройствах.

## Последовательность (10 шагов)
1. E18 гигиена → 2. E19 решения владельца → 3. E28 контракты/ресинк → 4. E29 безопасность → 5. E20 жалобы → 6. E21 админка v2 → 7. E27 пуши/сторы (параллельно с 5–6 после E0) → 8. E22/E23/E24/E25 по решениям → 9. E30 эксплуатация → 10. E11 пилот и приёмка.

## Формат истории (обязательный шаблон)

```
Story ID · Контекст · Проблема · User outcome · Точный scope · Запрещённые изменения · Affected files · New files ·
API impact · DB impact · UI impact · Expected states · Acceptance criteria (проверяемые) · Required tests ·
Manual checks · Rollback · Definition of Done ([[15_QUALITY_GATES]] §4)
```
Запрещены истории «улучшить UI», «отрефакторить бэкенд», «добавить mobile», «сделать архитектуру чище», «доработать безопасность».

## Бэклог историй первого шага (E18), готовых к DoR

| ID | История | Files | Acceptance |
|---|---|---|---|
| E18-1 | CI lint без `--fix` | `backend/package.json` (`lint` → без fix, `lint:fix`), `.github/workflows/backend.yml` | PR с prettier-дрейфом красный |
| E18-2 | Форматирование 19 файлов одним коммитом | список из baseline §1 п.3 | `npx eslint` чист; поведение не меняется (e2e зелёные) |
| E18-3 | MinIO в CI + изоляция контентных e2e | `backend.yml` (services.minio), `test/content-*.e2e-spec.ts` | e2e 100/100 в CI |
| E18-4 | Профиль integration для инфраструктурных спеков | `backend/package.json`, перенос 11 спеков | `npm test` без docker зелёный |
| E18-5 | Jest e2e не висит при провале bootstrap | `test/jest-e2e.json` / helper | провал bootstrap завершает процесс ≤ 60 с |
| E18-6 | README корня/backend/web + CLAUDE.md | 4 файла | описывают 6 пакетов, прототип v2, команды проверки |
| E18-7 | `scripts/check-all.sh` | новый | одна команда — все немутирующие проверки |
| E18-8 | Удаление bmad и лишних платформенных каталогов (после Q-18) | `_bmad*`, `app_expert/{linux,macos,windows,web}`, `app_client/web` | CI зелёный, сборки не затронуты |
