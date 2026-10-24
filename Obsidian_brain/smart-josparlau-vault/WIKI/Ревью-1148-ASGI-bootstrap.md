# №1148 — независимое review ASGI bootstrap

Дата: 10.09.2026. Исполнитель: Кодекс Астра 6.

Scope: только исправление `58487289..92f849df449edd324b639c99f88d33f76f66147a`, файл `organization_management/config/asgi.py`. Вход: `QA-Audits/contour-2026-09-10/1148-review.diff`, фактический лог контроллера `1138-backend-boot-failed.log`, обновлённый [[Бриф-1138-Офлайн-бандл-report]]. Требование блока1: запуск ASGI с HTTP и обеими группами WebSocket-маршрутов в автономном контуре.

## Вердикты

**Spec compliance: PASS для исправления кода. Code quality: PASS.** Critical: 0. Important: 0. Minor: 0. По статическому анализу устранена конкретная причина AppRegistryNotReady из приложенного лога. Успешный фактический boot после исправления здесь не заявлен: rebuild/install выполняет контроллер.

## Основание

Лог до исправления показывает цепочку: свежий gunicorn worker → import config.asgi → operations.ws_routing → ws_consumers → ws_auth → SimpleJWT JWTAuthentication → django.contrib.auth.models → `AppRegistryNotReady: Apps aren't loaded yet.` После успешных migrate/collectstatic процесс запускается заново, поэтому их выполнение не заменяло инициализацию реестра приложений внутри worker.

Исправление правильно упорядочивает загрузку:

1. Импортируется `get_asgi_application`, устанавливается default DJANGO_SETTINGS_MODULE.
2. `django_asgi_application = get_asgi_application()` выполняет инициализацию Django до импорта Channels authentication и маршрутов, доходящих до моделей.
3. После этого импортируются ProtocolTypeRouter, URLRouter, AuthMiddlewareStack и оба routing-модуля.
4. HTTP получает уже созданный ASGI application; второй вызов фабрики исключён.

`os.environ.setdefault` сохраняет переданный Dockerfile DJANGO_SETTINGS_MODULE=organization_management.config.settings.contour: настройка production служит только default и не затирает contour. Нет catch исключения, возврата WSGI, отключения WS или обхода авторизации. Перенос импортов ниже bootstrap намеренный и необходимый; это не ошибка порядка импортов.

## Сохранность WebSocket-маршрутов

В diff неизменны `AuthMiddlewareStack(URLRouter(routing.websocket_urlpatterns + ops_routing.websocket_urlpatterns))`, порядок объединения и модели авторизации. Прочитаны два routing-модуля:

| Маршрут | Consumer | Результат review |
| --- | --- | --- |
| /ws/notifications/ | NotificationConsumer | Сохранён |
| /ws/operations/notifications/ | OpsNotificationConsumer | Сохранён |

Конфигурация доставки, consumers, токены, данные и зависимости diff не меняет. Новых сетевых обращений не добавляет. Обе группы по-прежнему обслуживаются ASGI, HTTP остаётся частью того же ProtocolTypeRouter.

## Граница доказательств и связанный №1147

Reviewer читал diff, report, существующие routing-файлы и лог. Тесты, синтаксические команды, сборка, серверы и контейнеры не запускались; код не менялся. Попытка прочитать локальный Django core/asgi.py по ожидаемому .venv/lib/python3.12 пути показала отсутствие этого файла; это не runtime-дефект бандла и в findings не включено. Фактическую проверку осуществляет контроллер в пересобираемом образе.

Дополнительно `git diff --stat 25e48491..58487289` дал пустой вывод: отменённая 11-я boundary service-summary не входит в финальный diff №1147. Поэтому [[Ревью-1147-Suspense-api-сборка]] на десять wrappers покрывает конечное изменение; расширять его на неизменённый service-summary не требуется.
