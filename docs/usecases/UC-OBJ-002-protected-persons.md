# UC-OBJ-002. Вести охраняемых лиц

| Поле | Значение |
|---|---|
| Модуль | Объекты и справочники ОМ |
| Актор | Держатели `catalog.view` (EMPLOYEE и все роли с OPS_READ/SECTION_READ) — просмотр; GVO_LEAD, EVENT_OFFICER (`gvo.manage` / `event.manage` / `event.create`) — заведение лица и фото; ADMIN — правка в Django Admin |
| Статус | Partial |
| Основание | `apps/operations/models_gvo.py` (OpsProtectedPerson, Category), `apps/operations/models_geo.py` (OpsCountry, OpsCity), `apps/ops/gvo.py` (list_persons, create_person, set_person_photo, person_event_history), `OpsProtectedPersonsViewSet` (`/api/ops/protected-persons/`, `POST …/{id}/photo/`, `GET …/{id}/history/`), `OpsCountriesViewSet` (`/api/ops/countries/`, `…/{id}/cities/`), FRONT `app/security-ops/persons/page.tsx`, `entities/protected-person`, `hooks/use-protected-persons.ts`, `features/gvo-section-edit/ui/ProtectedPersonPickDialog.tsx`, `shared/config/in-development.ts` |
| Дата актуализации | 2026-09-08 |

## Цель
Актор ведёт справочник охраняемых лиц (свои и иностранные), видит их связи с мероприятиями и объектами, заводит новое лицо с фотографией прямо из сводки ГВО.

## Предусловия
- Пользователь аутентифицирован; для чтения справочника и истории — право `catalog.view`; для заведения лица и фото — одно из `gvo.manage`, `event.manage`, `event.create`.
- Для заведения лица из сводки ГВО открыто мероприятие с формой сводки (`GvoEditForm` → `ProtectedPersonPickDialog`).

## Main Flow
1. Актор открывает экран «Охраняемые лица» (`/security-ops/persons`).
2. Система отдаёт активные лица справочника (`GET /api/ops/protected-persons/`, только `is_active=true`) с кодом `OL-N`, ФИО, позывным, категорией, биографией, фото, страной, должностью и фактами.
3. Актор переключает категорию кнопками «Наши» / «Иностранные» и просматривает карточки лиц.
4. По кнопке «Все мероприятия с ОЛ» актор раскрывает действующие мероприятия лица, по кнопке «Объекты ОЛ» — объекты, по кнопке «История» — закрытые ОМ лица с объектами, которые оно лично посетило (`GET /protected-persons/{id}/history/`).
5. В сводке ГВО актор выбирает лицо из справочника (поиск «имя, код, позывной») либо нажимает «Добавить» и заполняет форму «Новое охраняемое лицо»: ФИО, категория, позывной, биография, должность, страна, параметры образца «ключ = значение», файл снимка.
6. Система создаёт лицо (`POST /protected-persons/`, 201), присваивает код `OL-{pk}`, пишет в журнал `PROTECTED_PERSON_CREATED`.
7. Если приложен файл, система принимает снимок (`POST /protected-persons/{id}/photo/`, multipart `photo`), проверяет тип, размер и содержимое через Pillow, заменяет прежний снимок, пишет `PROTECTED_PERSON_PHOTO_SET`.
8. Новое лицо сразу встаёт в сводку ГВО; справочник обновляется.
9. Для страны/города в формах мероприятия система отдаёт активные страны (`GET /api/ops/countries/`) и города выбранной страны (`GET /countries/{id}/cities/`).

## Alternative Flow
- **AF1. Нет права `catalog.view`**: шаг 1 → `OpsAccessDenied`; сервер 403.
- **AF2. Нет права на заведение**: шаги 6–7 → сервер 403 (`RequirePermissionMixin`, кортеж прав `gvo.manage | event.manage | event.create`).
- **AF3. Пустое ФИО**: шаг 6 → на экране «Обязательное поле.» без запроса; сервер — 400 `VALIDATION_ERROR` `name: Обязательное поле.`; `category` вне `OURS/FOREIGN` → «Категория — «Наши» или «Иностранные».»; `facts` не список объектов `{key, value}` → ошибки `facts`.
- **AF4. Снимок не прошёл проверку**: шаг 7 → 400 `VALIDATION_ERROR` `photo`: «Приложите файл изображения.» / «Допустимы JPEG, PNG или WebP.» / «Файл больше 5 МБ.» / «Файл не является изображением JPEG, PNG или WebP.»; экран показывает «Лицо заведено, но снимок не загрузился — добавьте его позже.» и всё равно ставит лицо в сводку.
- **AF5. Лицо не найдено при загрузке фото**: шаг 7 → 404 «Охраняемое лицо не найдено.».
- **AF6. Страна не найдена или нечисловой id**: шаг 9 → 404 `ENTITY_NOT_FOUND` «Страна не найдена.».
- **AF7. Ошибка сети/сервера при создании**: шаг 6 → на экране «Не удалось завести лицо. Попробуйте ещё раз.» либо сообщение ошибки сервера.

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `OpsProtectedPerson` | create | name, category, callsign, bio, country, position, facts (список {key,value}), is_active=true; `code=OL-{pk}` проставляется в `save()` вторым сохранением |
| `OpsProtectedPerson.photo` | update | Файл `protected-persons/photos/{pk}-{uuid}.{jpg|png|webp}`; прежний файл удаляется (`photo.delete`) |
| Файловое хранилище (MEDIA) | create / delete | Сохранение нового снимка, удаление старого |
| `OpsAuditLog` (audit_service) | create | `PROTECTED_PERSON_CREATED` {code, name}; `PROTECTED_PERSON_PHOTO_SET` {code, photo} |
| HTTP-аудит `apps/audit` | create | AuditMiddleware на POST `/api/ops/protected-persons/…` |
| `OpsProtectedPerson`, `OpsCountry`, `OpsCity`, история ОМ | read | `GET /protected-persons/`, `/…/history/`, `/countries/`, `/countries/{id}/cities/` |

## Бизнес-требования (BR)
- **BR1.** Категория лица — только `OURS` («Наши») или `FOREIGN` («Иностранные») (check-constraint `chk_ops_protected_person_category`).
- **BR2.** Код лица уникален и формируется системой как `OL-{pk}`; пользователь его не задаёт (`editable=False`).
- **BR3.** ФИО обязательно (≤ 200), позывной ≤ 100, страна ≤ 120, должность ≤ 200; поля обрезаются по пробелам.
- **BR4.** Факты образца — список строк `{key, value}`; у строки обязателен непустой `key`; пустые значения с клиента не отправляются.
- **BR5.** Снимок: только `image/jpeg`, `image/png`, `image/webp`; не больше 5 МБ; формат определяется по байтам (Pillow), имя файла клиента не используется; новый снимок заменяет прежний.
- **BR6.** В списке и сводке отдаются только активные лица (`is_active=true`); деактивация и правка полей — только через Django Admin.
- **BR7.** История лица включает только закрытые ОМ (`stage=CLOSED`); участие определяется тремя связями: главное лицо бюллетеня, список лиц бюллетеня, объект посещения; в истории показываются только объекты, посещённые самим лицом.
- **BR8.** Страны: код ISO-2 (`^[A-Z]{2}$`), уникальные код и имя; город уникален внутри страны; отдаются только активные строки; страна с городами не удаляется (`PROTECT`) — только скрывается.

## Требования к логированию
- `audit_service.record(PROTECTED_PERSON_CREATED)` и `record(PROTECTED_PERSON_PHOTO_SET)` с актором (`resolve_actor_id(request) or request.user`), entity `protected_person`.
- HTTP-аудит успешных POST — AuditMiddleware `apps/audit`.
- `logging.getLogger` в `gvo.py`/`views.py` не используется.
- Просмотр истории лица и отказы по правам в журнал раздела не пишутся — `Не реализовано в коде`.
- Правки лица в Django Admin пишутся только стандартным `LogEntry` Django; в журнал раздела — `Не реализовано в коде`.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| ADMIN | полный (включая Django Admin) | `*` |
| GVO_LEAD | чтение + заведение лица и фото | `catalog.view` (через OPS_READ) + `gvo.manage` — `permission_map` (`create`, `photo` принимают кортеж прав) |
| EVENT_OFFICER | чтение + заведение лица и фото | `catalog.view` + `event.manage`, `event.create` |
| OPS_STAFF_COMMAND | чтение + заведение | `gvo.manage`, `event.create` в наборе роли |
| EMPLOYEE, DIRECTORATE_HEAD, DEPARTMENT_EXPENSE_OFFICER, DUTY_OFFICER, OPS_STAFF, PATROL_LEAD, EVENT_APPROVER, DUTY_PLANNER, DUTY_PLAN_APPROVER, OBJECT_KEEPER, RATING_EVALUATOR, ANALYST, AUDITOR, HEAD_DIRECTORATE_LINE, HEAD_DEPARTMENT_LINE, HEAD_OPS_UNIT | чтение | `catalog.view` (в OPS_READ / SECTION_READ) — `list`, `history`; экран `MODULE_PERMISSION["/security-ops/persons"]="catalog.view"` |
| FEEDBACK_TRIAGE, REFERENCE_ADMIN, SECURITY_ADMIN, INTEGRATION_USER | нет | права `catalog.view` нет → 403 |

## Требования к UX/UI
- **«Охраняемые лица»** — страница `/security-ops/persons`: заголовок «Профили лиц, в отношении которых организуются охранные мероприятия»; кнопки-переключатели категории «Наши» / «Иностранные» (aria-pressed); карточки лиц с фото, кодом, позывным, биографией; у карточки кнопки «Все мероприятия с ОЛ», «Объекты ОЛ» (раскрывающиеся списки, состояние загрузки связей) и «История» (`EventHistoryDialog`, пустое: «Объекты посещения у мероприятия не заведены — лицо названо в бюллетене»). Состояния: загрузка («Загрузка…» в карточке), ошибка, пусто. Шапка несёт метку «В разработке: Код охраняемого лица OL-N (№417)».
- Кнопки «Добавить лицо» на странице справочника нет — заведение только из сводки ГВО.
- **Диалог выбора лица** (`ProtectedPersonPickDialog`, в сводке ГВО): поиск «Поиск: имя, код, позывной», список с фото, кнопки «Добавить» (переход к форме) и закрытия.
- **Форма «Новое охраняемое лицо»** (тот же диалог): описание «Запись попадёт в справочник «Охраняемые лица» и сразу встанет в сводку.»; поля: ФИО (обязательное, ошибка «Обязательное поле.» под полем, `aria-invalid`), категория (по умолчанию `FOREIGN`), позывной, биография, должность (подсказка «Президент Черногории»), страна (подсказка «Черногория»), параметры образца по ключам `PROTECTED_PERSON_FACT_KEYS`, файл снимка (`accept="image/jpeg,image/png,image/webp"`); кнопки «Назад» и отправки, отключаются на время запросов; общая ошибка выводится строкой над кнопками.
- Справочник стран/городов собственного экрана не имеет — используется в формах мероприятия (селекты страна → город).

## Открытые вопросы
- `in-development.ts`: «Код охраняемого лица OL-N (№417)» на `/security-ops/persons` и «Справочник стран и городов (№417)» на `/security-ops/dictionaries` — открытые карточки Plane; основание статуса Partial.
- Правка и деактивация лица с экрана не реализованы — только Django Admin («Только чтение с фронта; правка — Django Admin», docstring вьюсета).
- Заведение лица через API доступно EVENT_OFFICER/GVO_LEAD, но на самом экране справочника кнопки нет; путь существует только в сводке ГВО.
- Поле `country` у лица — свободная строка, со справочником `OpsCountry` не связано.
- Страны и города правятся только в Django Admin; в UI справочников (`/security-ops/dictionaries`) их нет.
- `is_active=false` лица не отдаётся никуда (в том числе в историю) — история закрытых ОМ по деактивированному лицу недоступна с экрана.
