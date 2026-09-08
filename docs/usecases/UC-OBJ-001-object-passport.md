# UC-OBJ-001. Вести объект охраны и публиковать версию паспорта

| Поле | Значение |
|---|---|
| Модуль | Объекты и справочники ОМ |
| Актор | OBJECT_KEEPER (ведение паспорта), EVENT_OFFICER (заведение объекта из формы ОМ), все держатели `object.view` (чтение) |
| Статус | Partial |
| Основание | `apps/operations/models_object.py` (OpsSecurityObject, OpsObjectSector, OpsSecurityPost, OpsPassportVersion, OpsPassportFreshnessPolicy), `apps/ops/passport.py`, `SecurityObjectViewSet` (`/api/ops/objects/`, `/objects/{id}/history/`, `PATCH /objects/{id}/passport/`, `POST /objects/{id}/passport/versions/`), `apps/ops/gvo.py::object_event_history`, FRONT `app/security-ops/objects/page.tsx`, `app/security-ops/objects/[id]/page.tsx`, `app/security-ops/objects/[id]/passports/[versionId]`, `features/object-passport` (PassportForm, PassportVersionsPanel, PassportPlannedTabs), `features/object-duty-forces`, `hooks/use-security-objects.ts`, `hooks/use-object-passport.ts`, `features/create-security-event/ui/ObjectPicker.tsx` |
| Дата актуализации | 2026-09-08 |

## Цель
Хозяин паспортов ведёт реестр охраняемых объектов, правит черновик паспорта (секторы и посты) и публикует неизменяемую версию, по которой система считает состояние и актуальность паспорта.

## Предусловия
- Пользователь аутентифицирован и имеет право `object.view` (чтение) или `object.manage` (правка паспорта, публикация, заведение объекта).
- В базе есть строка политики актуальности `OpsPassportFreshnessPolicy` (singleton_key=1); без неё список объектов отвечает 422 `VALIDATION_ERROR` «Политика актуальности паспорта не настроена» (`passport.read_policy`).

## Main Flow
1. Актор открывает реестр «Объекты и паспорта» (`/security-ops/objects`).
2. Система отдаёт список объектов одним ответом вместе с KPI по всему реестру, состоянием актуальности каждого паспорта и версией политики (`GET /api/ops/objects/`, конверт `{results, freshness, kpi, freshnessPolicy, unavailableKpi}`).
3. Актор отбирает объекты вкладками (все / собственные / охраняемые / объекты ОМ), фильтрами (состояние объекта, паспорт, регион, актуальность), поиском и плитками KPI; переключает вид карточки/таблица.
4. Актор открывает карточку объекта (`/security-ops/objects/{id}`) и видит вкладки «Общие данные», «Инфраструктура», «Посты и секторы», «Чек-лист», «Привлекаемые группы», «История».
5. На вкладке «Посты и секторы» актор правит черновик: добавляет/удаляет секторы, в секторе — посты (название, задача, требования) и сохраняет.
6. Система заменяет черновик целиком (`PATCH /objects/{id}/passport/`): старые секторы удаляются, новые создаются в порядке формы, пересчитывается состояние паспорта (RED/YELLOW/GREEN).
7. На вкладке «История» актор указывает дату вступления в силу и примечание и публикует версию.
8. Система создаёт `OpsPassportVersion` со снимком секторов (`sectors_snapshot`), номером версии `+1`, автором и временем публикации; пересчитывает состояние паспорта; пишет в журнал раздела `PASSPORT_VERSION_PUBLISHED` в той же транзакции (`POST /objects/{id}/passport/versions/`, 201).
9. Актор открывает опубликованную версию (`/security-ops/objects/{id}/passports/{versionId}`) — снимок неизменяем; на неё ссылаются карточки ОМ (`passportBinding`).
10. Актор по кнопке «История» в реестре видит закрытые ОМ на объекте и посещавших его лиц (`GET /objects/{id}/history/`).
11. Отдельный путь: офицер ОМ при создании мероприятия, не найдя объект в списке, заводит минимальную карточку объекта прямо из формы (`POST /api/ops/objects/`, `ObjectPicker`): имя обязательно, код `OBJ-NNN` выдаётся по порядку, паспорт `RED`, объект `ACTIVE`.

## Alternative Flow
- **AF1. Нет права `object.view`**: шаг 1/4 → экран показывает `OpsAccessDenied` («паспорта объекта»); сервер отвечает 403 через `RequirePermissionMixin`.
- **AF2. Нет права `object.manage`**: шаги 6, 8, 11 → сервер отвечает 403; форма паспорта и панель публикации на экране не скрываются (экран проверяет только `object.view`), ошибка приходит в `mutation.error`.
- **AF3. Пустое название сектора или поста**: шаг 6 → 400 `VALIDATION_ERROR` с построчными ключами `sectors.{i}.name`, `sectors.{i}.posts.{j}.name` («Укажите название сектора/поста»); `sectors` не список → «Ожидается список секторов».
- **AF4. Публикация без постов**: шаг 8 → 400 `VALIDATION_ERROR` `sectors`: «В паспорте нет ни одного поста — публиковать нечего»; на экране кнопка публикации отключена при отсутствии постов или пустой дате.
- **AF5. Некорректная дата или версия на эту дату уже есть**: шаг 8 → 400 `effectiveFrom`: «Укажите дату вступления в силу» / «На эту дату версия паспорта уже опубликована»; гонка двух публикаций ловится уникальностью БД `uniq_ops_passport_version_effective_from`.
- **AF6. Объект не найден / нечисловой id**: шаги 6, 8 → 404 `ENTITY_NOT_FOUND` «Объект не найден».
- **AF7. Заведение объекта с ошибками**: шаг 11 → 400 `VALIDATION_ERROR`: `name` обязательно, не длиннее 255, «Объект с таким названием уже есть в реестре» (без учёта регистра); `objectType` ≤ 100, `region` ≤ 255, `address` ≤ 500; `ownership` вне `OWN/GUARDED` → «Неизвестный вид принадлежности».
- **AF8. Политика актуальности не настроена**: шаг 2 → 422 `VALIDATION_ERROR` «Политика актуальности паспорта не настроена»; экран показывает ошибку загрузки.

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `ops_security_objects` (OpsSecurityObject) | create | Минимальная карточка из формы ОМ: name, code `OBJ-NNN`, object_type, region, address, object_state=ACTIVE, passport_state=RED, ownership |
| `ops_security_objects.passport_state`, `updated_at` | update | Пересчёт RED/YELLOW/GREEN после правки черновика и публикации (`refresh_passport_state`) |
| `ops_object_sectors` (OpsObjectSector) | delete + create | Черновик заменяется целиком: все секторы объекта удаляются (каскадом — посты), создаются заново с `position` |
| `ops_security_posts` (OpsSecurityPost) | create | Посты сектора: name, task, requirements, position |
| `ops_passport_versions` (OpsPassportVersion) | create | version_number, effective_from, published_at (Clock.now), published_by (актор), note, sectors_snapshot (JSON camelCase) |
| `OpsAuditLog` (audit_service) | create | `PASSPORT_VERSION_PUBLISHED`, entity `security_object`, new_value {versionNumber, effectiveFrom, code} |
| HTTP-аудит `apps/audit` | create | AuditMiddleware пишет каждый успешный write-запрос к `/api/` (POST/PATCH) |
| Реестр, карточка, история, версия | read | `GET /objects/`, `/objects/{id}/`, `/objects/{id}/history/` |

## Бизнес-требования (BR)
- **BR1.** Код объекта уникален (`code unique`), название и код непустые (check-constraints); название объекта уникально без учёта регистра при заведении из формы ОМ.
- **BR2.** Состояние объекта (`ACTIVE`/`ARCHIVED`) и состояние паспорта (`RED`/`YELLOW`/`GREEN`) — независимые поля; принадлежность — `OWN`/`GUARDED`.
- **BR3.** Состояние паспорта считается сервером: `RED` — нет ни одного поста; `YELLOW` — посты есть, но нет опубликованной версии либо черновик расходится с последней версией (по именам секторов и постов); `GREEN` — черновик совпадает с последней версией. Пересчитывается только при правке черновика и публикации.
- **BR4.** Актуальность паспорта — производное на чтении: `verificationDueAt = effective_from последней версии + verification_interval_days`; `OVERDUE` при отрицательном остатке дней, `DUE_SOON` при остатке ≤ ceil(interval × due_soon_percent / 100), иначе `FRESH`; без версий — `NO_PUBLISHED_VERSION`. Интервал и порог берутся только из хранимой политики, константы в коде нет.
- **BR5.** Черновик паспорта сохраняется целиком (без построчного merge); опубликованные версии правкой черновика не затрагиваются.
- **BR6.** Версия паспорта неизменяема; номер версии растёт на 1; на одну дату вступления в силу — не более одной версии; version_number ≥ 1.
- **BR7.** Публикация возможна только при наличии хотя бы одного поста; журнал пишется в той же транзакции, что и версия.
- **BR8.** KPI реестра (`total`, `passportGreen/Yellow/Red`, `verificationOverdue`, `neverPublished`) считаются сервером по всему реестру; список не пагинируется.
- **BR9.** Показатели «Есть открытые замечания» и «Нет обязательной схемы» объявляются сервером недоступными с причиной (`UNAVAILABLE_KPI`).
- **BR10.** История объекта включает только закрытые ОМ (`stage=CLOSED`), лица берутся с объекта посещения мероприятия.

## Требования к логированию
- Публикация версии — `audit_service.record(PASSPORT_VERSION_PUBLISHED, entity_type=security_object, new_value={versionNumber, effectiveFrom, code})` в транзакции публикации.
- Все успешные POST/PATCH к `/api/ops/objects/…` — HTTP-аудит `apps/audit` (AuditMiddleware).
- Логгер приложения (`logging.getLogger`) в `passport.py` и `views.py` не используется; в `config/settings/base.py` только console-handler.
- Заведение объекта (`create_object`) и правка черновика (`update_passport`) в журнал раздела `audit_service` не пишутся — `Не реализовано в коде` (есть только HTTP-аудит).

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| ADMIN | полный | `*` |
| OBJECT_KEEPER | полный | `object.view` + `object.manage` — `permission_map` SecurityObjectViewSet (`create`, `passport`, `passport_versions` → `object.manage`) |
| EMPLOYEE, DUTY_OFFICER, EVENT_OFFICER, PATROL_LEAD, GVO_LEAD, DUTY_PLANNER, HEAD_DIRECTORATE_LINE, HEAD_DEPARTMENT_LINE, HEAD_OPS_UNIT | чтение | `object.view` — `list`, `retrieve`, `history`; экран: `hasPermission("object.view")`, `MODULE_PERMISSION["/security-ops/objects"]` |
| EVENT_OFFICER (заведение объекта из формы ОМ) | нет | `create` требует `object.manage`, которого у EVENT_OFFICER нет — см. Открытые вопросы |
| Остальные роли | нет | 403 от `RequirePermissionMixin` |

## Требования к UX/UI
- **Реестр «Объекты и паспорта»** — страница `/security-ops/objects`. Вкладки-счётчики: «Все», «Собственные объекты» (`ownership=OWN`), «Охраняемые объекты» (`GUARDED`), «Объекты ОМ» (`hasSecurityEvents`); KPI-плитки — «Всего объектов», «Паспорта актуальны», «Требуют актуализации», «Требуют внимания», «Проверка просрочена», «Паспорт не публиковался» (клик по плитке ставит фильтр, повторный снимает); поиск «Поиск по названию, адресу, рег. номеру или типу»; фильтры-селекты по состоянию, паспорту, региону; кнопка сброса фильтров; переключатель вида «Карточки»/«Таблица»; состояние всех фильтров живёт в URL. Состояния: загрузка, ошибка запроса, пусто. Кнопка «История» открывает `EventHistoryDialog` (пустое: «Охраняемые лица у этого объекта не названы»).
- **Карточка объекта** — страница `/security-ops/objects/{id}`, вкладки «Общие данные» (поля объекта, свежесть проверки, бейдж `PassportStateBadge`), «Инфраструктура», «Чек-лист», «Привлекаемые группы» (макеты `PassportPlannedTabs` с плейсхолдерами и строкой причины — данных на сервере нет), «Посты и секторы» (`PassportForm`), «История» (`PassportVersionsPanel`); секция «Дежурные силы» (`DutyForcesSection`, дата, пустое: «На объекте нет заступивших сотрудников»); внизу — список «Чего нет» (`MISSING_TABS`).
- **PassportForm**: строки секторов (поле «Название сектора», кнопка удалить), в секторе — посты (поля «Название поста», «Задача», «Требования к назначению», кнопка «Удалить пост»), кнопки добавления сектора/поста, кнопка сохранения активна только при изменениях (`dirty`) и не во время запроса; ошибки 400 раскладываются по полям через `useOpsMutation` → `onFormError`.
- **PassportVersionsPanel**: список версий («действует с {дата} · опубликовано … · примечание», ссылка на версию), поле даты вступления в силу, поле «Примечание к публикации», кнопка публикации (отключена без даты, без постов или в ходе запроса).
- **Версия паспорта** — страница `/security-ops/objects/{id}/passports/{versionId}` (снимок только для чтения).
- **ObjectPicker** (в диалоге создания ОМ): ввод названия и заведение объекта по одному полю `name`.
- Нет права — экран `OpsAccessDenied`.

## Открытые вопросы
- Вкладки «Инфраструктура», «Чек-лист», «Привлекаемые группы» карточки объекта не имеют модели и ручки на сервере — показываются макетами-плейсхолдерами (`PassportPlannedTabs`); основание статуса Partial.
- `MISSING_TABS` в `[id]/page.tsx`: нет «Мероприятий и инцидентов» во вкладке «История» (построчного журнала правок и ленты ОМ сервер не отдаёт), у объекта нет поля «Старший объекта», у поста — типа (наружный/внутренний) и предельного времени без смены.
- KPI «Есть открытые замечания» и «Нет обязательной схемы» объявлены сервером недоступными (`UNAVAILABLE_KPI`): замечания не моделируются, документов/схем нет (нет blob-хранилища).
- `create` объекта охраняется `object.manage`, но точка входа (`ObjectPicker`) — в форме создания ОМ у EVENT_OFFICER, у которого этого права по `ROLE_PERMISSIONS` нет: путь «объекта нет в списке — добавить» работает только у OBJECT_KEEPER/ADMIN.
- Экран карточки проверяет только `object.view`: форма правки и публикации видна читателю без `object.manage`, отказ приходит от сервера 403.
- Правка объекта (название, тип, адрес, состояние `ARCHIVED`, принадлежность) через API не реализована — `ReadOnlyModelViewSet` + `create` только минимальной карточки; `Не реализовано в коде`.
- Вид, регион и адрес объекта — свободные строки, справочника видов объектов нет (docstring модели).
- «Дежурные силы» на карточке берутся из `useDutyAssignments` (статусы «На дежурстве»), а не из собственной сущности объекта.
