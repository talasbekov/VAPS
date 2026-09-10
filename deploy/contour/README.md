# Smart Josparlau — переносимый контур, блок 1 №1138

Исполнитель: Кодекс Астра 6.

Это расширение `deploy/spike-1.9`: контрольные суммы → `docker load` → compose
без `build`. Нужны Docker Engine с Compose v2 (`--wait`, `--pull never`), Bash,
Python3, sha256sum, gzip, достаточно места для сжатых архивов и распакованных
образов. Архитектура CPU должна совпадать с `platform.txt` (сборка не cross-platform).
Все файлы каталога bundle переносятся вместе. Docker/Compose устанавливаются
на машине контура заранее; бандл не является установщиком Docker.

## Сборочная машина

Перед подготовкой закоммитить исходники на рабочей ветке. Каталог результата
должен быть новым и находиться вне исходного дерева. Online-фаза единственная
имеет доступ к registries, npm, apt/apk и PyPI:

```bash
bash deploy/contour/build-bundle.sh prepare /absolute/path/contour-bundle
bash deploy/contour/build-bundle.sh build /absolute/path/contour-bundle
```

Во второй команде все `docker build` используют `--network=none --pull=false`.
`prepared-images.tar.gz` сохраняет реальные bases Python3.12-bookworm,
Node22-alpine, PostgreSQL15, Redis7-alpine, nginx1.28-alpine и подготовленные
Python/Node deps; `runtime-images.tar.gz` — полный запускаемый стек.
`wheelhouse/` содержит колёса всего pinned `requirements.txt`, включая production
requirements; на старте pip не вызывается. `images-manifest.txt` фиксирует ID и
digests образов. При обновлении зависимостей нужна новая online-подготовка.

Повторная offline-сборка из перенесённого каталога:

```bash
bash build-bundle.sh build "$PWD"
```

Сначала вручную сверить `sha256sum -c sha256sums.txt` и
`sha256sum -c source-sha256sums.txt`: контрольные суммы удостоверяют целостность
переноса, доверие к носителю/отправителю обеспечивается отдельно. Источник для
пересборки — `source/`, а не текущий checkout. `source-revision.txt` — его commit.

## Установка на новом контуре

Скопировать `.env.example` в `.env`, поставить реальный LAN IP/порт в
`NEXTAUTH_URL`, `ALLOWED_HOSTS`, CORS и CSRF. Записать три свежих разных секрета
не короче 32 символов в `POSTGRES_PASSWORD`, `DJANGO_SECRET_KEY`,
`NEXTAUTH_SECRET` (например, получить каждый через `openssl rand -hex 32`).
Секреты в архив и журнал не включать; `chmod 600 .env`. Затем одна команда:

```bash
bash install.sh
```

Публикуется только nginx на :3118. Backend, frontend, PostgreSQL и Redis
подключены только к Docker-сети `default` с `internal:true`; портов хоста
они не занимают. Nginx подключён к ней и к отдельной стандартной bridge-сети
`ingress`, через которую Docker публикует внешний порт. Чужие стенды
:3108/:8100 не затрагиваются. Портал `/`, NextAuth `/api/auth/`, Django `/api/`,
админка `/admin/`, статика `/staticfiles/` и `/static/`, медиа `/media/`, WebSocket
`/ws/` — один origin. API и медиа в браузере относительные, шрифты локальные,
Sentry DSN пуст, телеметрия Next отключена.

Сеть `ingress` сама по себе не запрещает исходящий трафик proxy на хосте с
интернетом. Физическую закрытость LAN обеспечивает настройка хоста/контура;
приложение не требует внешних сервисов. Фактическая проверка офлайн-режима
проводится в лаборатории без внешних маршрутов и внешнего DNS, с доступом
только по подключённой локальной LAN для входа в proxy. Не выдавать наличие
`internal:true` у сервисов приложения за изоляцию всей машины от интернета.

Создаётся новый volume `smart-josparlau-contour_postgres15`. Не подключать к нему
старый PostgreSQL16 volume и не импортировать live dump в рамках блока1.
Миграции и collectstatic выполняются entrypoint перед запуском ASGI.
Чистая БД не содержит учёток. Создать отдельного суперпользователя интерактивно:

```bash
docker compose exec backend python manage.py createsuperuser
```

Чистый bootstrap ролей и справочников теперь выполняется одной идемпотентной
командой `docker compose exec backend python manage.py bootstrap_contour`.
Полный порядок, отдельное создание суперпользователя и явный demo opt-in описаны
в `RUNBOOK.md`. Не запускать полный `seed_operations` вручную: он добавляет
демонстрационные предметные данные. Браузерная проверка входа портала/админки по
IP хоста выполняется после создания учётки.

## Эксплуатационные ограничения

- Контейнеры UTC; деловой `TIME_ZONE=Asia/Qyzylorda`, глобальный base не меняется.
  Проверить `timedatectl`, `date -u` хоста/контейнеров и дату в админке. В закрытом
  контуре без NTP оператор отвечает за верные часы хоста.
- Celery worker и beat **выключены**, расписание пустое. Плановое применение
  статусов, отложенные уведомления и фоновые отчёты этим блоком не обеспечиваются.
  Redis включён для cache/channels; запуск worker/beat требует отдельной приёмки.
- Django file log ротируется: 10 MiB × 6 файлов; один ASGI worker исключает гонку
  файловой ротации между воркерами. Docker logs ограничены 10 MiB × 3 на сервис.
- Бандл по умолчанию обслуживает HTTP в изолированной LAN. TLS/сертификаты,
  backup/restore, обновление/откат, reference-only bootstrap — следующие блоки.
  При добавлении TLS согласовать trusted proxy и `COOKIE_SECURE=1`.
- Остановка: `docker compose down` (сохраняет volumes). Не использовать `down -v`
  на контуре с данными. Повторная установка не сбрасывает БД и не меняет её пароль:
  POSTGRES_PASSWORD должен соответствовать уже созданному volume.

Состояние: `docker compose ps`; журналы: `docker compose logs --tail=100`.
Браузер и фактическая offline-сборка являются отдельным обязательным
доказательством готовности; наличие этих файлов само по себе её не доказывает.
