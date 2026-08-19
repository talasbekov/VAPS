---
name: docker-port-foreign-container
description: "Не отбирать docker-порт у контейнера чужого проекта: упавший старт срывает сетевой sandbox, и restart его не возвращает"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 913c8486-c976-4cc1-a4f8-9c4f7bfaf9e1
---

На машине Bratan одновременно живут стеки нескольких проектов (masterqalakz,
accr, goals). Порт `5433`, который `make gate` VAPS считает своим, регулярно
держит `masterqalakz-db_test-1`.

**Что ломается.** Если `docker start`/`compose up` падает на «port is already
allocated», контейнер остаётся Up, но БЕЗ публикации порта на хост:
`docker port` пуст, при том что `HostConfig.PortBindings` в inspect цел.
`restart` и `stop`+`start` проброс НЕ возвращают — sandbox пересоздаётся только
пересозданием контейнера. Если том анонимный, пересоздание теряет данные.
Ровно так в 10.1b была сорвана и затем пересоздана чужая тестовая БД.

**How to apply:**
1. Перед `make gate` проверять `docker ps --filter "publish=5433"`. Если порт
   держит ЧУЖОЙ проект — не гасить его молча: это side effect вне репозитория,
   спрашивать Bratan.
2. Для промежуточных прогонов порт вообще не нужен: поднять свой
   `docker run -d --name vaps-db-<story> -e POSTGRES_USER=vaps -e
   POSTGRES_PASSWORD=vaps -e POSTGRES_DB=vaps -p 5434:5432 postgres:16` и гонять
   pytest с `VAPS_DB_PORT=5434`. Цепочка `make gate` (ruff → pytest -m "not
   property and not concurrency and not slow and not golden" → makemigrations
   --check) воспроизводится вручную один в один.
3. Буквальный `make gate` (нужен для DoD и бюджета 300s) — один раз в конце,
   освободив порт, и сразу вернуть чужой контейнер, ПРОВЕРИВ `docker port`.
4. У самого VAPS `db` томов нет — его контейнер эфемерный, `docker rm -f
   vaps-db-1` безопасен и лечит такой же сорванный sandbox у себя.
