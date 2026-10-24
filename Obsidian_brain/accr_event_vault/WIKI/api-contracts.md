# API-контракты — eventproject

> Обновлено: 2026-06-11 (исчерпывающее сканирование).

## Аутентификация

- **HTML-интерфейс**: сессионная аутентификация Django (`login_required`), декоратор `superuser_required` для админ-операций.
- **DRF API** (`/api/v1/...`): `SessionAuthentication` (по умолчанию в `REST_FRAMEWORK`), permission-классы RBAC из `eventproject/permissions.py`. JWT (simplejwt) установлен, но не активирован.
- **Cookies**: `SESSION_COOKIE_SECURE=True`, `CSRF_COOKIE_SECURE=True`, `CSRF_COOKIE_SAMESITE='Strict'`. Таймаут сессии по ролям: superuser — 4 ч, оператор — 12 ч.

## Health-check

| URL | Метод | Auth | Ответ |
|-----|-------|------|-------|
| `/health/`, `/healthz/` | GET | — | `{"status": "ok"}` |
| `/api/health/` | GET | — | `{"status": "ok|error", "db": "ok|unreachable"}` (503 при недоступной БД) |

## DRF REST API (`eventproject/api/urls.py`)

DefaultRouter, базовый префикс `/api/v1/`. Ошибки — формат **RFC 7807** (`api/exceptions.py`): `{"type", "title", "detail", "field"}`.

| URL | Метод | ViewSet/функция | Permissions | Назначение |
|-----|-------|----------------|-------------|-----------|
| `/api/v1/events/` | GET | EventViewSet.list | IsSuperoperator | События пользователя (все — для superoperator/superuser, через `get_operator_events()`) |
| `/api/v1/events/` | POST | EventViewSet.create | IsSuperoperator | Создание события, `created_by=request.user` |
| `/api/v1/events/<id>/` | GET/PUT/DELETE | EventViewSet | IsSuperoperator | Чтение/обновление/удаление |
| `/api/v1/events/<id>/categories/` | GET/POST | action `categories` | IsSuperoperator | Категории события |
| `/api/v1/rbac-check/` | GET | `rbac_check` | IsAuthenticated | `{"role": "<роль>"}` |

**Сериализаторы**: `EventSerializer` (id, title, start_date, end_date, description, categories nested, created_at), `CategorySerializer` (id, name, attendee_count — вычисляемое `obj.attendees.count()`).

**Permission-классы**: `IsSuperuser` (только superuser), `IsSuperoperator` (superoperator+superuser), `IsOperator` (operator+superoperator+superuser).

## HTML-интерфейс (сессионный)

Три языковых зеркала: русский (корень), казахский (`/kz/...`), английский (`/en/...`) — view-функции в `kz_event/views.py` и `en_event/views.py` идентичны русским, отличаются только шаблонами, языком сообщений и сортировкой справочников (`name_kaz`/`name_eng`).

### Аутентификация и сессия

| URL | Метод | Auth | Назначение |
|-----|-------|------|-----------|
| `/`, `/user_login/` (+`/kz/`, `/en/`) | GET/POST | — | Вход; редирект superuser → `/avmac/`, оператор → `/application/` |
| `/logout/` (+kz/en) | GET | login | Выход |
| `/auth_check/` | GET | login | 200 для Nginx auth_request |
| `/change_password/` (+kz/en) | GET/POST | login | Смена пароля |

### Мероприятия и операторы (только superuser)

| URL | Метод | Назначение |
|-----|-------|-----------|
| `/avmac/` | GET | Админ-панель (все события, операторы, города) |
| `/create_event/` | POST | Создание мероприятия |
| `/show_event/<event_id>/` | GET | Детали мероприятия |
| `/delete_event/<event_id>/` | GET | Удаление мероприятия + медиа-папки `media/event_<id>` |
| `/flush_outdated_events/` | GET | Удаление мероприятий старше 900 дней + папки `output/` |
| `/add_operator/` | POST | Создание оператора (User+Operator, генерация пароля) |
| `/show_operator/<id>/` | GET | Карточка оператора |
| `/delete_operator/<username>/` | GET | Удаление оператора |
| `/new_password/<username>/` | GET | Новый пароль (`token_urlsafe(8)`) |
| `/add_operator_to_event/`, `/bind_operators/` | POST | Привязка операторов к мероприятию |
| `/unbind_event/<event_id>/<username>/` | GET | Отвязка |

### Заявки (операторы; + kz/en зеркала)

| URL | Метод | Назначение |
|-----|-------|-----------|
| `/application/` | GET | Кабинет оператора (его события и заявки) |
| `/create/<event_id>/` | GET/POST | Новая заявка (status=`Active`) |
| `/show/<request_id>/` | GET | Заявка со списком участников |
| `/show_request_to_admin/<request_id>/` | GET | Просмотр заявки админом (superuser) |
| `/preview/<request_id>/` | GET | → status `Checking` |
| `/back_to_change/<request_id>/` | GET | → status `Active` |
| `/send/<request_id>/` | GET | → status `Sent`, ставится `registration_time` |
| `/delete_request/<request_id>/` | GET | Удаление заявки с участниками |

### Участники (операторы; + kz/en зеркала)

| URL | Метод | Особенности |
|-----|-------|-------------|
| `/add_attendee/<request_id>/` | GET/POST | **@ratelimit(ip, 20/h, POST)** → 429. Валидация: даты документов/рождения, размер файлов 1KB–9MB, ИИН обязателен для граждан РК (countryId=1000000105), дубликаты по ИИН или ФИО+дата рождения. Аудит `attendee.create` |
| `/update_attendee/<attendee_id>/` | GET/POST | @ratelimit(20/h); смена метаданных без обязательной перезагрузки файлов. Аудит `attendee.update` |
| `/delete_attendee/` | POST | `attendee_id` в теле; если заявка пустеет — удаляется и заявка. Аудит `attendee.delete` |

### Экспорт (только superuser)

| URL | Метод | Назначение |
|-----|-------|-----------|
| `/download_json/<event_id>/` | GET | JSON участников (status=`Sent`), заявки → `Exported` |
| `/download_guests_json/<event_id>/` | GET | Аналогично |
| `/download_all_guests_json/<event_id>/` | GET | JSON (`Sent` + `Exported`) |
| `/download_request_json/<request_id>/` | GET | JSON одной заявки, → `Exported` |
| `/download_photos/<event_id>/` | GET | ZIP фото из `media/event_<id>/` (временный файл в `/tmp/`) |
| `/download_file/<event_id>/` | GET | Готовый `event_<id>.zip` (StreamingHttpResponse) |
| `/check_archive_status/<event_id>/` | GET | Статус из cache: `{'status': 'not_found'|'processing'|'completed', ...}` |

### Прочее

| URL | Назначение |
|-----|-----------|
| `/embankment/` | Django Admin |
| `/api/v1/public/content-manager/translations` | Mock — пустой `{}` |
| `/qr/` (GET/POST), `/qr/success/<pk>/` | QR-приложение: ввод ИИН (форма `QrIinForm`, 12 цифр) → генерация QR-PNG из `{"iin": <int>}` → страница успеха |

## Внешние интеграции

> **Важно**: интеграционные view (`kazenergy_receive`, `kazexpo_receive`) **не замаплены в urls.py**. Они вызываются изнутри по расписанию — `eventproject.cron.kazexpo_import_job` каждые 2 минуты (django-crontab, `CRONJOBS`) создаёт синтетический запрос через `RequestFactory` и `async_to_sync()`.

### KazEnergy (`views/integration/integrate_kazenergy.py`)

Async pull-цикл (`httpx.AsyncClient`, пауза 0.3 с между запросами):
1. GET `https://kazenergy.regist.kz/api/api.php` (заголовок `x-api-key`) — одна анкета за итерацию (`payload["attendees"][0]`); выход при пустом списке.
2. Валидация 21 обязательного поля; пустое поле → ACK `code=9` (ошибка).
3. Дубликаты: по ИИН (граждане РК) или по transcription → ACK `code=2`.
4. Сохранение Attendee (парсинг дат, base64-изображений photo/docScan) в Request (переиспользуется, если последнему < 1 часа).
5. ACK: POST `https://kazenergy.regist.kz/api/ack.php`, `code=2` (успех).

Итоговый ответ: `{"processed": N, "errors": M, "request_id": K}`; HTTP 200 при errors==0, иначе 400. Задача в Celery-варианте (`tasks.kazexpo_import_job`) захардкожена на Event ID=777, Operator ID=1405.

### Avalon/KazExpo (`views/integration/integrate.py`, `services.py`)

Аналогичный async-цикл с `https://avalon.kazintec.kz/api/v1/events/.../export` (ключ `AVALON_API_KEY`); валидирует 10 полей, дополнительно пишет CSV в `media/exports/`. `services.process_avalon_payload()` создаёт Request со статусом `processing` → `completed`.

## Обработка ошибок и лимиты

- **429**: `handler429 = eventproject.views.ratelimited_error`; `RatelimitMiddleware` перехватывает `Ratelimited` глобально.
- **Брутфорс**: django-axes — 10 неудачных входов → блокировка IP на 1 час (`AXES_FAILURE_LIMIT=10`, `AXES_COOLOFF_TIME=1`, `AXES_RESET_ON_SUCCESS=True`, только `REMOTE_ADDR`).
- **Валидационные ошибки HTML-форм** возвращаются как HTTP 200 с сообщением в шаблоне (`gov3.html` / `request.html`).
- **DRF**: RFC 7807 problem details.
