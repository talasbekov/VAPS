# Plane №1144 — сырой вывод приёмочных команд

Исполнитель: Кодекс Астра 6.

Ниже сохранён видимый вывод команд приёмки. Секреты `.env`, пароли и значения токенов намеренно исключены.

## Regression: обязательный IP и Compose-сети

```text
$ python3 -m unittest deploy/lan/tests/test_configure.py -v
test_all_runtime_networks_are_internal (deploy.lan.tests.test_configure.ConfigureTests.test_all_runtime_networks_are_internal) ... ok
test_requires_an_explicit_target_ip (deploy.lan.tests.test_configure.ConfigureTests.test_requires_an_explicit_target_ip) ... ok

----------------------------------------------------------------------
Ran 2 tests in 0.116s

OK
```

## Финальная контрольная сумма и источник

```text
$ sha256sum -c smart-josparlau-offline-2026-09-19-1144.tar.sha256
/home/erda/Backups/smart-josparlau/smart-josparlau-offline-2026-09-19-1144.tar: OK

$ (cd lan-1144-2026-09-19-final && sha256sum -c sha256sums.txt)
runtime-images.tar.gz: OK
source-revision.txt: OK
platform.txt: OK
images.env: OK
images-manifest.txt: OK
source-sha256sums.txt: OK
docker-compose.yml: OK
.env.example: OK
settings.py: OK
nginx-backend.conf: OK
configure.py: OK
ctl.sh: OK
install.sh: OK
data.sh: OK
sanitize-copy.py: OK
prepare-assets.py: OK
ui-assets.lock.json: OK
redoc.html: OK
INSTALL-RU.md: OK
build.sh: OK

$ stat -c '%s' smart-josparlau-offline-2026-09-19-1144.tar
1065226240

$ cat lan-1144-2026-09-19-final/source-revision.txt
c41c79a22af9cb7c8c8141e6d3a5490b395366a6

$ cat lan-1144-2026-09-19-final/platform.txt
linux/amd64
```

## Clean install: health и HTTP

```text
$ bash ctl.sh ps
NAME                            SERVICE    STATUS
sj-lan1144-restore-backend-1    backend    Up 47 seconds (healthy)
sj-lan1144-restore-beat-1       beat       Up 35 seconds
sj-lan1144-restore-db-1         db         Up About a minute (healthy)
sj-lan1144-restore-frontend-1   frontend   Up 41 seconds (healthy)
sj-lan1144-restore-proxy-1      proxy      Up 30 seconds
sj-lan1144-restore-redis-1      redis      Up 53 seconds (healthy)
sj-lan1144-restore-worker-1     worker     Up 41 seconds (healthy)

$ curl ... http://127.0.0.1:13944/
200 http://127.0.0.1:13944/
$ curl ... http://127.0.0.1:18944/admin/login/
200 http://127.0.0.1:18944/admin/login/
$ curl ... http://127.0.0.1:18944/docs
200 http://127.0.0.1:18944/docs
$ curl ... http://127.0.0.1:18944/api/schema/
200 http://127.0.0.1:18944/api/schema/
```

## Restart и backup/restore

```text
$ bash ctl.sh exec -T backend python manage.py shell -c '<marker count>'
marker_users=1

$ bash ctl.sh restart backend frontend proxy
Container sj-lan1144-primary-frontend-1 Started
Container sj-lan1144-primary-proxy-1 Started
Container sj-lan1144-primary-backend-1 Started

$ bash ctl.sh exec -T backend python manage.py shell -c '<marker count>'
marker_after_restart=1
post-restart admin=200

$ bash data.sh backup /home/erda/Backups/smart-josparlau/lan-1144-2026-09-19-acceptance-backup
Worker idle; broker drained; delayed tasks absent
Backup completed: /home/erda/Backups/smart-josparlau/lan-1144-2026-09-19-acceptance-backup. Broker was drained; Redis/beat runtime state is intentionally not transferred.

$ (cd lan-1144-2026-09-19-acceptance-backup && sha256sum -c sha256sums.txt)
database.dump: OK
media.tar.gz: OK
private.tar.gz: OK
source-revision.txt: OK
postgres-version.txt: OK

$ bash install.sh --restore /home/erda/Backups/smart-josparlau/lan-1144-2026-09-19-acceptance-backup
Data restored before migrations. Start with install.sh; do not run demo bootstrap. If interrupted, inspect the partially populated NEW stack; do not overwrite it.

$ bash ctl.sh exec -T backend python manage.py shell -c '<marker count>'
marker_after_restore=1
restored frontend=200
restored admin=200
```

## Внешние runtime-зависимости

```text
$ rg --pcre2 -n 'https?://(?!127\\.0\\.0\\.1|localhost)' /tmp/sj-lan1144-docs.html
(no matches; command exit 1)
No external HTTP(S) URL in rendered API docs

$ docker network inspect sj-lan1144-primary_default --format '{{.Name}} internal={{.Internal}}'
sj-lan1144-primary_default internal=true
```

Граница доказательства: backend-сеть internal; приложение строится и запускается без pull/build/CDN. Доступный proxy ingress не выдаётся за глобальный firewall; исходящий интернет закрывает политика закрытой площадки.
