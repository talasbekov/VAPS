# 13 — План постепенной переработки (миграции)

Статус: готов · Дата: 2026-09-13 · Big-bang исключён; каждый шаг оставляет проект запускаемым.
Связано: [[09_TARGET_ARCHITECTURE]], [[14_ROADMAP_AND_BACKLOG]], [[15_QUALITY_GATES]], [[16_RISKS_QUESTIONS_AND_ADRS]].

## 1. Стратегия

1. **Зафиксировать baseline** — сделано в этой сессии ([[02_REPOSITORY_AUDIT]] §7, [[15_QUALITY_GATES]] §1): сборки зелёные, юниты 191/191, e2e 525/529 (два контентных набора — разбор в 15 §1), веб 298, админка 74, Flutter 271/363/110, `dart analyze` чист; lint-дрейф 66 prettier.
2. **Characterization tests** там, где поведение важно, а тестов мало: матрица «чужой id → 403/404» по всем bearer-эндпоинтам; тест на отсутствие PII в `audit_log.payload`; тест словаря статусов (одни и те же тексты во всех локалях/поверхностях); тест «после блокировки эксперта accept → 403».
3. **Исправить документацию** (README корня, backend/web README, CLAUDE.md → прототип v2, ТЗ v1.1 с решениями Q-*).
4. **Принять платформенный ADR** (ADR-001 — D) и ADR-002…007.
5. **Целевая структура** — без переезда каталогов; добавить `contracts/`, `scripts/check-all.sh`, `contracts.yml`.
6. **Контракты** — `openapi.json` в `contracts/` (git mv), `ws-events.md`, `errors.md`, `design-tokens.json`.
7. **Walking skeleton** новых функций — не нужен для существующих (всё уже проходит end-to-end); для новых сущностей (жалобы, дашборд) первый вертикальный срез = один экран + один эндпоинт + миграция + e2e.
8. **Вертикальные срезы** — каждый эпик Phase 4 ([[14_ROADMAP_AND_BACKLOG]]) содержит UI + API + модель + событие + тесты.
9. **Совместимость** — мобильные клиенты в сторах живут долго: только аддитивные изменения API/WS; удаление через Deprecation и период ≥ 1 релиза.
10. **Удаление старого** — только после доказанного переключения (например, `docs/openapi.json` остаётся симлинком/копией один релиз).

## 2. Правила миграции (обязательные для каждой истории)

Проект запускаем после каждого шага · blast radius — один модуль/один экран · есть тест · есть откат (revert коммита или feature-flag) · не смешивать API+БД+UI без необходимости (сначала аддитивная миграция БД → бэкенд с обратной совместимостью → клиенты → удаление старого) · не обновлять стек одновременно с переносом · не переименовывать ради красоты · абстракция — только при втором использовании · `git mv` при переносе · старый путь живёт, пока есть потребители.

## 3. Reuse-матрица

| Текущий путь | Ответственность | Качество | Покрытие | Ценность | Целевое место | Действие | Предпосылки | Риск | Откат | Критерий приёмки |
|---|---|---|---|---|---|---|---|---|---|---|
| `backend/src/{requests,matching,presence}` | матчинг, офферы, таймеры, эскалация | высокое (комментарии, инварианты, нагрузочный прогон) | e2e 8 наборов, unit scoring | **ядро** | там же | KEEP; SPLIT use-cases при следующем изменении | — | регрессия таймеров | revert | e2e `request-timers`, `matching-accept-race` зелёные |
| `backend/src/{consultations,chat,media,booking}` | сессии, чат, LiveKit, плановые | высокое; `consultations.service.ts` 752 строки | e2e 12 | ядро | там же | KEEP; SPLIT (outcomes/no-show/access-log) | characterization-тесты доступа | — | revert | тесты + доступ чужого → 403 |
| `backend/src/{payments,ledger,payouts,premium}` | деньги | высокое, идемпотентность, снимки | e2e 14 | ядро | там же | KEEP; изменения — только с построчным ревью; боевые адаптеры за портами | договор эквайера (E0) | финансовые | feature-flag `PAYMENT_PROVIDER` | e2e денежного цикла на sandbox |
| `backend/src/{auth,account,admin,common}` | идентичности, безопасность | высокое | e2e 12 | ядро | там же | HARDEN (T-05, T-06, T-15) | — | — | revert | ASVS-чеклист |
| `backend/src/{notifications,devices}` | пуши/SMS/outbox | высокое, но провайдер mock | e2e 7 | ядро | там же | HARDEN: FCM/APNs адаптер (+VoIP исследование) | ключи Firebase/APNs | доставка §11.6 | `PUSH_PROVIDER=mock` | замер p95 на устройствах |
| `backend/src/{verification,experts,schedule,reviews,tickets,content,favorites,topics,storage,maintenance,ws}` | остальное | хорошее | e2e 20+ | высокая | там же | KEEP; `ws` HARDEN (events?since); `storage` HARDEN (audit чтения документов) | — | — | revert | — |
| `backend/prisma` | схема/миграции | образцовое | schema-спеки | ядро | там же | KEEP; новые сущности — аддитивными миграциями | — | — | `migrate resolve`/down-скрипт в PR | миграция применяется на копии прод-дампа |
| `backend/test` | e2e | высокое | — | высокая | там же + профиль `integration` для `prisma/*`, `storage/*`, `audit` спеков | REFACTOR IN PLACE (разделить unit/integration; `--forceExit`/закрытие app при провале bootstrap) | MinIO в CI | — | revert | `npm test` без инфраструктуры зелёный; e2e в CI зелёный |
| `web/` | публичный веб + кабинеты + BFF | высокое | 298 Jest + Playwright | высокая | там же | KEEP + HARDEN (`.well-known`, README, поддержка эксперта, гость — по Q-08) | — | — | revert | Playwright против стенда |
| `admin/` | админка | среднее (нет дашборда/клиентов/финансов) | 74 | высокая | там же | HARDEN (T-05) + расширение по прототипу v2 (E21) | решения Q-05/Q-09 | — | revert | Vitest + smoke |
| `app_client/`, `app_expert/`, `packages/shared` | native | высокое | 363/110/271 | ядро | там же | KEEP + HARDEN (VoIP/CallKit — исследование, iOS-сборка); RETIRE `linux/macos/windows/web` каталоги | JDK (есть), macOS для iOS | сторы | revert | сборка APK/IPA, integration_test |
| `docs/Прототип` (v1) | эталон раскладок | устарел | — | средняя | `docs/Прототип` ← v2 после решений Q-* | REPLACE (git mv v2 из хранилища) | решения владельца | путаница | оставить v1 в `docs/Прототип-v1` один релиз | CLAUDE.md обновлён |
| `docs/openapi.json` | контракт | актуален | контрактные тесты | ядро | `contracts/openapi.json` | MOVE (git mv) + симлинк/копия на релиз | обновить `web api:generate`, `shared` тест | — | revert | `contracts.yml` зелёный |
| `_bmad*`, `.claude/skills/bmad-*` | не используется | — | — | нет | — | RETIRE | подтверждение владельца (Q-18) | — | revert | — |
| `README.md`, `backend/README.md`, `web/README.md`, `CLAUDE.md` | документация | устарела | — | средняя | там же | HARDEN | — | — | — | описывают реальную структуру |
| `.github/workflows/*` | CI | среднее | — | высокая | там же | HARDEN: lint без `--fix`, MinIO-сервис, `npm audit`, contracts drift, Playwright smoke по расписанию | — | — | revert | все workflow зелёные на PR |

## 4. Последовательность и gates

| Шаг | Что | Gate для перехода |
|---|---|---|
| G0 | baseline зафиксирован (этот документ, [[15_QUALITY_GATES]]) | владелец прочитал [[01_EXECUTIVE_SUMMARY]] |
| G1 | E18 «Гигиена»: CI честный (lint без fix, MinIO, e2e зелёные), prettier-дрейф устранён одним коммитом, README/CLAUDE актуальны | все workflow зелёные; `git status` чист |
| G2 | Решения владельца по Q-01…Q-17 → ТЗ v1.1 + прототип v2 в `docs/` | подписанная таблица решений в [[16_RISKS_QUESTIONS_AND_ADRS]] |
| G3 | `contracts/` и characterization-тесты | contracts.yml зелёный; матрица «чужой id» зелёная |
| G4 | Безопасность до пилота (E29: T-05, T-06, T-09, T-12, T-13, T-14, T-15) | ASVS-чеклист обновлён |
| G5 | Вертикальные срезы Phase 4 в порядке зависимостей (E20 жалобы → E21 админка → E22/E23/E24 по решениям) | каждый эпик: DoD [[15_QUALITY_GATES]] |
| G6 | Release readiness (E11 + E27 + E30): боевые провайдеры, iOS, сторы, TLS, бэкапы, мониторинг, юрдокументы | критерии ТЗ §11 закрыты на проде эквайера и устройствах |

## 5. Совместимость и откат

- API: только аддитивные поля; новые статусы (например `Complaint`) — новые enum, старые не меняются; клиенты игнорируют неизвестные значения (проверить в Dart-моделях: `unknownEnumValue`).
- БД: миграции аддитивные; удаление колонок — через два релиза; каждая миграция проверяется на копии прод-дампа (E30).
- WS: новые события добавляются; переименование — только с алиасом на релиз.
- Мобильные: minimum supported version в `GET /v1/health`/config → экран «обновите приложение» (новая S-история).
- Откат эпика: revert merge-коммита + `prisma migrate` вниз-скрипт в PR (обязателен для любой миграции, меняющей данные).

## 6. Карта «старый путь → новый путь»

| Старое | Новое | Когда |
|---|---|---|
| `docs/openapi.json` | `contracts/openapi.json` | G3 |
| `docs/Прототип/` (v1) | `docs/Прототип/` (v2), v1 → `docs/Прототип-v1/` на один релиз | G2 |
| `admin/src/lib/tokenStore.ts` (localStorage) | память + httpOnly refresh-cookie (`/v1/admin/auth/refresh`) | G4 |
| `backend/src/prisma/*.spec.ts`, `storage/*.spec.ts`, `audit/*.spec.ts` | `backend/test/integration/*.int-spec.ts` (профиль с инфраструктурой) | G1 |
| `app_expert/{linux,macos,windows,web}`, `app_client/web` | удалены | G1 (после Q-18) |
| `_bmad*` | удалены | G1 (после Q-18) |
| `hotlines`-текст экрана callback («перезвонит первый освободившийся») | «оставьте заявку — мы свяжемся» до реализации очереди (Q-16) | G2 |
