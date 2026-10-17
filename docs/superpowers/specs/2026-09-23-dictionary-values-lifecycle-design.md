# UC-REF-001, подпроект 2 «Жизненный цикл записи»: преемник, удаление по связям, даты

Дата: 23.09.2026. База: `main` после подпроекта 1 (право `dictionary_value.manage`,
поля kk, харнесс `client_for`).

## Зачем

Issue UC-REF-001 различает четыре операции над значением справочника.
Подпроект 1 закрыл право и двуязычие; этот закрывает семантику операций:

| Операция | Смысл | Поведение после подпроекта |
|---|---|---|
| Добавление | новая запись | как было, плюс проверка длины kk |
| Корректирование | меняется формулировка | update той же записи (было «Редактировать»); новое название видно в старых данных само, потому что экраны ищут подпись по коду |
| Редактирование | значение меняется по сути | запись-преемник с ссылкой на прежнюю; прежняя закрывается для нового выбора, но остаётся в старых данных |
| Удаление | запись больше не нужна | нет ссылок — физическое удаление; есть ссылки — деактивация с датой неактуальности |

Сегодня связи считаются только у двух справочников из девяти, остальные на
удаление всегда отвечают 422; у должностей и званий нет ни `is_active`, ни
аудита; даты неактуальности нет нигде.

## Объём

Входит:

1. Счётчик связей для всех девяти справочников ОМ и для должностей и званий.
2. Поля `inactive_since` и `supersedes` у `OpsDictionaryEntry`, `Position`, `Rank`;
   у `Position` и `Rank` ещё `is_active`.
3. Операции сервиса: `supersede_entry`, `remove_entry`, доработанный
   `set_entry_active`; те же для кадровых в новом модуле `apps/dictionaries/lifecycle.py`.
4. Защищённые системные коды, которые нельзя снять или заменить.
5. Аудит: `DICTIONARY_ENTRY_SUPERSEDED`, сущности `position` и `rank`, события
   кадровых справочников.
6. API: новые поля и ручки, изменённый ответ DELETE.
7. Экраны справочников: диалог удаления с исходом, диалог замены, кнопки
   «Исправить»/«Заменить», бейджи «неактивна с …», «заменена на …»; у кадровых
   ещё «Деактивировать/Активировать».
8. Отложенные мелочи подпроекта 1: длина `labelKk` (400, не 500), `maxLength` на
   полях kk, `?? ""` на новых полях, пробы анонима и `labelKk: null`.

Не входит: подпись для неактивных кодов на экранах-потребителях (сегодня они
показывают сырой код для любой неактивной записи, это существующее поведение,
задача подпроекта 3 вместе с табличным экраном); учёт цепочки замен в
аналитике; контроль похожих записей; единый перечень; страны и города.

## 1. Связи: один сборщик на справочник

`apps/ops/dictionaries.py` получает `collect_usage(dictionary_code) -> dict[str, list[reference]]`:
за один проход по источникам считаются связи ВСЕХ кодов справочника, а
`usage_of(entry, collected=None)` читает из готовой карты (список значений
считает карту один раз, а не по проходу на запись, как сейчас у журналов).

Источники по кодам (все хранят код строкой, FK нет нигде):

| Справочник | Где хранится код | Способ |
|---|---|---|
| JOURNAL_ENTRY_TYPES | `OpsSecurityEvent.journal_entries[].type` | один проход по событиям |
| POST_REQUIREMENT_GROUPS | `OpsDictionaryEntry.group_code` детей POST_REQUIREMENTS | запрос |
| PLACEMENT_ROLES | `OpsSecurityEvent.placement_assignments[].roleCode` | тот же проход по событиям |
| PLACEMENT_SECTIONS | `OpsSecurityEvent.placement_assignments[].sectionCode` | тот же проход |
| EVENT_PARTICIPATION_KINDS | `OpsStatusParticipation.kind_code`; `OpsForceCampaignAssignment.kind_code`; `OpsForceCampaignPoolMember.kind_code`; события: `recon_sector_posts[].demandKindCode`, `force_requests.groupDemands[].kindCode`, `force_requests.groupOffers[].kindCode`, `force_allocation[].members[].kindCode` | три запроса `values(...).annotate(Count)` плюс проход по событиям |
| EVENT_GROUP_ROLES | `OpsStatusParticipation.role_code`; события: `force_allocation[].members[].roleCode`; плюс `group_code` собственных детей у родителя (как сегодня) | запрос плюс проход |
| RETURN_REASONS, POST_REQUIREMENTS, SEASONAL_CORRECTIONS | код в данных не хранится (свободный текст) | связей ноль по построению |

Проход по событиям — один `values_list` по нужным JSON-полям всех
`OpsSecurityEvent`, разбор в Python; для сотен событий это дешевле, чем
JSON-запросы на каждый код. Подписанные дневные снимки (`snapshot.py`) не
сканируются: они неизменяемы и в удалении не участвуют, потому что удаление
блокируется уже живыми полями.

Статус `usage.status` для всех девяти становится `TRACKED`; у трёх
«свободнотекстовых» `reason` сообщает «код в данных не хранится, связей быть
не может». `NOT_TRACKED` остаётся в типе на будущее, `UNKNOWN` — при сбое
сборщика (сегодняшняя семантика). Каждая ссылка: `{sourceLabel, count, samples[:3]}`,
как сейчас.

Кадровые: `Position` — `staff_units` (count) плюс `EmployeeTransferHistory`
по `from_position`/`to_position` (запрос по `Q`); `Rank` — `employee_set`.
Форма ответа та же.

## 2. Модель

`OpsDictionaryEntry` (`apps/operations/models_settings.py`), миграция `operations/0130_dictionary_entry_lifecycle`:

- `inactive_since = DateField(null=True, blank=True)` — дата неактуальности,
  ставится при деактивации, снимается при активации.
- `supersedes = ForeignKey("self", on_delete=PROTECT, null=True, blank=True, related_name="superseded_by")`
  — прецедент `OpsIssuedDocument.supersedes`. PROTECT: цепь «взамен» рваться не должна.
- Инвариант (проверка в сервисе, не в БД): у записи с `superseded_by` всегда
  `is_active=False`.

`Position`, `Rank` (`apps/dictionaries/models.py`), миграция `dictionaries/0005_position_rank_lifecycle`:

- `is_active = BooleanField(default=True, db_index=True)`;
- `inactive_since = DateField(null=True, blank=True)`;
- `supersedes = ForeignKey("self", on_delete=PROTECT, null=True, blank=True, related_name="superseded_by")`.

Существующие строки получают `is_active=True` дефолтом миграции.

## 3. Защищённые коды

`apps/ops/dictionaries.py`: `PROTECTED_CODES = {("EVENT_PARTICIPATION_KINDS", "PHYSICAL_SQUAD"), ("JOURNAL_ENTRY_TYPES", "INSTRUCTION"), ("JOURNAL_ENTRY_TYPES", "ORDER"), ("JOURNAL_ENTRY_TYPES", "INCIDENT"), ("JOURNAL_ENTRY_TYPES", "REPLACEMENT")}`.
Эти коды зашиты в коде раздела (бакетирование расхода, журнал штаба); их
деактивация, удаление и замена отбиваются `DomainError("DICTIONARY_ENTRY_PROTECTED", 422)`.
Корректирование подписи разрешено.

## 4. Операции сервиса (`apps/ops/dictionaries.py`)

- `create_entry`/`update_entry`: дополнительно `label_kk` длиннее 255 → поле
  `labelKk: ["Не более 255 символов."]` в `VALIDATION_ERROR` (400).
- `set_entry_active(entry_id, *, is_active, actor)`:
  деактивация ставит `inactive_since = Clock.today_local()` (если пусто);
  активация очищает `inactive_since`; активация записи с преемником →
  `DomainError("DICTIONARY_ENTRY_SUPERSEDED", 409)`; защищённый код →
  `DICTIONARY_ENTRY_PROTECTED` (только при деактивации).
- `supersede_entry(entry_id, *, code, label, label_kk, description, group_code, owner_division_id, actor)`:
  прежняя должна быть активна (иначе 409 `DICTIONARY_ENTRY_INACTIVE`), не
  защищена; новая проходит те же проверки, что `create_entry`, в том же
  справочнике; в одной транзакции: создаётся преемник с `supersedes=old`,
  прежняя получает `is_active=False`, `inactive_since=today`; аудит
  `DICTIONARY_ENTRY_SUPERSEDED` на прежней (`new_value={"successorId","successorCode"}`)
  и `DICTIONARY_ENTRY_CREATED` на новой (`new_value` дополнен `"supersedes": old.code`).
  Возвращает преемника.
- `remove_entry(entry_id, *, actor) -> ("deleted", None) | ("deactivated", entry)`:
  защищённый → 422; `usage.status != "TRACKED"` → 422 `DICTIONARY_USAGE_UNKNOWN`
  (только при сбое сборщика); `totalCount == 0` → аудит `DICTIONARY_ENTRY_DELETED`,
  физическое удаление (запись с `superseded_by` удалять нельзя — PROTECT даст
  IntegrityError, поэтому сервис проверяет заранее и отвечает 409
  `DICTIONARY_ENTRY_SUPERSEDED`: у неё есть преемник, она уже история);
  `totalCount > 0` → деактивация как в `set_entry_active(False)` с `reason`
  аудита «удаление при наличии связей: N»; уже неактивная со связями —
  холостой ответ `("deactivated", entry)` без записи аудита.
- `delete_entry` остаётся для админки Django (там удаление только при нуле
  связей, как сейчас) и реализуется через `remove_entry` с требованием
  `"deleted"`.

`error_codes.CODES` получает `DICTIONARY_ENTRY_PROTECTED: {422}`,
`DICTIONARY_ENTRY_SUPERSEDED: {409}`, `DICTIONARY_ENTRY_INACTIVE: {409}`.

`serialize_entry` дополняется: `inactiveSince` (ISO-дата или null),
`supersedes` (`{"id","code"}` или null), `supersededBy` (`{"id","code"}` или
null; берётся из `select_related`/предзагрузки, чтобы список не делал N запросов).

## 5. API значений ОМ (`OpsDictionariesViewSet`)

| Ручка | Поведение |
|---|---|
| `GET /api/ops/dictionaries/<CODE>/entries/` | как было, плюс новые поля; связи из одного сборщика |
| `POST .../<CODE>/entries/` | как было |
| `PATCH .../entries/<id>/` | как было (корректирование) |
| `POST .../entries/<id>/set-active/` | как было, с датой и отказами выше |
| `DELETE .../entries/<id>/` | 204 при физическом удалении; 200 `{"result": "deactivated", "entry": {...}}` при деактивации по связям; 422/409 по отказам выше |
| `POST .../entries/<id>/supersede/` (новое действие `supersede_entry`) | тело как у POST entries; 201 с преемником |

`permission_map`: `supersede_entry` → `dictionary_value.manage`. Каталог прав
подхватит действие сам.

## 6. Кадровые справочники

Новый модуль `apps/dictionaries/lifecycle.py` с функциями над экземпляром
модели (`Position` или `Rank`), одинаковыми по форме с сервисом ОМ:
`usage_of(instance)`, `set_active(instance, *, is_active, actor)`,
`supersede(instance, *, data, actor)`, `remove(instance, *, actor)`. Аудит
через `audit_service.record` с новыми сущностями `ENTITY_POSITION = "position"`,
`ENTITY_RANK = "rank"` (в `ENTITY_TYPES`) и теми же кодами действий
`DICTIONARY_ENTRY_*` (сущность различает таблицу). Создание и корректирование
через viewset тоже пишут `CREATED`/`UPDATED` (сегодня кадровые не аудируются).

`_StaffDictionaryViewSet`: `destroy` → `remove` (204 или 200 с
`{"result":"deactivated","row":{...}}`), действия `set_active` (POST
`.../<id>/set-active/`, тело `{"is_active": bool}`) и `supersede` (POST
`.../<id>/supersede/`, тело как у создания), все под `dictionary_value.manage`.
Отказы — `DomainError` с теми же кодами (обработчик `ops_exception_handler`
глобальный в `REST_FRAMEWORK`). Существующие 400 из `destroy` уходят.

Сериализаторы `PositionSerializer`/`RankSerializer`: `fields` явно —
`id, name, name_kk, code, level, is_active, inactive_since, supersedes, superseded_by, usage`;
`supersedes` — id (read-only), `superseded_by` — id или null (read-only),
`usage` — как у ОМ. Список отдаёт все строки; выбор нового ограничивают
потребители: `StaffUnitSerializer.position` и поле `rank` в
`EmployeeSerializer` получают `queryset=...filter(is_active=True)`; на фронте
`EmployeeAdminDialog` показывает только `is_active !== false`. Массовые
ручки штатки с сырыми id не трогаются (отмечено в рисках).

## 7. Аудит

`audit_service`: `DICTIONARY_ENTRY_SUPERSEDED` в константы и `ACTIONS`;
`ENTITY_POSITION`, `ENTITY_RANK` в `ENTITY_TYPES`. Фильтр журнала подхватит
новый код автоматически.

## 8. Фронтенд

Типы `entities/dictionary/index.ts`: `inactiveSince: string | null`,
`supersedes: {id, code} | null`, `supersededBy: {id, code} | null`,
`SupersedeDictionaryEntryRequest = CreateDictionaryEntryRequest`,
`RemoveDictionaryEntryResult = {result: "deleted"} | {result: "deactivated"; entry: DictionaryEntryView}`;
путь `dictionaryEntrySupersedePath(id)`. Хуки: `useSupersedeDictionaryEntry`,
`useDeleteDictionaryEntry` возвращает результат (204 → deleted).

`entities/staff-dictionary/index.ts`: `StaffDictionaryRow` получает
`is_active`, `inactive_since`, `supersedes`, `superseded_by`, `usage`;
хуки `useSetStaffDictionaryRowActive`, `useSupersedeStaffDictionaryRow`.
`lib/api.ts` типы `Position`/`Rank` получают `is_active`.

Экран значений ОМ (`[code]/page.tsx`):

- кнопка «Редактировать» переименована в «Исправить» (корректирование);
- новая кнопка «Заменить» открывает `Dialog` с формой преемника (код, название,
  название kk, описание, группа/владелец как у добавления), сабмит →
  supersede; после успеха карточки обновляются;
- кнопка «Удалить» открывает `Dialog` подтверждения: при `usage.totalCount === 0`
  текст «Связей нет, значение будет удалено безвозвратно», при `> 0` —
  «Используется (N): …; значение будет деактивировано с датой сегодня, а не
  удалено»; окно закрывается ответом сервера, отказ показывается в окне;
- карточка: бейдж «неактивна с дд.мм.гггг» вместо «Неактивна», когда дата
  есть; бейджи «заменена на CODE» и «заменяет CODE»; у записи с преемником
  кнопки «Активировать» и «Заменить» скрыты;
- поля kk получают `maxLength={255}`; чтение новых полей через `?? ""`/`?? null`.

Экран кадровых (`personnel/[kind]/page.tsx`): то же — «Исправить», «Заменить»
(диалог: название, название kk, код, уровень), «Деактивировать/Активировать»,
«Удалить» с подтверждением и исходом, бейджи активности, даты и замены.

Моки `mocks/ops/dictionaries-handlers.ts`: `usageOf` возвращает `TRACKED`
для всех кодов (сканы как сейчас, остальные — ноль связей), DELETE
деактивирует при связях (200) и удаляет иначе (204), новый обработчик
`supersede`, поля `inactiveSince`/`supersedes`/`supersededBy` в записях.

## 9. Тесты

Бэкенд (`apps/ops/tests/test_dictionary_lifecycle.py`, `apps/dictionaries/tests/test_lifecycle.py`):

- сборщик: по одной пробе на источник каждого справочника (создаётся
  ссылающаяся строка, `usage_of` считает 1 с правильным `sourceLabel`);
  свободнотекстовые дают `TRACKED` и ноль;
- `remove_entry`: без связей — удаление и аудит `DELETED`; со связями —
  деактивация с датой, аудит с причиной; защищённый — 422; с преемником — 409;
- `supersede_entry`: преемник создан, прежняя неактивна с датой, ссылки
  обеих сторон, два события аудита; повторная замена неактивной — 409;
  защищённый — 422; дубликат кода — 400;
- `set_entry_active`: даты ставятся и снимаются; активация заменённой — 409;
- API: DELETE 204/200 по случаям, POST supersede 201, права
  (`dictionary.manage` без `dictionary_value.manage` → 403 на supersede);
  аноним → 403 на чтение и запись; `labelKk: null` → сохраняется `""`;
  `labelKk` из 300 символов → 400 с полем `labelKk`;
- кадровые: `is_active`/`inactive_since`/`supersedes` в ответах, `destroy`
  204/200, `set-active`, `supersede`, аудит с сущностями `position`/`rank`,
  `StaffUnitSerializer` отвергает неактивную должность (400).

Фронт: `tsc --noEmit`, `next build`, живой прогон на стенде: заменить
значение, удалить без связей (204), «удалить» PLACEMENT_ROLES-значение со
связью (деактивация с датой), кадровая замена.

## 10. Риски

- Проход по событиям на каждый `GET entries` — O(событий) JSON-разбора; для
  сотен событий это миллисекунды, для десятков тысяч потребует кэша. Отмечено,
  не решается здесь.
- `PROTECT` на `supersedes`: удалить прежнюю с преемником нельзя даже
  администратору; это намеренно.
- Массовые ручки штатки принимают сырые id должностей без проверки
  активности — остаётся как есть.
- Экраны-потребители по-прежнему показывают сырой код для неактивных
  значений (существующее поведение) — подпроект 3.
