# Анализ структуры исходного кода — eventproject

> Обновлено: 2026-06-11 (исчерпывающее сканирование).

## Дерево проекта (значимые элементы)

```
eventproject/                       # Корень репозитория
├── manage.py                       # Точка входа Django CLI
├── requirements.txt                # Зависимости (Django 5.1.3, DRF, Celery, axes, fernet...)
├── Dockerfile                      # Образ accr-django (gunicorn, 2 workers, timeout 120)
├── docker-compose.yml              # 5 сервисов: db, redis, app, celery-worker, celery-beat
├── .env.example                    # Шаблон секретов (SECRET_KEY, DB_*, FERNET_KEYS, ...)
├── cron.py                         # Legacy-обёртка cron-задачи (см. eventproject/cron.py)
│
├── eventproject/                   # ЯДРО: настройки + бизнес-логика
│   ├── settings.py                 # Продакшен-конфиг (decouple, security, LOGGING, CRONJOBS)
│   ├── settings_test.py            # Тестовый (SQLite in-memory, LocMem, авто-Fernet-ключ)
│   ├── settings_mac.py             # LEGACY dev-конфиг — НЕ использовать
│   ├── urls.py                     # Все HTML-маршруты + include api/, qr/
│   ├── urls_mac.py                 # Legacy-маршруты
│   ├── wsgi.py / asgi.py           # Точки входа WSGI (prod) / ASGI
│   ├── celery.py                   # Celery app (Redis db0, Asia/Almaty)
│   ├── tasks.py                    # cleanup_old_archives, kazexpo_import_job
│   ├── cron.py                     # kazexpo_import_job для django-crontab (*/2 мин)
│   ├── models.py                   # Event, Category, Operator, Request, Attendee, ExportLog
│   ├── permissions.py              # IsSuperuser / IsSuperoperator / IsOperator
│   ├── audit.py                    # audit_log() — структурированный аудит
│   ├── fernet_fields.py            # Реэкспорт EncryptedCharField
│   ├── forms.py                    # HTML-формы
│   ├── logging_filters.py          # StructuredContextFilter для JSON-логов
│   ├── async_create.py             # Архивация фото (НЕ используется, дубль manual.py)
│   ├── api/
│   │   ├── urls.py                 # DRF router: /api/v1/events/, rbac-check
│   │   └── exceptions.py           # RFC 7807 exception handler
│   ├── serializers/
│   │   ├── event.py                # EventSerializer, CategorySerializer
│   │   └── rbac.py                 # get_operator_events() — видимость по ролям
│   ├── middleware/
│   │   ├── ratelimit.py            # Ratelimited → 429
│   │   ├── session_timeout.py      # Таймаут сессии по ролям (4ч/12ч)
│   │   └── logging_middleware.py   # RequestLoggingMiddleware (audit trail запросов)
│   ├── validators/
│   │   └── iin.py                  # normalize_iin, event_has_iin_duplicate (для шифрованного ИИН)
│   ├── views/                      # View-слой по доменам
│   │   ├── views.py                # Логин/логаут, кабинеты, смена пароля
│   │   ├── event.py                # CRUD мероприятий + DRF EventViewSet
│   │   ├── operator.py             # CRUD операторов, привязка к событиям
│   │   ├── request.py              # Жизненный цикл заявок (Active→Sent→Exported)
│   │   ├── attendee.py             # Добавление/правка участников, audit_log, ratelimit
│   │   ├── file_download.py        # Экспорт JSON/ZIP, статус архива
│   │   ├── health.py               # /health/, /api/health/
│   │   └── integration/
│   │       ├── integrate_kazenergy.py  # Async pull из KazEnergy (не в urls!)
│   │       ├── integrate.py            # Async pull из Avalon/KazExpo
│   │       └── services.py             # process_avalon_payload
│   ├── migrations/                 # 15 миграций (0009-0010 — шифрование ИИН)
│   └── tests/                      # 44+ тестов: security, rbac, audit, encryption, logging
│
├── directories/                    # Справочники: Sex, Country, DocumentType, City, Category
├── qr_event/                       # QR-приложение: модель QrIin, /qr/ формы, валидатор ИИН РК
├── en_event/ , kz_event/           # Языковые зеркала view-слоя (без моделей)
│
├── templates/                      # HTML-шаблоны (рус. в корне, en/, kz/, qr_event/)
│   ├── gov*.html                   # Иерархия: gov_base → gov (логин) → gov2 (кабинет) → gov3 (форма участника)
│   ├── index.html, event.html, operator.html, request*.html, add_event.html
│   └── creating_archive.html       # Прогресс архивации
│
├── static/ , staticfiles/          # Статика (source / collectstatic)
├── media/                          # Загрузки: event_<id>/attendee_photos|documents, qr_codes/, archives/
├── logs/                           # app.log (rotating 5MB×3) + скрипты анализа nginx-логов
│   ├── log_scan1.py                # Поиск сессий с несколькими IP (session hijacking)
│   └── log_scan_sessionid.py       # Сопоставление nginx sessionid ↔ Django-сессии
│
├── scripts/                        # Одноразовые сидеры справочников из CSV
│   ├── populate_categories.py / populate_cities.py / populate_docs.py / country_populate.py
│   ├── categories.csv / cities.csv / docs.csv / countries.csv
│   └── README.md
│
├── docs/                           # ЭТА документация + нагрузочные тесты
│   ├── index.md                    # Главный индекс
│   ├── load_tests/locustfile.py    # Locust-сценарии
│   ├── load_test_baseline_2026-04-14.json
│   └── performance-backlog.md
│
└── postgres_data/                  # Том PostgreSQL (root-owned, не трогать)
```

## Точки входа

| Точка | Назначение |
|-------|-----------|
| `manage.py` | CLI: migrate, test, runserver |
| `eventproject/wsgi.py` | Продакшен через Gunicorn |
| `eventproject/celery.py` | `celery -A eventproject worker|beat` |
| `eventproject/cron.py` | django-crontab задача импорта |

## Критические директории

| Директория | Почему важна |
|-----------|--------------|
| `eventproject/views/` | Вся бизнес-логика |
| `eventproject/migrations/0009-0010` | Шифрование ИИН — необратимое без FERNET_KEYS |
| `eventproject/tests/` | Контракт поведения безопасности |
| `media/` | PII: фото и сканы документов участников |
| `templates/` | UI; правки нужно дублировать в en/ и kz/ |

## Артефакты, требующие внимания

- `__pycache__/`, `*.pyc` в гите (частично удалены), `evenv/`, `.venv/`, `.venv_new/`, `wheelhouse/` — мусор в корне.
- `=2.0.7`, `23042022161113.txt`, `get-pip.py`, `backup.sql` (пустой) — случайные файлы.
- `test_media/`, `attendee_photos/`, `attendee_document/` — тестовые данные с PII-образцами.
- `settings_mac.py`, `urls_mac.py`, `manual.py`, корневой `cron.py` — legacy-дубли.
