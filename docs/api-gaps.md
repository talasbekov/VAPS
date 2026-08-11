# Пробелы API: экраны без бэкенда

Снято на живом стенде: целевой бэк `Backend/PersonnelStatus/Personnel-Records`
(Django, :8100), фронт `Backend/PersonnelStatus/PersonalRecordFront` (Next, :3106),
ветка `claude/smart-josparlau-e55`.

Источники истины:

* список маршрутов целевого бэка — резолвер Django (`get_resolver()`, 391 запись);
* список маршрутов донора — `Backend/VAPS/schema.yaml` (39 записей).

**Ни один путь с префиксом `/api/ops/` не существует ни в целевом бэке, ни в
доноре.** На стенде эти запросы отдаёт браузерный мок-слой MSW
(`mocks/ops/browser.ts`, включён по умолчанию: `lib/ops-env.ts` считает режим
мок-ом, пока не выставлен `NEXT_PUBLIC_OPS_DATA_SOURCE=api`). Из-за этого экраны
раздела выглядят рабочими — именно это и маскирует дыру.

## Как устроена заглушка

Один переиспользуемый компонент, одна точка врезки:

| Файл | Роль |
| --- | --- |
| `PersonalRecordFront/lib/api-gaps.ts` | реестр «маршрут → недостающие пути», поиск по самому длинному префиксу |
| `PersonalRecordFront/components/api-gap-notice.tsx` | единственная разметка пометки |
| `PersonalRecordFront/components/dashboard-layout.tsx` | врезка в `<main>` — общий корень контента хостовых экранов, `/security-ops/*` и `/ops` |

Пометка не скрывает содержимое и не ломает навигацию: она рисуется над контентом
экрана и прямо говорит, что данные ниже — мок.

## Экран → недостающий путь → что показывает заглушка

Текст пометки: **«Не подключено — ‹раздел›: на бэке нет ‹путь›»**, ниже —
перечисление остальных недостающих путей и приписка «Всё, что показано ниже,
отдаёт браузерный мок-слой MSW, а не сервер».

| Экран | Недостающие пути | Что показывает заглушка |
| --- | --- | --- |
| ~~`/feedback/` (хост)~~ | **переписан целиком (срез J)**: легаси-чат (`FeedbackChat`, опрос несуществующего `/api/dictionaries/feedback/`) удалён; адрес РЕНДЕРИТ новый модуль §28 поверх живого `/api/ops/feedback-requests/` — реализация одна, у страницы два входа (`/feedback` и `/security-ops/feedback`), ссылки внутри модуля строятся от текущего пути, пользователь остаётся в своём разделе | врезки нет (live: feedback) / «Демоданные — Обратная связь раздела ОМ» (mock) |
| ~~`/ops/*` (встроенная SPA)~~ | **выведена из навигации**: SPA дублировала переписанные нативные страницы `/security-ops/*` (живой `/api/ops/*`); группа `/ops/*` снята из сайдбара, адреса редиректят на нативные экраны и живые хостовые (`/employees`, `/organization`, `/reports`, `/feedback`). Копия `josparlau/` и sync-инфраструктура демонтированы; Vite-источник `frontend/` остаётся | врезки нет: экранов SPA в навигации больше нет |
| ~~`/security-ops/command-center/`, `/security-ops/events/`, `…/events/[id]/`~~ | **закрыт срезом B1**: `/api/ops/security-events/` (реестр с фильтрами, карточка, создание с привязкой версии паспорта, все девять стадий жизненного цикла) + `/api/ops/personnel/` (кадровый снимок из живых Employee). Экраны проведены `NEXT_PUBLIC_OPS_LIVE_DOMAINS=security-events` | врезки нет (live) / «Демоданные — Охранные мероприятия» (mock) |
| ~~`/security-ops/objects/`, `/security-ops/objects/[id]/`~~ | **закрыт срезом A2**: конверт списка (kpi/freshness/политика), `PATCH …/passport/`, `POST …/passport/versions/` — всё живое. Экран проведён пер-доменным переключателем `NEXT_PUBLIC_OPS_LIVE_DOMAINS=objects`; в mock-режиме врезка честно говорит «бэк готов, экран на MSW по конфигурации» | врезки нет (live) / «Демоданные — Объекты и паспорта» (mock) |
| ~~`/security-ops/duties/`, `/security-ops/duties/[id]/`~~ | **закрыт срезом C1**: виды+политика, месячный план (черновик/проверка/утверждение/новая редакция, отпечаток состава, конфликты и action-policy по RBAC), смены с циклом PLANNED→…→COMPLETED и отменой, объекты и кандидаты формы. Проведён `NEXT_PUBLIC_OPS_LIVE_DOMAINS=duties` | врезки нет (live) / «Демоданные — План дежурств» (mock) |
| ~~`/security-ops/duties/combat/`~~ | **закрыт срезом C2**: реестры видов и Трасс, кандидаты из живых кадров, смены с процессом §24.1 целиком (потребность → подача → рассмотрение → ознакомление → заступление → сдача смены → факт; замена до заступления; DOUBLE_ASSIGNMENT на дату). Проведён `NEXT_PUBLIC_OPS_LIVE_DOMAINS=combat` | врезки нет (live) / «Демоданные — Боевые группы» (mock) |
| ~~`/security-ops/calendar/`~~ | **закрыт срезами C1+C2**: оба источника (duty-shifts и combat-duty-shifts) живые | врезки нет (live: duties,combat) / «Демоданные — Календарь смен» (mock) |
| ~~`/security-ops/daily-expense/`~~ | **закрыт срезом L-адаптеров**: `/api/ops/daily/*` — ТОНКИЕ адаптеры над живым `/api/operations/` (bulk-статусы с атомарным построчным отказом, сдача дня с окном/версиями/поправкой — те же сервисы, свой только адрес и форма контракта: строковые id, все версии дня, читаемая подпись сдавшего). Своего бэка нет намеренно (группа L плана «не строить — дубликат»). Проведён `NEXT_PUBLIC_OPS_LIVE_DOMAINS=daily` | врезки нет (live: daily) / «Демоданные — Расход дня (ОМ)» (mock) |
| ~~`/security-ops/ratings/*` (все семь экранов)~~ | **закрыт срезом G**: сводка/динамика/карточка (агрегат считает сервер, вытесненные исключены), рабочее пространство с отправкой и исправлением (идемпотентность, конфликт редакций 409, замок закрытого ОМ), реестр без закрытых полей, аналитика §22.16 с подавлением малых групп, свой журнал §19.27, уведомления, экспорт CSV с журналом выдачи. Проведён `NEXT_PUBLIC_OPS_LIVE_DOMAINS=ratings` | врезки нет (live: ratings) / «Демоданные — Оперативный рейтинг» (mock) |
| ~~`/security-ops/analytics/`, `…/operations/`~~ | **закрыт срезом H**: снимок KPI с детерминированным snapshotId (выборка = число), drill-down со своим правом и отказом SNAPSHOT_OUTDATED, блок «Требует внимания» по политике из «Настроек», нагрузка §22.9 (план/факт порознь, LOAD_POLICY), уровни §22.15 и воронка §22.14 по НОВОМУ журналу переходов ОМ (пишется операциями стадий с этого среза). Проведён `NEXT_PUBLIC_OPS_LIVE_DOMAINS=analytics` | врезки нет (live: analytics) |
| ~~`/security-ops/service-reports/`, `…/history/`, `…/[reportJobId]/`~~ | **закрыт срезом I**: каталог типов с пределами из REPORT_LIMITS, асинхронная генерация (PENDING→PROCESSING→COMPLETED\|FAILED на чтении), immutable-артефакт с ревизиями серии и замороженным сроком хранения, server-side masking (обычный экспорт без sensitive-колонок ВООБЩЕ), retry с переиспользованием пригодного артефакта / new-revision, скачивание с повторной проверкой права/sensitive/владельца/срока. Проведён `NEXT_PUBLIC_OPS_LIVE_DOMAINS=service-reports` | врезки нет (live: service-reports) |
| ~~`/security-ops/dictionaries/`, `…/[code]/`~~ | **закрыт срезом D1**: реестры с честными связями (TRACKED поимённо по живым журналам ОМ и groupCode; NOT_TRACKED — с причиной), заведение/деактивация/удаление с доказательством отсутствия связей | врезки нет (live: dictionaries) |
| ~~`/security-ops/settings/`~~ | **закрыт срезом D1**: настройки — владелец политик, правка пишется НАСКВОЗЬ в синглтоны свежести/конфликтов с версией раздела; журнал изменений с готовыми подписями; право правки решает сервер по-записно | врезки нет (live: settings) |
| ~~`/security-ops/audit/`~~ | **закрыт срезом D1**: read-only поверх ЖИВОГО журнала раздела (те же строки, что пишут срезы A2-C2) | врезки нет (live: audit) |
| ~~`/security-ops/feedback/`, `/security-ops/feedback/[feedbackId]/`~~ | **закрыт срезом J**: реестр со сводкой по всему видимому набору и страницами (черновик не открывается никаким правом, содержание чужого конфиденциального вырезает сервер вместе с превью, поиск — только по видимым полям), создание с согласием на техинформацию и вложениями-метаданными, отправка черновика, карточка с единой лентой timeline+audit (внутренняя заметка и её событие скрываются целиком), разбор одной операцией по карте переходов, закрытие с обязательным ответом автору. Проведён `NEXT_PUBLIC_OPS_LIVE_DOMAINS=feedback` | врезки нет (live: feedback) / «Демоданные — Обратная связь раздела ОМ» (mock) |
| `/security-ops/changelog/` | — | пометки нет намеренно: журнал изменений порта собран из статического текста, бэкенд ему не нужен |

Хостовые экраны `/dashboard/`, `/organization/`, `/employees/`, `/statuses/`,
`/reports/` пометки не получают: они ходят в живой бэк и данные отдают настоящие.

### Полный список путей `/api/ops/*`, объявленных во фронте

41 константа (`entities/*/model/*.ts`, `entities/*/index.ts`); ни одна не
резолвится ни целевым бэком, ни донором:

```
/api/ops/audit-logs/                      /api/ops/objects/
/api/ops/combat-duty-shifts/              /api/ops/operational-rating-dynamics/
/api/ops/combat-duty-types/               /api/ops/operational-rating-employee/
/api/ops/combat-roster-candidates/        /api/ops/operational-ratings/
/api/ops/combat-routes/                   /api/ops/operations-analytics/
/api/ops/daily/daily-submissions/         /api/ops/personnel/
/api/ops/daily/divisions/                 /api/ops/rating-analytics/
/api/ops/daily/employees/                 /api/ops/rating-audit/
/api/ops/daily/statuses-bulk/             /api/ops/rating-export-artifacts/
/api/ops/dictionaries/                    /api/ops/rating-exports/
/api/ops/duty-candidates/                 /api/ops/rating-notifications/
/api/ops/duty-monthly-plan/               /api/ops/security-events/
/api/ops/duty-plan-objects/               /api/ops/service-analytics/
/api/ops/duty-shifts/                     /api/ops/service-analytics-attention/
/api/ops/duty-types/                      /api/ops/service-analytics-drilldown/
/api/ops/evaluation-registry/             /api/ops/service-analytics-presets/
/api/ops/evaluation-work-items/           /api/ops/service-report-artifacts/
/api/ops/evaluation-workspace/            /api/ops/service-report-jobs/
/api/ops/feedback-requests/               /api/ops/service-report-types/
/api/ops/load-analytics/                  /api/ops/setting-changes/
                                          /api/ops/settings/
```

Вне семейства `/api/ops/` недостающих путей не осталось: `/api/dictionaries/feedback/` умер вместе с легаси-чатом `/feedback/` (срез J).

## Кандидаты на следующие срезы переезда

Эти пути **есть в доноре** `Backend/VAPS/schema.yaml`, но ещё не переехали в
целевой бэк. Это не «заглушка навсегда», а очередь переезда. Вычеркнутые
строки переехали — срезы 157–159; во всех трёх перенесён КОНТРАКТ, а не
модель, и все три только для чтения.

| Путь донора | Состояние в целевом бэке |
| --- | --- |
| ~~`/api/core/staffing-slots/`~~ | **переехал, срез 157** — поверх `staff_unit.StaffUnit`, только чтение |
| ~~`/api/core/staffing-slots/{id}/`~~ | **переехал, срез 157** (тот же ReadOnly-роутер) |
| `/api/core/staffing-slots/{id}/assign-employee/` | нет — экшен пишущий, правка штата живёт на старой стороне |
| `/api/core/staffing-slots/{id}/release/` | нет — экшен пишущий, там же |
| ~~`/api/core/vacancies/`~~ | **переехал, срез 158** — свободные слоты (без сотрудника), строка та же, что у staffing-slots; параметр `division_id` есть, `date` не заведён (у старой схемы нет временных границ) |
| `/api/core/employees/{id}/archive/` | нет |
| `/api/core/employees/{id}/restore/` | нет |
| `/api/core/divisions/{id}/leaf-descendants/` | нет |
| ~~`/api/documents/attachments/`~~ | **переехал, срез 159** — списочный GET поверх `operations.OpsAttachment`, область по выпуску-владельцу. ВНИМАНИЕ: у донора по этому адресу только POST (загрузка); переехал ряд полей его проекции Attachment, сам список заведён заново. Загрузка НЕ переехала |
| `/api/documents/attachments/{id}/download/` | нет (у цели — `/api/operations/attachments/{id}/download/`, другой префикс; `id` в списке среза 159 — именно тот, что принимает этот маршрут) |
| `/api/operations/expense-reports/` | переименовано у цели в `/api/operations/strength-report/` — сверить контракт перед переездом |
| `/api/operations/expense-reports/period/` | переименовано у цели в `/api/operations/strength-report/period/` |
| `/api/operations/expense-reports/override-tomorrow-block/` | у цели `/api/operations/tomorrow-block/override/` — другой путь, тот же смысл |

Остальные 26 путей донора у цели уже есть (`/api/core/*`, `/api/audit/logs/`,
`/api/notifications/`, `/api/operations/{daily-submissions,my-permissions,
permissions,roles,statuses/bulk,temporary-duty,traffic-light/tree,user-roles}`).

## Найденные и починенные дефекты (для контекста)

1. **`/organization/`** — схема штатных единиц. `getStaffUnits` в `lib/api.ts` не
   понимал конверт DRF-пагинации `{count,next,previous,results}` и плоскую строку
   списка (`position`/`employee` в корне вместо массива `employees`), молча
   возвращал `[]`, и экран писал «Данные не загружены из API» при HTTP 200.
   Починен адаптер формы на фронте — контракт бэка не трогали.
2. **`/feedback/`** — бесконечный опрос 404. `FeedbackChat` глушил ошибку в
   `console.error` и продолжал опрос раз в 3 секунды; экран показывал «Пока нет
   сообщений», выдавая отсутствующий бэк за пустой список. Опрос теперь
   останавливается на первой ошибке, ошибка выводится на экран.

### Обход стенда Playwright 11.08.2026 (коммит `00a7c37f`)

Полный клик-обход по всем кнопкам, 80 страниц. Четыре дефекта — все 404:

3. **`/statuses`** — маршрут `/api/secondments/` был выключен в корневом
   urlconf с самого импорта донора: вьюхи ходили в поля кастомного пользователя
   (`user.role`, `user.division`), которых у целевой модели нет. Область
   портирована на цепочку `User → Employee → StaffUnit → Division`, сериализатор
   отдаёт `employee_detail`/`division_detail` в форме, которую ждёт фронт;
   роут включён.
4. **Карточка отчёта** — `/api/ops/service-report-jobs/{id}/detail/`. Фронт
   зовёт **только** `/detail/`, ручки не было. Заведён алиас `retrieve` по
   контракту мока — контракт фронта не трогали.
5. **Уведомления рейтинга** — `deep_link` вёл на `/ratings/workspace` (адрес
   выведенной SPA-встройки). Генератор и сид переведены на нативный
   `/security-ops/ratings/workspace`; стендовые строки поправлены данными.
6. **Сайдбар «Настройки»** — `/settings` был 404. Страница рендерит модуль
   настроек политик по приёму `/feedback`: одна реализация, два входа.

**Не дефекты** (валидация/домен, а не дыра): `DAY_NOT_SUBMITTED` на экспорте
несданного дня; 400/422 на пустых формах диалогов.

7. **Hydration mismatch на `/dashboard`** (коммит `8179e037`) — три `new Date()`
   прямо в JSX (шапка «Последнее обновление», бейдж «Синхронизация»,
   «Последняя проверка») расходились SSR/клиент на границе секунды: 2 из 8
   жёстких перезагрузок падали. Время ставится в `useEffect`, до маунта — «…».

**`CLIENT_FETCH_ERROR` next-auth — не чинится:** `net::ERR_ABORTED` на
`/api/auth/session`, когда жёсткая навигация обрывает in-flight фетчи страницы
логина. Библиотечный шум next-auth v4, сессия поднимается штатно.
