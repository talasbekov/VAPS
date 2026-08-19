---
name: project-ops-backend-plan
description: "Раздел ОМ ЗАКРЫТ ЦЕЛИКОМ (10.08.2026): все группы живые, стенд full-live, дубли /ops и легаси /feedback выведены — сводка срезов, коммитов и ловушек"
metadata: 
  node_type: memory
  type: project
  originSessionId: be7b91bc-b843-47a0-85ad-a0e84beeb1e2
---

После завершения переезда `core`/`documents` остались собственные ресурсы
раздела «Охранные мероприятия» — их нет НИ В ОДНОМ бэке, это разработка с
нуля. План: `docs/ops-backend-plan.md` (в git через `add -f`, коммит
`35c1bd6b`).

**Счёт путей: ~64 адреса, а не 37.** Цифра 37 (уникальные объявленные
константы) занижена почти вдвое: бо́льшая часть под-адресов не объявлена
константой, а собирается хелпером от базового пути (`objectDetailPath(id)`,
`securityEventBulletinPath(id)` и т.п.). У одного только реестра ОМ таких
под-адресов около двадцати. Считать по константам — промахнуться вдвое.

14 групп, ~132 стори. Порядок выведен из зависимостей, не из размера:
`Настройки` питают политиками почти всех → `Объекты` разблокируют `Дежурства`
и `Реестр ОМ` → `Рейтинг` последним. Группа «расход дня раздела» помечена **не
строить** — дубликат живого `/api/operations/`.

Сделано: **срез A1** (`648e3341`) — `GET /api/ops/objects/`, модель
`OpsSecurityObject`, приложение-оболочка `apps/ops`, право `object.view`.
Гейт 2445 passed.

**Блокеры проектирования — ждут владельца продукта** (без них модели не
проектируются): формула агрегата рейтинга и что такое «закрытый период»;
правило вывода `passportState` (RED/YELLOW/GREEN — хранимое поле фикстуры, а
не вычислимое); владелец объекта в оргструктуре и правило области видимости;
правило `REST_AFTER_DUTY`; метрики аналитики и пороги детекторов; от чего
считается `snapshotId`/`calculationVersion`.

**Решить ДО врезки фронта: тип идентификатора.** Контракт объявляет
`id: string`, конвенция бэка — целые ключи; срез A1 пошёл по конвенции.
Закрывать либо приведением на клиенте, либо UUID-ключами — тянуть нельзя.

См. [[project-two-backends-spa-targets-new]], [[project-core-port-slices-progress]].

## ИТОГ СЕССИИ 10.08.2026 (вечер): раздел ОМ закрыт, дубли выведены

Коммиты одной сессии: bc2783e1 (срез J feedback-бэк) → faca519f (легаси-чат
/feedback удалён) → 3c8addd3 (/feedback рендерит модуль сам, «один модуль —
два входа», ссылки от текущего пути) → 1edd09cc (SPA-группа /ops/* выведена,
адреса = карта редиректов) → 7b9ccaa7 (демонтаж josparlau+sync+host-e2e,
−95k строк) → b2ae02a7 (срез L-адаптеры: расход дня живой) → 8bd89bd0 (fix
пустого src аватарки OrgBoard — 12 React-warnings на /dashboard).
Направление задал Bratan: «страницы во всех модулях ведут к новым страницам,
которые мы переписали» — реализация одна, дублей и редиректов В новый фронт
нет. Бэк-сюита 2993 passed; стенд: Django :8100 (--noreload, рестарт
руками) + next dev :3000, ВСЕ 12 доменов в NEXT_PUBLIC_OPS_LIVE_DOMAINS
(.env.local, git-ignored — на новом чекауте выставить заново!). Логин
стенда: admin/admin123 (scripts/create_users.py). Порт 3000 занят чужим
процессом → preview_start требует его освободить (NEXTAUTH_URL жёстко
:3000). ОТКРЫТОЕ: легаси-гонки core (ревью 08.08); NEXTAUTH_SECRET из git убран
(11020c80) — прод требует ротации утёкшего секрета (история git его
помнит) и NEXTAUTH_SECRET в окружении хоста;
донор-очередь — только пишущие core-экшены и алиасы имён.

**Срез L-адаптеры сделан (10.08.2026, b2ae02a7): расход дня ОМ живой —
МОК-ЭКРАНОВ В РАЗДЕЛЕ НЕ ОСТАЛОСЬ.** /api/ops/daily/* = ТОНКИЕ адаптеры
над живым /api/operations/ (bulk_status_service/day_submission_service);
бэк-дубль не строился (группа L «не строить» соблюдена). Гарды области —
импортом _resolve_division_scope/_assert_division_in_scope (один владелец,
не копия). Форма контракта: строковые id, все версии дня (history=True),
подпись сдавшего = username. Домен daily в переключателе; стенд полностью
live (все 12 доменов в NEXT_PUBLIC_OPS_LIVE_DOMAINS). Ловушка: снимок
сдачи требует StatusType IN_SERVICE в фикстуре (ValueError без него).
Раздел ОМ ЗАКРЫТ ЦЕЛИКОМ: 14/14 групп либо живые, либо намеренно
адаптеры. Донор-очередь: остались только пишущие core-экшены (на старой
стороне намеренно) и алиасы имён (см. docs/api-gaps.md).

**Срез J сделан (10.08.2026, bc2783e1): обратная связь живая — mock-first
доменов НЕ ОСТАЛОСЬ** — 6 адресов feedback-requests (list/create/retrieve/
submit/comments/triage/close); домен "feedback". Справочник (подписи+КАРТА
ПЕРЕХОДОВ) — синглтон-таблица с сида; лента timeline+audit одна, пишется
диффом (_commit_change); черновик не открывается никаким правом; содержание
конфиденциального вырезает сервер ВМЕСТЕ с превью, поиск — только по видимым
полям; замок закрытого первым; закрытие — отдельная операция с ответом
автору. Права: feedback.view/create/view_all/view_confidential/triage/
internal_note. Сид: --feedback-author <user.pk> заводит свой черновик
(иначе submit-путь вживую недостижим); подпись актора резолвится до живой
кадровой записи (Абенов С., не 'admin'). 7 красных проб. Дозакрыто
(faca519f, 3c8addd3): легаси-чат хоста /feedback (опрос мёртвого
/api/dictionaries/feedback/) УДАЛЁН; по указанию Bratan /feedback НЕ
редиректит, а САМ рендерит новый модуль (re-export страниц
/security-ops/feedback, ссылки внутри — от текущего пути); вне /api/ops/*
недостающих путей не осталось. Дубли добиты (1edd09cc): SPA-группа /ops/*
ВЫВЕДЕНА из сайдбара (A160 решён), app/ops/[[...slug]] = карта редиректов
на нативные /security-ops/* и живые хостовые экраны; ссылок в /ops в коде
хоста ноль. Демонтаж ДОБИТ (7b9ccaa7): josparlau/ (~95k строк) + tools/
sync-josparlau + host-files УДАЛЕНЫ; во frontend/ сняты
playwright.host.config.ts, e2e-host/ и скрипт test:e2e:host (гейт
vitest+e2e:mock не тронут); чистки tsconfig/tailwind/.gitignore. После
удаления dev-серверу нужен холодный старт (rm -rf .next) — turbopack
держит мёртвый граф и сыплет Module not found.
СЛЕДСТВИЕ: «SPA /ops проводка» из планов ВЫЧЕРКНУТА — раздел живёт на
нативных страницах, проводить SPA больше не к чему
([[project-ops-frontback-wiring-gap]] — историческая диагностика).

**Срез I сделан (10.08.2026, 1754be70): служебные отчёты живые** — 7 адресов
service-report-types|jobs (list/retrieve/create/retry/new-revision)|
artifacts/download; домен "service-reports". Продвижение на чтении
(PENDING→PROCESSING→COMPLETED|FAILED), immutable-артефакт с ревизией по
СЕРИИ (тип+период+режим; по максимуму, не по счёту), retention замораживается
на сборке из REPORT_LIMITS. Masking: sensitive-колонки отсутствуют в файле
целиком; sensitive-работы 404-ятся без права; параметры чужого запуска
вырезаны ВМЕСТЕ с idempotencyKey (производное). Права: report.generate/
export_sensitive/view_foreign_parameters. Осталось mock-first: ops/feedback
(J) + SPA /ops; daily-expense не строить (дубль /api/operations/).

**Срез H сделан (10.08.2026, 78a9f915): аналитика службы и мероприятий живая**
— 6 адресов service-analytics|-presets|-drilldown|-attention, load-analytics,
operations-analytics; домен "analytics". Блокеры «метрики/пороги/snapshotId»
закрыты доктриной мока: snapshotId = f(данные max updated_at+count, период,
scope) — детерминирован, без часов; несовпадение = SNAPSHOT_OUTDATED. Новое:
журнал переходов ОМ OpsSecurityEventTransition (append-only, пишут операции
стадий security_events.py; воронка §22.14 только по нему — на стенде пустой
до новых переходов, backfill нет намеренно). Права: analytics.view/drilldown/
personal_detail/operations. unit смены = Employee.staff_unit.division.
Реестры (метрики/пресеты/детекторы) — таблицы + сид; администрируемые числа
детекторов из ATTENTION_POLICY настроек. Осталось mock-first: daily-expense
(не строить — дубль), service-reports (I), ops/feedback (J) + SPA /ops.

**Срез G сделан (10.08.2026, 5619be19): оперативный рейтинг живой целиком**
— все 15 адресов /api/ops/operational-ratings|-dynamics|-employee,
evaluation-workspace|-work-items(submit/correct/detail)|-registry,
rating-analytics|-audit|-notifications|-exports|-export-artifacts; домен
"ratings" (одним переключателем все 7 экранов). Блокер «формула агрегата»
закрыт доктриной «мок и есть контракт»: среднее учтённых периода политики,
half-up до 0.1 (питоний банковский round() тут ловушка). Права порознь:
rating.view_aggregate/evaluate/correct/view_correction_chain/view_audit/
export + analytics.view. Свой журнал (не общий аудит), отказы отдельной
транзакцией — из-за этого вьюхи мутаций БЕЗ RequirePermissionMixin (гейт в
сервисе). Ловушка скана кодов в ТРЕТИЙ раз, новая форма: DomainError(code)
с переменной невидим — только литералы. Сид: --rating-evaluator <user.pk>
привязывает очередь к живой учётке (иначе рабочее место пусто). Осталось
mock-first: daily-expense (ОМ, не строить — дубль), analytics (H),
service-reports (I), ops/feedback (J) + SPA /ops.

**Срез D1 сделан (10.08.2026, 5e974489): настройки+справочники+аудит живые**
— настройки теперь ВЛАДЕЛЕЦ политик (сквозная запись в синглтоны
свежести/конфликтов, версия раздела = версия политики); справочники со
связями по живым данным; аудит-экран поверх настоящего журнала. Домены
dictionaries/settings/audit. Инцидент: распаковка цикла в handle сида
затенила options (словарь аргументов) — 15 тестов сида упали TypeError;
не называть переменные цикла options/kwargs внутри handle. Осталось
mock-first: daily-expense (ОМ), ratings/* (6 экранов), analytics,
service-reports, ops/feedback + SPA /ops.

**Срез C2 сделан (10.08.2026, 782b5904): боевые группы живые, календарь
закрыт целиком** — combat-duty-types/routes/roster-candidates/duty-shifts;
домен "combat"; календарь = duties+combat оба live. ЛОВУШКА ПОВТОРИЛАСЬ:
хелпер _rule снова спрятал коды от скана error-codes (наступил на неё второй
раз, инлайнить DomainError СРАЗУ). Осталось mock-first: daily-expense (ОМ),
ratings/*, analytics, service-reports, ops/dictionaries, ops/settings,
ops/audit-logs, ops/feedback + SPA /ops.

**Срез C1 сделан (10.08.2026, 3ea0d528): план дежурств живой** — duty-types/
shifts/monthly-plan/plan-objects/candidates; конфликты и action-policy по
настоящим RBAC-правам (duty.view/manage/approve_plan в сиде); отпечаток
состава месяца; домен "duties". Календарь — смешанный режим (живые смены +
мок-боевые), его баннер называет только combat. Осталось mock-first: combat,
daily-expense (ОМ), ratings/*, analytics, service-reports, ops/dictionaries,
ops/settings, ops/audit-logs, ops/feedback + SPA /ops.

**Срез B1 сделан (10.08.2026, cecc0c18): командный центр + реестр ОМ живые** —
/api/ops/security-events/ (агрегат-документ: стадийные коллекции JSONB, замок
select_for_update на строке события, 9 стадий, 15 новых кодов ошибок) +
/api/ops/personnel/ из живых Employee. Домен "security-events" в том же
переключателе. Ловушки: (1) DRF regex-экшены жадные — forces/{id} съедает
forces/complete, нужен negative lookahead (порядок регистрации алфавитный по
имени метода); (2) скан test_error_codes_coverage читает ТОЛЬКО литеральные
DomainError(...) — хелперы-обёртки прячут коды, поднимать напрямую; (3) скан
расширен на пакет ops (SCAN_ROOTS). Осталось mock-first: duties, combat,
calendar, daily-expense (ОМ-вариант), ratings/*, analytics, service-reports,
ops/dictionaries, ops/settings, ops/audit-logs, ops/feedback + вся SPA /ops.

**Срез A2 сделан (10.08.2026, 93db190f): объекты-паспорта живые end-to-end** —
первый экран /security-ops с настоящим бэком. Механика подключения экранов:
пер-доменный `NEXT_PUBLIC_OPS_LIVE_DOMAINS=<domain>` (lib/ops-env.ts) — домен
выпадает из host-MSW (bypass в сеть), врезка api-gaps снимается в live и
честно говорит «бэк готов, экран на MSW по конфигурации» в mock. Следующие
экраны проводить ТЕМ ЖЕ переключателем. Свежесть/KPI считает СЕРВЕР (конверт
списка); валидации повторяют мок-хендлер дословно — мок и есть контракт.
Ловушка venv: requirements/development.txt тянет Django 6 (base <6.1) —
после него переставить Django==5.1.15 из requirements.txt.
