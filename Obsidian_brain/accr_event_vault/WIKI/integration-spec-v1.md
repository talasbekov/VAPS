# Integration Spec v1.1 — формат экспорта участников (downstream security-система)

> **СТАТУС: `v1.1` — CONFIRMED.**
> Формат утверждён Project Lead (Erda) 2026-06-23 (Story 4.1). Решения по открытым
> вопросам зафиксированы ниже в разделе «Решения v1.0». `1.0 → 1.1` — аддитивный
> bump (story hd-1.1, 2026-07-02): добавлено поле `schema_version`; resident-ИИН
> (п.3 ниже) НЕ менялся.
>
> Машиночитаемый источник правды: [`integration-spec-v1.schema.json`](./integration-spec-v1.schema.json)
> (его проверяет `eventproject/tests/test_export_contract.py`).

**Версия:** 1.1 · **Дата:** 2026-07-02 · **Story:** hd-1.1 (базовый формат — 4.1/2026-06-23)

## Назначение

Контракт формата выгрузки участников в downstream security-систему. Export serializer
(Story 4.3) и contract-тест ссылаются на **эту спеку как единственный источник** — поля не
дублируются «на глаз». Цель — приём каждой выгруженной записи downstream с первого раза.

## Структура архива

ZIP: `export_<event_id>_<category>_<timestamp>.zip`
```
export_5_Охрана_20260623T100000Z.zip
├── attendees.json          # массив объектов attendee (формат ниже)
├── photos/
│   └── <attendee_id>.jpg    # фото участника
└── documents/
    └── <attendee_id>.jpg    # скан документа
```
Имена медиафайлов в архиве соответствуют `attendee_id` из JSON.

## Объект `attendee` (элемент `attendees.json`)

| Поле JSON | Тип | Обяз. | Null | Источник (`Attendee.*`) |
|---|---|---|---|---|
| `attendee_id` | integer | ✓ | — | `id` |
| `schema_version` | string `"1.1"` | ✓ | — | `eventproject.services.export.SCHEMA_VERSION` |
| `event_id` | integer | ✓ | — | `request.event.id` |
| `event_code` | string | ✓ | — | `request.event.event_code` |
| `category` | string | ✓ | да | `category.name` |
| `status` | string (`ready`) | ✓ | — | `status` (экспортируются только `ready`) |
| `surname` | string | ✓ | — | `surname` |
| `firstname` | string | ✓ | — | `firstname` |
| `patronymic` | string | — | да | `patronymic` |
| `transcription` | string (latin) | ✓ | — | `transcription` |
| `birth_date` | date `DD.MM.YYYY` | ✓ | да | `birthDate` |
| `iin` | string `^[0-9]{12}$` | ✓ | да | `iin` (расшифрован; null для нерезидента) — **PII** |
| `is_resident` | boolean | ✓ | — | `is_resident` |
| `sex_id` | string | ✓ | — | `sexId` (= `directories.Sex.sex_code`) |
| `sex_name` | string | ✓ | да | `directories.Sex.name_rus` по `sex_code` |
| `country_id` | string | ✓ | — | `countryId` (= `directories.Country.country_code`) |
| `country_name` | string | ✓ | да | `directories.Country.name_rus` по `country_code` |
| `post` | string | ✓ | — | `post` |
| `doc_type_id` | string | ✓ | — | `docTypeId` (= `directories.DocumentType.doc_code`) |
| `doc_type_name` | string | ✓ | да | `directories.DocumentType.name_rus` по `doc_code` |
| `doc_series` | string | ✓ | — | `docSeries` |
| `doc_number` | string | — | да | `docNumber` |
| `doc_begin` | date `DD.MM.YYYY` | — | да | `docBegin` |
| `doc_end` | date `DD.MM.YYYY` | — | да | `docEnd` |
| `doc_issue` | string | ✓ | — | `docIssue` |
| `visit_objects` | string | ✓ | — | `visitObjects` |
| `date_add` | datetime `DD.MM.YYYY HH:MM:SS` | ✓ | — | `dateAdd` |
| `photo_file` | string `photos/…` | ✓ | да | путь в ZIP (null, если файла нет на диске) |
| `doc_scan_file` | string `documents/…` | ✓ | да | путь в ZIP (null, если файла нет на диске) |

### Форматы значений
- **Даты:** `DD.MM.YYYY` (напр. `01.01.1990`). **datetime:** `DD.MM.YYYY HH:MM:SS` (напр. `23.06.2026 10:00:00`).
- **Строки:** UTF-8. **Булевы:** JSON `true`/`false`.
- **null:** отсутствующее опциональное значение передаётся как JSON `null`.
- **Справочники:** для `country`/`sex`/`doc_type` отдаются ОБА — сырой код (`*_id`) и
  человекочитаемое русское имя (`*_name`). `*_name` = `null`, если код не найден в справочнике.

### Пример валидного объекта
```json
{
  "attendee_id": 123,
  "schema_version": "1.1",
  "event_id": 5,
  "event_code": "T1",
  "category": "Охрана",
  "status": "ready",
  "surname": "Иванов",
  "firstname": "Иван",
  "patronymic": "Петрович",
  "transcription": "Ivanov Ivan",
  "birth_date": "01.01.1990",
  "iin": "900101300007",
  "is_resident": true,
  "sex_id": "M",
  "sex_name": "Мужской",
  "country_id": "1000000105",
  "country_name": "Казахстан",
  "post": "Инженер",
  "doc_type_id": "passport",
  "doc_type_name": "Паспорт",
  "doc_series": "AA",
  "doc_number": "123456",
  "doc_begin": "01.01.2020",
  "doc_end": "01.01.2030",
  "doc_issue": "МВД",
  "visit_objects": "Объект A",
  "date_add": "23.06.2026 10:00:00",
  "photo_file": "photos/123.jpg",
  "doc_scan_file": "documents/123.jpg"
}
```

## Решения v1.0 (утверждено Erda 2026-06-23)

1. **Формат дат:** `DD.MM.YYYY`; datetime — `DD.MM.YYYY HH:MM:SS`.
2. **Справочники** (`country`/`sex`/`doc_type`): отдаём ОБА — `*_id` (сырой код) и `*_name` (рус. имя из `directories.*`).
3. **ИИН в экспорте:** включается расшифрованный ИИН для резидентов (`null` для нерезидентов). PII — канал передачи защищён, в логах ИИН маскируется (`mask_iin`).
4. **Медиа:** отдельные файлы в `photos/`/`documents/` (не base64-инлайн); имя файла = `<attendee_id>.<ext>`.
5. **Идентификатор записи** в JSON: `attendee_id` (PK `Attendee.id`) — он же связывает JSON с медиафайлами.
6. **Источник формата:** формального документа downstream нет; формат зафиксирован решениями Project Lead. При появлении реальных требований downstream — bump версии по политике ниже.

## Политика версионирования (AC-5)

При изменении требований downstream: обновить этот документ **и** `integration-spec-v1.schema.json`,
обновить `test_export_contract.py`, поднять версию (`1.0` → `1.1`/`2.0`) и добавить запись в историю.

## История версий
- **1.1 (2026-07-02, story hd-1.1):** добавлено поле `schema_version` (аддитивно, обратно совместимо). Триггер: hd-1.1 закрывала Critical-гэп whitelist в легаси `file_download.py`; попутно добавлен `schema_version` и в этот, уже explicit-whitelist, путь (`services/export.py`) — remaining Critical-гэп там отсутствовал, resident-ИИН (п.3) не менялся (подтверждено Erda 2026-06-23, см. story hd-1.1 Dev Notes «Премиса-конфликт»).
- **1.0 (2026-06-23):** формат утверждён Project Lead (Erda). Снят DRAFT; зафиксированы даты `DD.MM.YYYY`, справочники `*_id`+`*_name`, ИИН для резидентов. Добавлены поля `sex_name`/`country_name`/`doc_type_name`.
- **1.0-DRAFT (2026-06-23):** первичный черновик из модели `Attendee` (Story 4.1). Не подтверждён downstream.
