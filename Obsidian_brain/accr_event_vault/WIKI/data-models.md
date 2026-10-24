# Модели данных — eventproject

> Обновлено: 2026-06-11 (исчерпывающее сканирование). СУБД: PostgreSQL 15.

## Обзор

10 моделей в 3 приложениях (`en_event` и `kz_event` моделей не содержат):

| Приложение | Модели |
|-----------|--------|
| `eventproject` | Event, Category, Operator, Request, Attendee, ExportLog |
| `directories` | Sex, Country, DocumentType, City, Category (справочник) |
| `qr_event` | QrIin |

---

## Приложение `eventproject`

### Event — мероприятие

| Поле | Тип | Ограничения |
|------|-----|-------------|
| `id` | BigAutoField | PK |
| `name_kaz` / `name_rus` / `name_eng` | CharField(128) | null, blank (legacy) |
| `event_code` | CharField(20) | null, blank (legacy) |
| `date_start` / `date_end` | DateField | null, blank (legacy) |
| `city_code` | CharField(20) | null, blank (legacy) |
| `title` | CharField(255) | null, blank (Story 2.2) |
| `description` | TextField | null, blank (Story 2.2) |
| `start_date` / `end_date` | DateField | null, blank (Story 2.2) |
| `created_by` | FK → User | null, SET_NULL, related_name=`events_created` |
| `created_at` | DateTimeField | auto_now_add, null |

`__str__`: title → name_rus → "Event {id}". Все legacy-поля сделаны nullable в миграции 0015 — новый DRF API работает через title/start_date/end_date.

### Category — категория участников (внутри мероприятия)

| Поле | Тип | Ограничения |
|------|-----|-------------|
| `event` | FK → Event | CASCADE, related_name=`categories` |
| `name` | CharField(128) | обязательное |
| `created_at` | DateTimeField | auto_now_add, null |

Не путать с `directories.Category` (глобальный справочник). Появилась в миграции 0013 (Story 2.2).

### Operator — оператор системы

| Поле | Тип | Ограничения |
|------|-----|-------------|
| `user` | O2O → User | CASCADE |
| `events` | M2M → Event | blank |
| `patronymic` | CharField(128) | обязательное |
| `phone_number` | CharField(20) | обязательное |
| `workplace` | CharField(128) | default="" |
| `is_accreditator` | BooleanField | default=False |
| `role` | CharField(20) | choices, default="operator" |

**Роли (`ROLE_CHOICES`)**: `superuser` (Суперпользователь), `superoperator` (Супероператор), `operator` (Оператор), `user` (Пользователь).

К `User` динамически прикреплено свойство `User.role`: `is_superuser` → `"superuser"`, иначе `operator.role`, иначе `"user"`.

### Request — заявка на аккредитацию (пакет участников)

| Поле | Тип | Ограничения |
|------|-----|-------------|
| `name` | CharField(128) | обязательное |
| `event` | FK → Event | CASCADE |
| `status` | CharField(20) | значения: `Active`, `Checking`, `Sent`, `Exported` |
| `date_created` | DateTimeField | default=timezone.now |
| `created_by` | FK → Operator | CASCADE, related_name=`created_operator` |
| `registration_time` | DateTimeField | обязательное |
| `exported_by` | FK → Operator | null, CASCADE, related_name=`exported_operator` |

Жизненный цикл статусов: `Active` → `Checking` (preview) → `Active` (back_to_change) → `Sent` (send) → `Exported` (после выгрузки администратором).

### Attendee — участник мероприятия

| Поле | Тип | Ограничения |
|------|-----|-------------|
| `surname` / `firstname` | CharField(128) | обязательные |
| `patronymic` | CharField(128) | null, blank |
| `birthDate` | DateField | null, blank |
| `post` | CharField(500) | обязательное |
| `countryId` / `docTypeId` | CharField(30) | обязательные (коды справочников) |
| `docSeries` | CharField(128) | обязательное |
| **`iin`** | **EncryptedCharField(12)** | **null, blank — шифруется at rest (Fernet)** |
| `docNumber` | CharField(20) | null, blank |
| `docBegin` / `docEnd` | DateField | null, blank |
| `docIssue` | CharField(255) | обязательное |
| `photo` | ImageField | blank, upload_to=`event_{event_id}/attendee_photos/` |
| `docScan` | ImageField | blank, upload_to=`event_{event_id}/attendee_documents/` |
| `sexId` | CharField(20) | обязательное |
| `dateAdd` | DateTimeField | обязательное — основа delta-фильтра экспорта |
| `visitObjects` | CharField(1024) | обязательное |
| `transcription` | CharField(255) | обязательное (латинская транскрипция ФИО) |
| `request` | FK → Request | CASCADE |
| `category` | FK → Category | null, SET_NULL, related_name=`attendees` |
| `dateEnd` | DateField | null, blank |
| `stickId` | CharField(20) | default="" |

**Шифрование ИИН**: поле `iin` — `EncryptedCharField` (django-fernet-fields). Прямой фильтр `Attendee.objects.filter(iin=...)` невозможен (FieldError); проверка дубликатов выполняется в памяти через `validators/iin.py::event_has_iin_duplicate()`. Ключи — `FERNET_KEYS` из окружения.

### ExportLog — журнал delta-экспортов

| Поле | Тип | Ограничения |
|------|-----|-------------|
| `event` | FK → Event | CASCADE |
| `category` | FK → Request | null, SET_NULL (null = весь event) |
| `exported_before` | DateTimeField | граница delta: `dateAdd > exported_before` = новые |
| `user` | FK → User | null, SET_NULL (null = системная задача) |
| `attendee_count` | IntegerField | количество участников в экспорте |
| `created_at` | DateTimeField | auto_now_add, null |

Delta-фильтр: `Attendee.objects.filter(dateAdd__gt=last_export.exported_before, request__event=event)`.

---

## Приложение `directories` (справочники)

Все справочники трёхъязычные (`name_kaz` / `name_rus` / `name_eng`, CharField(128)) и заполняются скриптами `populate_*.py` из CSV в корне репозитория.

| Модель | Дополнительные поля |
|--------|---------------------|
| `Sex` | `sex_code` (20) |
| `Country` | `country_code` (20), `cis_flag` (bool, default=False), `country_iso` (20) |
| `DocumentType` | `doc_code` (20) |
| `City` | `city_code` (20), `index` (20) |
| `Category` | `category_code` (20), `index` (20) |

Код Казахстана: `countryId == "1000000105"` — для граждан РК ИИН обязателен.

---

## Приложение `qr_event`

### QrIin — QR-код по ИИН

| Поле | Тип | Ограничения |
|------|-----|-------------|
| `id` | AutoField | PK (explicit) |
| `iin` | CharField(12) | **plaintext** (в отличие от Attendee.iin), validators=[regex `^\d{12}$`, `iin_kz_validator`] |
| `qr_code` | ImageField | null, blank, upload_to=`qr_codes/` |
| `created_at` / `updated_at` | DateTimeField | auto |

**`iin_kz_validator`** — полная валидация ИИН РК: дата рождения (YYMMDD), код века/пола (7-я цифра: 1,2→1800-е; 3,4→1900-е; 5,6→2000-е), контрольная сумма 12-й цифры по двум весовым рядам (r1, при r1==10 — r2; r2==10 → невалидный ИИН).

---

## Ключевые вехи истории миграций

| Миграция | Изменение |
|----------|-----------|
| eventproject 0002 | Operator.workplace |
| 0006 | Attendee.stickId |
| 0007–0008 | расширение max_length (post→500, visitObjects→1024, docIssue→255); docNumber/iin/patronymic стали nullable |
| **0009–0010** | **Шифрование ИИН**: 0009 добавляет `iin_encrypted` и батчево шифрует существующие данные (транзакционно, с обратимым откатом); 0010 удаляет plaintext `iin` и переименовывает. Требует `FERNET_KEYS`, иначе ImproperlyConfigured. Откат: `migrate eventproject 0008` |
| 0011 | ExportLog (delta-экспорт, Epic 4) |
| 0012 | Operator.role (RBAC) |
| 0013–0015 | Story 2.2: Event.title/description/start_date/end_date/created_by, модель Category, Attendee.category; legacy-поля Event сделаны nullable |
| qr_event 0002 | QrIin.qr_code |
