# Восстановление локального помощника и проверка карт

> Execute inline with superpowers:executing-plans; existing linked worktree and isolated build directories are retained. Scope is an authorised bugfix, no additional approval round is needed.

**Goal:** Восстановить прежнее понимание текста помощника по ОМ и подтвердить, что карты работают из имеющихся локальных файлов.
**Spec:** Пользователь показал disabled assistant на localhost38130 и потребовал сохранить локальные карты. После слияния нельзя оставлять прежнюю работающую Ollama отключённой.
**Root cause:** Исходные3380/3480: OPS_ASSISTANT_PROVIDER=ollama, host.docker.internal11434, qwen2.5:7b. Новый preview helper жёстко задавал disabled и не копировал эти три несекретные настройки; сохранённой DB connection row ещё нет, provider правильно использовал fallback. Preview backend/worker находились только во внутренней сети, без пути к локальной Ollama. Ollama и qwen2.5 уже доступны на хосте и собственной ingress-сети preview.
**Map finding:** AmbientBackground/MapBackdrop и интерактивная карта используют общий локальный asset loader `/maps/astana/{manifest,geometry}.json`. Copyright hyperlink не является загрузкой карты; сохранить атрибуцию. Обновить подпись на «Локальная карта», подтвердить отсутствие внешних запросов браузером.

## Constraints

- Сохранить 2008 сотрудников / 21 ОМ, прежние учётки, пароли, ключ шифрования/session identity, текущую БД и тома.
- Не менять исходные3380/3480, не запускать старые demo-rollback, не скачивать новые модели или карты.
- Восстановить только прежние три Ollama settings. Не менять DB connection/configuration rows и не создавать тестовые ОМ/поручения на настоящих данных.
- Для доступа к локальной Ollama подключить только собственные backend/worker к собственной ingress-сети. DB/Redis остаются во внутренней сети, портов backend/worker наружу не добавлять.
- Перед заменой сохранить точные ID/labels/runtime и data fingerprints. Сохранить прежние контейнеры для отката; переключение и reload собственного relay выполняются только после проверок новых сервисов.
- Сборка фронта в новой внешней `.build/yandex-assistant-map-20261102/frontend`; текущую сборку не перезаписывать. UI-only caption не меняет геометрию/поиск/атрибуцию.
- Реальный запрос к уже выбранной локальной модели — только synthetic connection check без персональных данных и без business mutations. Проверить и backend, и worker config, worker readiness, UI-enabled state.
- Secrets/private runtime/backups/screenshots — в `.local-review/yandex-assistant-map-20261102` с приватным ACL; не включать их в Git.

## Work

- [x] Воспроизвести disabled configuration и сравнить с обеими прежними установками read-only.
- [x] Проверить наличие модели и доступность host/own ingress без загрузок.
- [x] RED/GREEN regression на preview environment; исправить перенос трёх параметров.
- [x] Выполнить guarded backend/worker switch с rollback, проверить настоящий ответ локальной модели.
- [x] Уточнить локальную подпись карты, собрать фронт отдельно.
- [x] Проверить карты с внешними запросами, заблокированными в браузере, и доступность text assistant.
- [x] Подтвердить сохранность данных, сделать независимый обзор, обновить журнал/передачу и сообщить результат.

## Verified implementation

- `preview.py` больше не затирает три явно восстановленные настройки Ollama. Regression: RED 3 failures → GREEN 4 passed; session/DB identity проверяется отдельно. Инертные тесты трёх стадий rollback — 3 passed, без Docker/БД/реальных процессов.
- Реальная `qwen2.5:7b` ответила через provider.interpret из нового backend и worker; это не mocked transport. Первый cold-start check с укороченным 20s timeout истёк во время загрузки модели. Обычный пользовательский provider timeout 55s прошёл; таймаут приложения не менялся. История сохранена.
- Новый worker отвечает Celery ping. Backend/worker имеют private+собственную ingress; DB/Redis остаются прежними, публикаций портов у backend/worker нет. Старые backend/worker остановлены и сохранены для отката.
- Браузер именно на localhost38130 подтвердил enabled Ollama, доступный radio/text input, отсутствие disabled banner и работу локального canvas с внешними запросами, заблокированными заранее. Загружены ровно `/maps/astana/manifest.json` и `geometry.json`, внешних запросов 0, business writes 0.
- Подпись карты изменена на «Локальная карта», сохранён © источник. Полный gate после обновления существующего loading-text expectation: 1210 passed / 0 failed, TypeScript/production build. Работающая сборка не перезаписывалась.
- Приложение `d7099dac50a390711b778265f5ccc3ff17ca83be` запущено на прежнем38130 с новой подписью. Frontend переключён с собственным rollback на конфигурацию уже восстановленной Ollama, без ротации session key и без остановки БД.
- Финальный браузер на localhost подтвердил localCaption, доступный текстовый режим, 2008 сотрудников / 21 ОМ, оба локальных map assets200, painted canvas на1440/390, zero external requests / API errors / business writes.
- Финальные fingerprints: 147 public tables + protected auth_user совпали, изменился только JWT-журнал входов. DB/Redis/relay, тома, пароли, session/encryption source прежние. Map manifest/geometry/ATTRIBUTION побайтово совпали с предыдущим live build. Пересозданы только собственные backend/worker; их опубликованных портов нет.
- Сводка/регрессионные helpers: `.build/yandex-assistant-map-20261102/`; приватные runtime rollback, fingerprints и screenshots: `.local-review/yandex-assistant-map-20261102/`. Новую работающую `.build/yandex-assistant-map-20261102/frontend` не очищать.

- Независимый source/evidence review: принять, без открытых Critical/Important/Minor. Честные границы: новый full queued LLM/UI lifecycle не создавался на реальных данных; реальные ответы модели, readiness очереди и enabled UI проверены отдельно. Интерактивная карта использует тот же неизменённый локальный loader; свежий browser proof относится к фону на странице помощника.
