# Ночная проверка Smart Josparlau — план выполнения

> **For agentic workers:** Use superpowers:executing-plans. Исправления подтверждённых независимых дефектов могут использовать superpowers:dispatching-parallel-agents; окончательные изменения требуют отдельного review.

**Goal:** Автономно проверять и исправлять актуальную кодовую базу до 08:00 8 октября 2026 Asia/Qyzylorda (03:00 UTC), оставить проверенный проект работающим и записать фактические результаты.

**Architecture:** Снять согласованную PostgreSQL-копию подготовленного учебного стенда и проводить изменяющие данные проверки на отдельном API и отдельной production-сборке. Работать последовательно, с одним браузерным работником; логи и секреты хранить вне Git. Ошибки исправлять после воспроизведения, с регрессией и повторным сценарием.

**Tech Stack:** Django 5.1, PostgreSQL 16 ICU, Redis 7, Celery, Next.js 15.5.25, Playwright, pytest, Windows PowerShell.

**Spec:** Запрос пользователя в текущей беседе: «после автономно веди работу до 8 утра»; ранее согласованные проверки ролей, реальных пользовательских процессов, тестовых данных, памяти и записей Obsidian.

## Global Constraints

- Начало ночного продолжения: 2026-10-07 18:24:22 UTC; срок: 2026-10-08 03:00:00 UTC.
- Основной checkout `gitlab-integration-20261006`, ветка `codex/requirements-fixes-20261007`, исходный commit `e0502e3c`.
- Учебный стенд пользователя `127.0.0.1:3345`, API `127.0.0.1:18345`, база `smart_soak_20261007` сохраняется, включая заявку ОМ 48 и десять связанных учебных учёток.
- Ночной API `127.0.0.1:18346`, frontend proxy `127.0.0.1:3347`, Next `127.0.0.1:3348`, база `smart_night_20261008` на уже выделенном PostgreSQL `127.0.0.1:15345`.
- Артефакты `%TEMP%/smart-night-20261008`; секреты не выводить и не коммитить. Production-сборка `.next-night-20261008` не перезаписывает работающую `.next-build`.
- Сохранять источники, импортные идентификаторы, nullable-даты, зависимости и готовые видео. Не повторять заблокированное удаление дублей видео.
- Рабочая серверная БД, чужие контейнеры, публикация и развёртывание на сервере вне задачи.
- Проверки с подменами, проверки исходников и диагностика кнопок считаются отдельно от реального выполнения пользовательского процесса.

## Review Focus

- Смешанные глобальные и ограниченные роли: интерфейс должен соответствовать действующим разрешениям сервера.
- Будущие и законченные статусы: текущий статус должен правильно определяться на локальную рабочую дату.
- Очистка тестов: не затрагивать учебные процессы пользователя, учётки и подготовленную заявку.
- Длительный обход: ошибки стенда и усечённые сценарии явно отделять от подтверждённых дефектов приложения.
- Ограниченная память: сборка, тесты и браузерные обходы не выполняются одновременно тяжёлыми группами.

### Task 1: Отдельный ночной стенд

**Files:** временные compose, конфигурация Playwright, frontend helpers и ledger в `%TEMP%/smart-night-20261008`.

- [x] Снять PostgreSQL dump учебной базы; восстановить в новой ICU-базе, проверить различие имён и сохранность исходной заявки 48.
- [x] Изолировать Redis и файловые хранилища, поднять API с одним процессом.
- [x] Собрать и поднять отдельный Next и proxy; проверить вход и API, исключить ссылки запросов на исходный API.
- [x] Зафиксировать исходные показатели памяти и запустить ограниченный сроком мониторинг здоровья.

### Task 2: Оставшиеся проверки

**Files:** существующие `e2e/*.spec.ts`, временные результаты и отчёт классификации.

- [x] Выполнить полный smoke-набор одним работником, сохранить число выполненных, пропущенных и упавших проверок и характер покрытия. Первый проход: 558 passed, 67 failed, 25 skipped; 34,4 минуты. Исправления и повторные результаты учитываются отдельно.
- [x] Выполнить три отдельных длинных обхода маршрутов и кнопок: observer/erda/forces officer по58 passed, exit0, без flaky; фактические goto47/44/46, исходные caps60/dialog8/retry1/oneworker сохранены. Находки прочитаны и классифицированы. Полный обход администратора не запускался; усечения, отложенные клики и неразрешённые динамические маршруты остаются ограничениями.
- [x] Повторить ограниченные ролевые проверки после финального security frontend: **28 passed, exit 0, 1,4 минуты, 00:00:28 UTC**; четыре экрана каждой роли и соответствие event.view/отказа, без pageerror/5xx. Предыдущий повтор 22:57:32 сохранён отдельно.
- [x] Провести полный актуальный PostgreSQL pytest и проверку миграций после существенных исправлений. 6046 passed, 1 skipped, exit 0; миграций нет, Django check 0 issues (20:31–20:32 UTC).
- [x] Повторить весь PostgreSQL-набор после добавления точного `global_permissions`: **6053 passed / 1 skipped, exit 0, 18:42, 22:51:13 UTC**. Миграций нет, Django check 0 issues (22:51:34–22:51:38 UTC).
- [x] После обновления изолированной сборки выполнить три живые summary-регрессии (GREEN 22:53:50) и собственный транспортный сценарий (4 passed, 22:55:34).
- [x] Выполнить полный smoke-повтор после bound-global и транспортных исправлений: **656 случаев, 630 passed / 26 skipped, exit 0, 24,7 минуты, 23:22:31 UTC**. Пропуски: 23 mock-only и 3 зависящих от данных. После следующего security-изменения этот результат остаётся предыдущим состоянием кода.
- [x] Повторить полный backend и smoke после глобального RBAC gate и согласования интерфейса. Полные результаты и последующие focused corrections учитываются раздельно.
  - Backend завершён **23:54:09 UTC: 6138 passed / 1 skipped / 11 warnings, exit 0**, 18:33, собственная ICU PostgreSQL БД, один xdist worker с --dist=load; миграций нет (23:56:08), Django check 0 issues (23:56:12).
  - Новая Night production-сборка прошла проверку типов и build **23:57:15 UTC / exit 0**. Focused browser **14 passed / exit 0 / 23:58:43 UTC**: 13 обычных live cases и один initial-loading HTTP-delivery contract. Populated-cache runtime edge не покрыт.
  - Первый security smoke завершён **00:26:16 UTC: 631 passed / 26 skipped / 10 failed / 0 flaky, exit 1**. FOREIGN-предусловия трёх файлов не находят запись в первых 200 INTERNAL из 218. Собственные реальные мероприятия/ОЛ и точечная очистка: focused **11 passed / exit 0 / 00:36:37** после TypeScript 00:35:07.
  - Второй полный667: **639 passed /26 skipped/2 failed/exit1/01:05:52**. Старый role fixture отправлял duplicate POST до debounced search; новый UUID Z-test отдельно подтвердил реальный first50 dropdown defect. Статусный fixture за10–20 ноября задел уже сданный расход: реальный422 AMENDMENT_REASON_REQUIRED. После исправлений **15 focused passed /01:15:30** и **2 status passed /01:18:07**.
  - Fresh final app-build667 **01:47:45:640 passed/26 skipped/1 failed/0 flaky/exit1**; только access-roles sharedduplicate400. Test-only ownUUID коррекция independently approved, TSC0/01:48:26 и **6 focused passed/01:49:15/exit0**. Entire667 после этой fixture correction ещё раз не повторялся; separate focused не заменяет raw full result.

### Task 3: Подтверждённые ошибки

**Files:** участки подтверждённых дефектов и их регрессии; перечень уточняется по воспроизведениям в ledger.

- [x] Завершить security-находку: scoped custom wildcard проходил агрегированный admin.roles gate и мог назначить себе ADMIN/null. Серверный global gate и anti-lockout: **85 RED (69 failed /16 passed) →276 focused passed/23:27:41**, frontend RED6fail/3pass → GREEN14/15cases, latest fullbackend6138PASS. Final app-build667 имеет только старый fixture duplicate400, исправленный отдельным focused6. Независимые backend/frontend reviews APPROVED; другие кадровые APIs этим патчем не ограничиваются.

- [ ] Каждую находку воспроизвести отдельно и проверить данные, права, сетевой запрос и состояние UI.
- [ ] Для дефектов приложения выполнить RED → минимальное исправление → GREEN; ошибки тестов исправлять с явным объяснением причины.
- [x] Исправить подтверждённый later-page role dropdown: отдельная полная загрузка справочника, прежний global gate, loading/error/retry. **RED01:07:00 → GREEN own Z-role в наборе15/01:15:30**, independent review APPROVED; UIcreate/assign/profile/revoke и сохранность исходных выдач проверены.
- [x] Исправить status test period без обхода правил поправки: reserved один день, checked submissions count0, настоящая навигация календаря. **2 passed/01:18:07**, TypeScript и independent review прошли; старые endpoint/participation assertions сохранены.
- [x] Запустить обязательный front gate и отдельные фактические браузерные сценарии после финального изменения приложения. **Source gate 01:19:44 UTC / exit 0**: TypeScript, rewrites, shot paths, 4 unit cases и production build. Перечислены 12 Playwright cases; это не runtime. Отдельные actual browser повторы 15 security/employee/role cases, 2 status cases, прежние28 roles и11 own GVO/catalog cases прошли; новый полный smoke пока выполняется.
- [x] Получить независимый review изменений и исправить существенные замечания. Final67-path source/hygiene review и дополнительный own-access-role fixture review APPROVED; новых Critical/Important нет. Git diff --check0, новых секретов/артефактов в source inventory нет.

### Task 4: Устойчивость и завершение к сроку

**Files:** `docs/vault/Журнал.md`, `docs/vault/Задачи.md`, итоговые результаты ночного прогона.

- [x] Продолжить содержательные проверки до срока: монитор494samples завершился03:00:00UTC; последние изменения и три обхода завершены, непроверенные функции, ошибки и ограничения сохранены.
- [x] Проверить сохранность видео, учебных учёток и заявки 48; оставить frontend 3345 и API 18345 работающими на проверенном коде. **00:39:13 и01:20:37 UTC integrity PASSED**: 10 identities/links/scopes/permissions, 18 video SHA-256, 4 manifest SHA-256, persisted event48 domain и snapshot file совпадают. Next3346 PID21632, BUILD_ID rIBT3NHiUOPD_SDk9ryuL; портал3345 HTTP200. Оба предыдущих integrity reports сохранены; final deadline health остаётся отдельной проверкой.
- [x] Сохранить код шестью локальными коммитами:88aea1d2/2366535d/fda50035/1a7941f2/3b87a09b/180ed266. Последние два исправляют landing assertion теста FGO и реальную ширину OrgChart с постоянной регрессией. Branch/worktree сохранены, remotes/merge/deploy не выполнялись. Docs commit после итоговых actualresults.
- [x] После03UTC остановить только добавленные Night процессы и четыре контейнера. Guarded stop/cache PASSED, пять canonical containers и PID9116/2652 сохранены. Точный Night cache34files/710493747bytes удалён, исходники, видео, зависимости, базы и evidence сохранены.
- [x] Обновить существующие заметки Obsidian и подготовить честный отчёт. Финальная integrity и actual page/JavaScript/JPEG probe PASSED после teardown; URL3345,10учёток,18видео и заявка48 сохранены. Финальный docs commit выполняется отдельно.

### Последняя проверка перед сроком

OrgChart /organization: actual browser RED2 passed/6 failed (левая ветвь вне viewport, одна ссылка под sidebar) → минимальная правка двух классов → GREEN8 passed. Постоянная e2e регрессия01case/9ordinary pointer transitions passed02:50:23. Independent review APPROVED. Последний source gate02:48:58 exit0: TypeScript,16 rewrites,187 shot-path files,4 unit passed,12 Playwright cases listed и production build. Windows EPERM warning копирования standalone symlink сохранён; обычный runtime работает, standalone deployment не проверялся.

Третья integrity02:50:35 PASSED: прежние данные,10учёток,18видео,4manifest и пять retained containers сохранены. Основной портал3345 HTTP200, Next3346 PID9116, BUILD_ID9kPGnus5VLm-PfzRfXPbg. Результаты старых полных наборов относятся к прежним сборкам; весь667 после финального CSS не повторялся. У observer лишний закрытый stats GET400; календарные pointer-находки erda не устранены; исходный FGO send400 без сохранённого response body не имеет доказанного объяснения. Ночной teardown и последняя сверка выполняются отдельно после03UTC.

### Завершение автономной работы после08:00 — 8октября2026

Срок03:00UTC соблюдён. Монитор завершился2026-10-08T03:00:00.013Z,494samples; последняя пара HTTP3345/3347 вернула200. Плановые остановки и сборки в предыдущих health samples не скрыты. После срока остановлены только Night proxy3347/Next3348 и четыре Night контейнера (worker/backend/media/redis). Guarded teardown PASSED, finished2026-10-08T03:00:44.6473805Z; основной Next3346 PID9116, proxy3345 PID2652, пять основных контейнеров и shared PostgreSQL сохранены без замены. Базы, тома, исходники, зависимости и чужие сервисы не удалялись.

Точный кэш .next-night-20261008/cache проверен по inventory и удалён штатным PowerShell:34files/7dirs/710493747bytes (677,6МиБ). Основной портал до/после HTTP200. Вместе с прежней подтверждённой очисткой4,262+2,56ГиБ это около7,48ГиБ логических данных; это не измерение свободного места всего диска. Шесть raw-дублей видео около39МБ оставлены после автоматического отказа «blocked by policy»; удаление не повторялось.

Финальная integrity PASSED: persisted заявкаОМ48 неизменна, десять identities/links/scopes/permissions и18видео SHA-256 сохранены; четыреmanifest, исходный snapshot и предыдущие отчёты сохранены. Финальный asset probe PASSED: страница3345=200, настоящий JavaScript chunk200/application-javascript/173023bytes, JPEG200/image-jpeg/885bytes. BUILD_ID9kPGnus5VLm-PfzRfXPbg, основной проект оставлен запущенным на http://127.0.0.1:3345/ .

Доказательства вне Git: deadline-cleanup-cutoff0300-20261008T030031657Z-74536cd47ff34d67a150b39b75b09cfa.json; night-cache-cleanup-orgchart-final-20261008T030051647Z-065d11d4bb874fe1b5054686fe4e16b7.json; integrity-final-deadline-orgchart.json; final-canonical-assets.json; monitor-finished.json. Каталог C:/Users/amant/AppData/Local/Temp/smart-night-20261008. Обход администратора и весь667 после последнего CSS не выполнялись. Незавершённые функции и диагностические ограничения перечислены выше; утверждения «всё работает» нет. Итоги сохранены в существующем Obsidian junction Smart Josparlau→docs без новых дубликатов.
