---
baseline_commit: a02754d
---

# Story 12.1a: Прод security-hardening

Status: ready-for-dev

## Story

As a **разработчик, готовящий первый деплой в закрытый контур**,
I want **прикладной Django-стек, закрывающий стандартные security-чеки (`ALLOWED_HOSTS`, `SecurityMiddleware`, secure-cookie-флаги), а не только рабочую топологию**,
so that **12.1's работающий стек не остаётся уязвим к Host-header-подделке и перехвату сессионных/CSRF-кук ровно там, где `DEBUG=False` перестаёт скрывать эти дыры по умолчанию**.

## Acceptance Criteria

Источник: `_bmad-output/implementation-artifacts/deferred-work.md` (явно назначенный E12-долг, процитирован дважды — в собственной записи и в 12.1's Dev Notes) + живой прогон `manage.py check --deploy` (см. Dev Notes — фактический вывод этой стори, не пересказ старого).

Карв-аут из 12.1 (см. `12-1-прод-compose.md`'s Dev Notes и AC-декомпозицию): 12.1 дала РАБОТАЮЩУЮ топологию, эта стори закрывает её ЗАЩИЩЁННОСТЬ — функционально независимо от того, поднимается ли стек. Единственный файл в скоупе — `Backend/VAPS/config/settings.py` (плюс тесты и `deploy/.env.example`'s новая переменная) — под лимит «≤5 файлов, одна ответственность».

1. **AC-1 (`ALLOWED_HOSTS` — из env, fail-closed в проде).** Сегодня `ALLOWED_HOSTS = ["*"]` захардкожен — под `DEBUG=False` Django принимает ЛЮБОЙ заголовок `Host`, что открывает Host-header-подделку (password-reset-ссылки/кэш-poisoning векторы, если когда-либо появятся — сейчас нет, но чек — стандартная гигиена, не гипотетическая фича). Новая функция `allowed_hosts_from_env(env, debug)` — зеркало уже существующего `jwt_config_from_env`'s паттерна (settings.py:163-211): читает `VAPS_ALLOWED_HOSTS` (comma-separated), в DEBUG=True пустое значение даёт `["*"]` (dev/gate не ломается), в DEBUG=False пустое значение — `ImproperlyConfigured` (fail-closed, тот же приём, что уже есть для `VAPS_JWT_KEY`/`VAPS_JWT_AUDIENCE`).
2. **AC-2 (`SecurityMiddleware` — добавлен в `MIDDLEWARE`, порядок сохранён).** `django.middleware.security.SecurityMiddleware` вставлен ВТОРЫМ (сразу после `RequestContextMiddleware`, ДО `SessionMiddleware`) — не первым, чтобы не сломать существующий комментарий-инвариант «request_id обёртывает весь request/response первым (внешним)»; не позже `SessionMiddleware`, чтобы не сломать admin-чек-порядок (E408/E409/E410), уже задокументированный в settings.py комментарием рядом с `MIDDLEWARE`. Закрывает `manage.py check --deploy`'s `security.W001` («SecurityMiddleware отсутствует — HSTS/nosniff/referrer-policy/ssl-redirect настройки не имеют эффекта»).
3. **AC-3 (`SESSION_COOKIE_SECURE`/`CSRF_COOKIE_SECURE` — зеркалят `DEBUG`, не отдельный env-флаг).** `SESSION_COOKIE_SECURE = not DEBUG`, `CSRF_COOKIE_SECURE = not DEBUG` — вычисляемые от уже существующего `DEBUG`, НЕ новая env-переменная (меньше поверхности для рассинхрона: один флаг `VAPS_DEBUG` управляет обоими). Закрывает `security.W012`/`security.W016`. dev/gate (DEBUG=1 по умолчанию) продолжают работать по plain HTTP без изменений в поведении.
4. **AC-4 (HSTS/SSL-redirect — сознательно НЕ включены, задокументировано, не закрыто молча).** `SECURE_HSTS_SECONDS = 0`, `SECURE_SSL_REDIRECT = False` — явные значения (не «просто не заданы»), с комментарием, что 12.1's топология обслуживает HTTP на порту 80 БЕЗ TLS-терминатора (`architecture.md#L321`: «HTTPS — эпик production hardening, не блокирует первый релиз: закрытый LAN»). Включение HSTS/SSL-redirect без сертификата сломало бы КАЖДЫЙ запрос (редирект-петля / браузер отказывается от plain HTTP после HSTS). `manage.py check --deploy`'s `security.W004`/`security.W008` остаются открытыми НАМЕРЕННО — тот же E12-долг, адресован будущей TLS-стори, не эта. Не путать «намеренно открыто» с «забыто» — Completion Notes цитирует реальный вывод чек-команды.
5. **AC-5 (`deploy/.env.example` — новая переменная `VAPS_ALLOWED_HOSTS`, не разрыв AC-5 из 12.1).** `deploy/.env.example` получает `VAPS_ALLOWED_HOSTS=CHANGE_ME` (не-секретная, но обязательная в проде переменная — рядом с существующими non-secret prod-настройками, НЕ в секретном блоке) с комментарием-примером (`vaps.contour.local` — то же значение хоста, что уже используется как пример для `VAPS_ALLOWED_ORIGIN` в 12.1's файле, синхронизировать пример).
6. **AC-6 (регресс нулевой, реальный `manage.py check --deploy` прогнан ДО и ПОСЛЕ).** `make gate` (Backend/VAPS) зелёный, `npm run gate` (frontend, не тронут этой стори) не запускается заново (нет фронт-изменений). Дев-агент ОБЯЗАН реально прогнать `VAPS_SECRET_KEY=... VAPS_DEBUG=0 VAPS_JWT_KEY=... VAPS_JWT_AUDIENCE=... VAPS_ALLOWED_HOSTS=vaps.contour.local .venv/bin/python manage.py check --deploy` (валидный набор прод-env — без него `jwt_config_from_env` падает раньше, чем чек вообще стартует) ДО изменений (зафиксировать baseline-варнинги) и ПОСЛЕ (зафиксировать, что W001/W012/W016 исчезли, W004/W008 остаются намеренно, W009 — операционный, не код-долг) — зафиксировать реальный вывод обеих команд в Completion Notes, не пересказ.

## Tasks / Subtasks

- [ ] Task 1 — `allowed_hosts_from_env` (`Backend/VAPS/config/settings.py`, MOD) (AC: 1)
  - [ ] Функция зеркалит `jwt_config_from_env`'s сигнатуру `(env, debug)` и `ImproperlyConfigured`-приём.
  - [ ] `ALLOWED_HOSTS = allowed_hosts_from_env(os.environ, DEBUG)` заменяет текущий хардкод `["*"]`.
  - [ ] Юнит-тесты функции (без Django settings reload — прямой вызов, зеркало `test_jwt_authentication.py`'s `test_jwt_config_*` тестов): dev-пусто→`["*"]`, prod-пусто→raises, prod-с-хостами→список, comma-split с пробелами обрезается.
- [ ] Task 2 — `SecurityMiddleware` (`Backend/VAPS/config/settings.py`, MOD) (AC: 2)
  - [ ] Вставлен вторым в `MIDDLEWARE` (после `RequestContextMiddleware`, до `SessionMiddleware`).
  - [ ] Тест: `"django.middleware.security.SecurityMiddleware" in settings.MIDDLEWARE`, и позиция строго между `RequestContextMiddleware` и `SessionMiddleware` (не просто «где-то есть»).
- [ ] Task 3 — Secure-cookie-флаги + HSTS/SSL-redirect (`Backend/VAPS/config/settings.py`, MOD) (AC: 3, 4)
  - [ ] `SESSION_COOKIE_SECURE = not DEBUG`, `CSRF_COOKIE_SECURE = not DEBUG`.
  - [ ] `SECURE_HSTS_SECONDS = 0`, `SECURE_SSL_REDIRECT = False`, с комментарием-обоснованием (нет TLS-терминатора, ссылка на architecture.md#L321).
  - [ ] Тест: значения соответствуют формуле (не просто «True в тестовом окружении», а именно `not DEBUG` — читать через тестовый override DEBUG, не полагаться на дефолт).
- [ ] Task 4 — `deploy/.env.example` (MOD) (AC: 5)
  - [ ] `VAPS_ALLOWED_HOSTS=CHANGE_ME` добавлена в non-secret prod-блок, комментарий с примером (`vaps.contour.local`).
- [ ] Task 5 — Реальный прогон `check --deploy` (AC: 6)
  - [ ] Прогнать ДО изменений (baseline) — зафиксировать W-коды.
  - [ ] Прогнать ПОСЛЕ изменений — зафиксировать закрытые/оставшиеся-намеренно W-коды.
  - [ ] `make gate` — зелёный, регресс нулевой.

## Dev Notes

- **Живой baseline (снят при create-story, не из старой цитаты deferred-work.md).** `VAPS_SECRET_KEY=x VAPS_DEBUG=0 VAPS_JWT_KEY=<валидный PEM> VAPS_JWT_AUDIENCE=x .venv/bin/python manage.py check --deploy` реально дал: `security.W001` (нет SecurityMiddleware), `security.W009` (SECRET_KEY слабый/автогенерённый — плейсхолдер `x` в тестовом прогоне; в реальном деплое закрывается `.env`'s `VAPS_SECRET_KEY`, НЕ код-фикс), `security.W012` (SESSION_COOKIE_SECURE), `security.W016` (CSRF_COOKIE_SECURE). `W018` из старой цитаты deferred-work.md НЕ воспроизвёлся в этом прогоне (либо контекст цитаты отличался — другой набор env на момент 2.10's ревью) — доверять СВЕЖЕМУ прогону, не старой записи (урок `feedback_vaps_verify_against_raise_sites.md`: сверять с живым кодом/поведением, не с словарём/старой цитатой).
- **`W009` (слабый SECRET_KEY) — НЕ закрывается этой стори.** Это чисто операционный долг (реальный секрет генерируется и кладётся в `.env` при деплое, `deploy/.env.example`'s `VAPS_SECRET_KEY=CHANGE_ME` уже несёт инструкцию с 12.1) — нет кода, который эту стори могла бы поправить, кроме документации (уже есть).
- **`W004`/`W008` (HSTS/SSL-redirect) появятся НОВЫМИ после добавления `SecurityMiddleware`** (эти чеки не срабатывают вовсе, пока `SecurityMiddleware` отсутствует — `W001` их маскирует). Намеренно НЕ закрываются (AC-4) — задокументировать явно в Completion Notes реальный итоговый список варнингов, не «всё зелено».
- **`MIDDLEWARE`-порядок — не свободный выбор.** settings.py уже несёт комментарий «Порядок обязателен для admin (system-check admin.E408/E409/E410): Session → ... → Auth → Message; Session ДО Auth» — `SecurityMiddleware` не участвует в этом инварианте (Django официально рекомендует его САМЫМ первым в списке), но `RequestContextMiddleware`'s комментарий требует «первым (внешним)» для request_id contextvar — сохранить эту гарантию, `SecurityMiddleware` вторым, не первым.
- **`ALLOWED_HOSTS` env-имя — `VAPS_ALLOWED_HOSTS`, НЕ спутать с `VAPS_ALLOWED_ORIGIN` (12.1).** Разные механизмы: `VAPS_ALLOWED_ORIGIN` — nginx-only (WS CSWSH Origin-гард, Django её не читает вовсе, объявлена в `deploy/docker-compose.yml`'s nginx-сервисе). `VAPS_ALLOWED_HOSTS` — Django-only (`Host`-заголовок HTTP-уровня, читается `settings.py`, нужна и в `deploy/.env.example`'s `app`-сервисном `env_file`). Не объединять в одну переменную — разные слои защиты, разный формат (Origin — одно значение, Hosts — потенциально список).
- **Тесты — прямой вызов функции, не settings-reload.** Проект уже использует этот паттерн дважды (`jwt_config_from_env` в `test_jwt_authentication.py`, `channel_layers_from_env` в `test_ws_guards.py`) именно потому, что Django settings грузятся один раз за процесс — попытка перезагрузить `config.settings` под разными env в одном pytest-прогоне ненадёжна и не является принятым стилем проекта. `allowed_hosts_from_env` следует тому же контракту.

### References

- [Source: _bmad-output/implementation-artifacts/deferred-work.md#L223] — исходная запись E12-долга (ALLOWED_HOSTS/SecurityMiddleware/cookie-secure/HSTS).
- [Source: _bmad-output/implementation-artifacts/12-1-прод-compose.md] — карв-аут-декомпозиция (Dev Notes: «12.1a — прикладная security-hardening... 12.1a закрывает защищённость поверх»), `architecture.md#L321`'s HTTPS-отсрочка процитирована там же.
- [Source: Backend/VAPS/config/settings.py:163-211] — `jwt_config_from_env`, паттерн-прецедент для `allowed_hosts_from_env` (fail-closed в проде, permissive в dev).
- [Source: Backend/VAPS/apps/core/tests/test_jwt_authentication.py:274-300] — тестовый паттерн для функций `(env, debug) → config | raises`, зеркалится для `allowed_hosts_from_env`.
- [Source: Backend/VAPS/apps/notifications/tests/test_ws_guards.py] — второй прецедент того же паттерна (`channel_layers_from_env`), подтверждает: «прямой вызов функции» — принятый стиль проекта, не разовое решение.
- [Source: живой прогон `manage.py check --deploy`, эта create-story-сессия] — фактический список W-кодов, замещает устаревшую цитату из deferred-work.md.

## Dev Agent Record

### Context Reference

- Собрано напрямую при create-story (без отдельного research-агента — скоуп однофайловый, уже полностью описан в 12.1's карв-аут-декомпозиции): чтение `deferred-work.md#L223`, `config/settings.py` целиком (ALLOWED_HOSTS/MIDDLEWARE/JWT-паттерн), `deploy/docker-compose.yml`/`deploy/.env.example`/`deploy/nginx/vaps.conf.template` (12.1's итоговое состояние — различение `VAPS_ALLOWED_ORIGIN` от нового `VAPS_ALLOWED_HOSTS`), живой прогон `manage.py check --deploy` с валидным прод-env (baseline W-коды), `apps/core/tests/test_jwt_authentication.py`/`apps/notifications/tests/test_ws_guards.py` (тестовый паттерн для env-driven settings-функций).

### Completion Notes

### File List

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-29 | Story создана (create-story) |
