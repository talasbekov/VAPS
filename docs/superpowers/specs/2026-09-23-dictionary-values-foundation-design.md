# UC-REF-001, подпроект 1 «Фундамент»: право на значения и двуязычие

Дата: 23.09.2026. База: экспорт исходников Plane №1144, ревизия `c41c79a22af9`.

## Зачем

Issue UC-REF-001 просит четыре операции над значениями справочников под отдельным
правом и двуязычные значения. Сейчас все мутации значений идут под общим
`dictionary.manage`, у значений одно наименование, а тестов на справочники в
экспорте нет. Этот подпроект закладывает основу: отдельное право насквозь,
поле kk у значений, настройки языка и тестовый харнесс. Остальные подпроекты
(преемник и даты, удаление по связям, контроль похожих и таблица, единый
перечень) строятся поверх него и здесь не делаются.

## Объём

Входит:

1. Право `dictionary_value.manage` («Изменение справочных значений»).
2. Поля `label_kk` у значений ОМ и `name_kk` у должностей и званий.
3. `LANGUAGE_CODE = 'ru'`, `LANGUAGES` ru и kk на бэке.
4. Тестовый харнесс `client_for` и тесты на права, roundtrip kk, сид, аудит.

Не входит: запись-преемник, дата неактуальности, удаление по связям,
проверка похожих записей, табличный экран, единый перечень, kk в выпадающих
списках других экранов, страны и города (№417), охраняемые лица,
`LocaleMiddleware` и выбор языка по `Accept-Language`, перевод интерфейса.

## 1. Право `dictionary_value.manage`

### Сид

`apps/operations/management/commands/seed_operations.py`:

- `PERMISSIONS` получает `("dictionary_value.manage", "Изменение справочных значений")`
  рядом с `dictionary.view` и `dictionary.manage`.
- `ROLE_PERMISSIONS["REFERENCE_ADMIN"]` получает `dictionary_value.manage`,
  сохраняя `dictionary.view` и `dictionary.manage`.
- `ADMIN` покрыт wildcard `*`, других изменений ролей нет.

Гранты хранятся по роли (`RolePermission`), а не по пользователю, поэтому
действующие держатели REFERENCE_ADMIN получают право без переназначений.
Право заводится ещё и data-миграцией `operations/0127_dictionary_value_manage_permission`
по прецеденту `0126`: сид на уже засеянной базе сам себя не применит, а
миграция выполняется при обновлении автоматически.

### Бэкенд

`apps/ops/api/views.py`, `OpsDictionariesViewSet.permission_map`:

| Действие | Было | Стало |
|---|---|---|
| `list`, `entries` | `dictionary.view` | без изменений |
| `create_entry` | `dictionary.manage` | `dictionary_value.manage` |
| `set_active` | `dictionary.manage` | `dictionary_value.manage` |
| `delete_entry` (PATCH и DELETE) | `dictionary.manage` | `dictionary_value.manage` |

`permission_bypass_map` для `entries` не меняется.

`apps/dictionaries/api/views.py`, `_StaffDictionaryViewSet`: константа
`_MANAGE` указывает на `dictionary_value.manage`; `create`, `update`,
`partial_update`, `destroy` идут под ним, `list` и `retrieve` остаются под
`dictionary.view`.

Право самостоятельное: держатель только `dictionary.manage` получает 403 на
все мутации значений, включая прямые запросы. `OpsProtectedPersonsViewSet` и
страница охраняемых лиц остаются на `dictionary.manage`, их не трогаем.

Каталог прав (`apps/ops/access_catalog.py`) строится из `permission_map`, новых
записей в нём не нужно.

### Фронтенд

- `app/security-ops/dictionaries/[code]/page.tsx`: `canManage = hasPermission("dictionary_value.manage")`.
- `app/security-ops/dictionaries/personnel/[kind]/page.tsx`: то же.
- Гейт просмотра `dictionary.view` не меняется. Комментарий в
  `hooks/use-staff-dictionaries.ts` обновляется.
- Мок-каталог прав `mocks/ops/access-handlers.ts` не трогается: это учебный
  список из семи кодов без единого `dictionary.*`, каталог живёт на сервере.

## 2. Двуязычные значения

### Модель и миграции

- `OpsDictionaryEntry.label_kk = CharField(max_length=255, blank=True, default="")`,
  миграция `operations/0128_dictionary_entry_label_kk`.
- `Position.name_kk = CharField(max_length=255, blank=True, default="")`,
  `Rank.name_kk = CharField(max_length=255, blank=True, default="")`,
  миграция `dictionaries/0004_position_rank_name_kk`.

Поле необязательное: существующие данные и сиды не имеют kk, требовать его
значило бы сломать заведение до перевода. Уникальности нет: уникален код.
Значения нормализуются `strip()`; пустая строка означает «перевода нет»,
`None` в базе не хранится.

### Сервис и API значений ОМ

`apps/ops/dictionaries.py`:

- `create_entry(..., label_kk="", ...)` сохраняет нормализованное значение.
- `update_entry(..., label_kk=UNSET, ...)`: если аргумент передан, поле
  обновляется; иначе не трогается. Пара old/new в событии
  `DICTIONARY_ENTRY_UPDATED` включает `label_kk`.
- `serialize_entry` отдаёт `"labelKk": entry.label_kk`.

`OpsDictionariesViewSet`:

- `create_entry` читает `data.get("labelKk")`.
- `delete_entry` (PATCH) передаёт `label_kk` только если ключ `labelKk`
  присутствует в теле.

Контракт API значений ОМ:

```json
{
  "id": "12", "dictionaryCode": "RETURN_REASONS", "code": "WEATHER",
  "label": "Погода", "labelKk": "Ауа райы", "description": "",
  "isActive": true, "groupCode": null, "updatedAt": "...", "usage": {}
}
```

POST `/api/ops/dictionaries/<CODE>/entries/` и PATCH
`/api/ops/dictionaries/entries/<id>/` принимают необязательный `labelKk`.

### Кадровые справочники

`apps/dictionaries/api/serializers.py`: `PositionSerializer.Meta.fields`
получает `name_kk`; `RankSerializer` с `__all__` подхватывает поле сам.
Ключ в JSON остаётся snake_case, как и остальные поля этих ручек.
Сериализаторы `apps/core/api/serializers.py` только на чтение и не меняются.

### Админка

`apps/operations/admin_dictionaries.py`: `label_kk` в `list_display` и
`search_fields`; форма с `fields = "__all__"` покажет поле сама.

### Настройки

`config/settings/base.py`:

```python
LANGUAGE_CODE = 'ru'
LANGUAGES = [('ru', 'Русский'), ('kk', 'Қазақша')]
```

`LocaleMiddleware` не подключается: язык значения выбирает клиент по полям,
а не сервер по заголовку. Побочный эффект смены `LANGUAGE_CODE`: админка и
встроенные сообщения валидации Django и DRF становятся русскими. Зависимостей
от английских строк на фронте и в тестах нет (проверено grep).

### Фронтенд

`entities/dictionary/index.ts`: `DictionaryEntry.labelKk: string`,
`CreateDictionaryEntryRequest.labelKk?: string`,
`UpdateDictionaryEntryRequest.labelKk?: string`.

`entities/staff-dictionary/index.ts`: `StaffDictionaryRow.name_kk: string`.

Экран значений ОМ (`[code]/page.tsx`): поле «Название (kk)» в форме
добавления после «Название *» и в редакторе после «Название»; карточка
показывает kk серым текстом после ru, если оно не пустое.

Экран кадровых (`personnel/[kind]/page.tsx`): поле «Название (kk)» в форме
добавления и в `RowCard` при правке; в строке kk серым после ru.

`mocks/ops/dictionaries-handlers.ts`: create принимает и отдаёт `labelKk`,
сидовые записи мока получают `labelKk: ""`. PATCH-обработчика в моке нет и
не было (правка появилась в Plane №274 без мока), поэтому в мок-режиме
правка значения не обслуживается; это долг не этого подпроекта.

## 3. Тесты и окружение

### Харнесс

В экспорте нет пакета `organization_management/apps/operations/tests`, из-за
чего пять отгруженных модулей тестов не импортируют `client_for`.

- `apps/operations/tests/__init__.py`.
- `apps/operations/tests/support.py`:
  `client_for(username, role_code=None, permission_codes=None, scope_division_id=None) -> tuple[APIClient, User]`.
  Создаёт пользователя; при `role_code` берёт или создаёт `Role`, для каждого
  кода `Permission` и `RolePermission`, заводит `UserRole(user_id=str(user.pk), scope_division_id, is_active=True)`;
  возвращает `APIClient` с `force_authenticate(user)`.
- `apps/operations/tests/test_bulk_status_api.py`: шим, реэкспорт `client_for`
  из `support` под старым путём импорта, с докстрингом «временно для экспорта;
  в рабочем репозитории файл существует со своими тестами».

### Новые тесты

`apps/ops/tests/test_dictionary_values_permission.py`:

- держатель только `dictionary.manage`: 403 на POST entries, PATCH entry,
  DELETE entry, POST set-active; 403 на POST/PATCH/DELETE positions;
- держатель `dictionary_value.manage` без `dictionary.manage`: 201/200/204 на
  тех же запросах;
- чтение списка и значений по `dictionary.view` работает у обоих;
- аноним и пользователь без прав получают 403.

`apps/ops/tests/test_dictionary_values_bilingual.py`:

- POST с `labelKk` возвращает его и сохраняет; без `labelKk` в ответе `""`;
- PATCH с прежним `label` и новым `labelKk` меняет только kk; PATCH без ключа
  `labelKk` не трогает kk (сам `label` в PATCH обязателен, как и раньше);
- `name_kk` у должности и звания через POST и PATCH;
- событие `DICTIONARY_ENTRY_UPDATED` содержит старое и новое `label_kk`.

`apps/operations/tests/test_seed_dictionary_value_permission.py`:

- после `seed_operations --reference-only` у REFERENCE_ADMIN есть все три
  кода, у `PermissionService.effective_permissions` держателя роли тоже.

### Запуск

Бэкенд: `.venv` с пиннутым `requirements.txt` (без `uvloop`, он не собирается
на Windows) плюс `requirements/development.txt`; тесты на PostgreSQL из
Docker-стека: `PR_DB_HOST=127.0.0.1 PR_DB_PORT=5300 PR_DB_NAME=smart_josparlau PR_DB_USER=smart_josparlau PR_DB_PASSWORD=<из .env>`.
Тестовая база создаётся Django сама.

Фронтенд: `tsc --noEmit`, `next build`, затем ручная проверка через
`next dev` против живого бэка со свежими миграциями.

## 4. Git и деплой

Репозиторий заведён в `source/` с базовым коммитом экспорта. Работа идёт
коммитами поверх него. Образы на этой машине не пересобираются: результат
подпроекта переносится в рабочий репозиторий и сборку. После деплоя нужен
`manage.py migrate` (делает entrypoint) и `bootstrap_contour` для сида права.

Чек-лист обновления:

1. `migrate` (делает entrypoint): применяет 0127-0129 и `dictionaries/0004`.
2. Роли, кроме REFERENCE_ADMIN и ADMIN, которым `dictionary.manage` выдавали
   ради правки значений, теряют её молча: экран справочников открывается,
   кнопок нет. Перед обновлением снять список:
   `SELECT role_code FROM ops_role_permissions WHERE permission_code = 'dictionary.manage';`
   и после обновления выдать таким ролям `dictionary_value.manage` на экране
   «Система → Роли» (или в Django admin «Права ролей (ОМ)»).
3. При переносе в рабочий репозиторий удалить шим
   `apps/operations/tests/test_bulk_status_api.py`, оставить `support.py`, и
   перевести пять импортёров `client_for` на
   `organization_management.apps.operations.tests.support`.

## Риски

- Смена `LANGUAGE_CODE` меняет язык встроенных сообщений; при неожиданной
  зависимости откат одной строкой.
- Смена `LANGUAGE_CODE` на `ru` включает русские форматы ввода Django
  (`DATE_INPUT_FORMATS` = `дд.мм.гггг`, десятичный разделитель запятая) в
  формах Django admin; API это не затрагивает (DRF разбирает ISO 8601 сам),
  HTML-шаблонов и явных `forms.DateField` в проекте нет. Администратор,
  вводящий дату как `2026-09-23`, получит «Введите правильную дату».
- Шим `test_bulk_status_api.py` конфликтует с одноимённым файлом рабочего
  репозитория; при переносе шим удаляется.
- `RankSerializer` с `__all__` отдаст `name_kk` всем потребителям ранков;
  поле новое и необязательное, старые клиенты его игнорируют.
