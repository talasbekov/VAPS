# Повторная проверка объединённой версии

> Execute inline with superpowers:executing-plans. This is verification of the existing linked worktree; no new features or approval round is needed.

**Goal:** По просьбе пользователя заново проверить собранный проект, вход, основные сценарии и сохранность настоящих данных.
**Spec:** Объединённая R7 + codex/yandex 2af03984, приложение 76a50b0f, документ 0340f467. Пользователь выбрал оформление Yandex и данные основной 3380; текущая проверенная копия на 38130 содержит 2008 сотрудников / 21 ОМ.
**Architecture:** Повторный frontend gate/build в новом внешнем каталоге, полный backend suite на новой изолированной PostgreSQL, реальный боевой lifecycle на синтетическом стенде и read-only обход текущего preview. Проверки не заменяют данные пользователя, пароли, тома или исходные установки.
**Tech Stack:** Next/React, Playwright/Edge, Django/pytest, PostgreSQL/Redis, локальные Docker images.

## Constraints and review focus

- Не перезаписывать работающую `.build/yandex-update-20261102/frontend` и не менять базу 38130 или источники 3380/3480 бизнес-действиями.
- Фиксировать точные Git SHA и hashes исходников; сравнить deployed snapshot с checkout.
- Сохранить все незакоммиченные AGENTS/vault и прежние планы.
- Новые build/test исходники — только во внешней `.build/yandex-recheck-20261102`; реальные fingerprints/screenshots/runtime evidence — `.local-review/yandex-recheck-20261102` с приватным ACL.
- Полный browser lifecycle использует только новую синтетическую базу с точным маркером и scoped test roles. Старые demo-rollback не запускать.
- Вход admin/admin123 не выдавать за работающий; не менять пароль старого admin без запроса.
- Сбои расследовать до правок. Если потребуется исправление, воспроизвести, проверить минимальную правку и повторить относящиеся проверки.
- Не считать discovery прохождением browser cases; различать реальные read-only проверки и синтетические fixtures.

## Task 1: Fresh automated checks

- [x] Записать HEAD/status, hashes, проверить работающие сервисы/DB/schema/media без изменения.
- [x] Заново выполнить frontend gate, TypeScript и production build вне работающего каталога; 32 контракта.
- [x] Выполнить полный backend pytest на новой PostgreSQL, Django check и makemigrations check.
- [x] Проверить deployment/tools policy suites на Linux без рабочих баз.

## Task 2: Browser and data

- [x] Заново проверить настоящий вход через страницу, рабочий стол, сотрудников/ОМ, журнал/roster/расход, объект и профиль на 1440/390.
- [x] На синтетическом стенде выполнить полный combat lifecycle по ролям и мобильный мастер с техникой.
- [x] Исправить подтверждённые сбои и заново проверить соответствующие сценарии.
- [x] Сравнить fingerprints настоящей базы и service identity до/после; сохранить пароли и исходные установки.

## Task 3: Finish

- [x] Остановить только собственный тестовый стенд, сохранить логи и работающий preview.
- [x] Обновить журнал/передачу и сообщить подтверждённые результаты и ограничения.

## Fresh results

- GitHub `codex/yandex` повторно проверена: `2af0398415d564ecb6fce12cf0dee0f7866c36ce`. Работающий application merge `76a50b0f` сохранён, сборка/сервисы preview не перезапускались.
- Frontend gate: 1210 passed, 0 failed, TypeScript и production build в новой внешней копии, без перезаписи работающего build. После ремонта только browser spec повторный TypeScript и реальное исполнение нового spec прошли; код приложения не менялся.
- Backend: 8438 passed, 1 skipped, 12 warnings, полный PostgreSQL/xdist run. Единственный skip требует отсутствующие внешние образцы анонимизированных документов. Warnings: прежние deprecated format_html/pypdf и in-memory Hypothesis store при read-only mount.
- Django system check и makemigrations --check --dry-run на новой синтетической LAN-базе прошли.
- Contracts: 32 passed; deployment Linux: 195 passed; tools Linux: 52 passed. Все deployment/tools контейнеры без сети и Docker socket, mounts только исходники read-only.
- Настоящий браузер: финальные 40 проверок (реальный вход, основные разделы, существующие карточки объекта и ОМ, все четыре вкладки объекта, включая обследования), 1440/390, API 2008 сотрудников / 21 ОМ, ноль JS errors / same-origin API >=400 / business writes. Предыдущие 29 и отдельные 6 detail checks сохранены отдельными receipts, не суммировать их как независимые сценарии.
- UX: 13 passed, настоящая аутентификация, синтетические read fixtures. Assistant: 1 passed, 18 сохранённых пользовательских сообщений, настоящий Redis/Celery, retry, explicit create и replay без дублей; HTTP модели подменён, внешняя модель не вызывалась.
- Combat: 2 passed, настоящие scoped роли head/HQ/employee/foreign/observer и все business APIs. Полный цикл create/return/resubmit/cancel/accept/replace/acknowledge/check-in/handover/complete и mobile equipment. После guarded restore только новой synthetic baseline мобильный case отдельно через grep: 1 passed.
- В коде приложения дефектов не подтверждено. В browser spec исправлены два воспроизведённых дефекта: роль без daily_report/forces не должна видеть недоступную ссылку; mobile сам создаёт свою группу через UI. Первый failed browser run сохранён, успешные numbered runs имеют точный SHA нового spec.
- 147 настоящих public-таблиц + защищённая проекция auth_user совпали до/после: бизнес-данные, схема, прежние пользователи/пароли, база/тома/session identity и service IDs/startedAt сохранены. Меняется только JWT-журнал от входов. Все 8952 media / 5 private / 177 static совпали с исходными manifests, без дополнительных/пропавших файлов.
- Source proof: 1340 deployed backend и 1111 frontend файлов совпадают с проверенной копией. Единственный изменённый e2e driver не используется production и проверен отдельно; его старая копия рядом с работающим build не перезаписывалась.
- Новые QA frontend38133 и 6 точных owned Docker-контейнеров остановлены по проверенным ID/labels; старые demo-rollback не запускались. Реальный preview38130 доступен, исходные3380/3480 и production не менялись.

## Verification harness rulings

- Первый contract run в copied source не нашёл местный Django venv. Этот worktree-path contract повторён в существующем linked checkout с теми же hashes: 32 passed.
- Первый tools container не монтировал deploy/lan, который импортируют тесты. Добавлен нужный read-only mount, повторный полный tools run: 52 passed. История неуспешных запусков сохранена.
- В backend helper позднее обнаружен захваченный Python default source=BACKEND. Поэтому фактический полный run читал исходный linked backend read-only, что точно записано в backend-full.json. Backend bytes до/после совпадают с snapshot; повторять 10-минутный suite на идентичных файлах не требуется. Для будущих запусков helper теперь явно передаёт source=lab.BACKEND.
- Reviewer выявил условный пропуск object detail в первоначальном навигационном helper. Исправлен поиск ссылок с query/back, добавлен обязательный assert, обе карточки на двух ширинах и API 4xx guards; strict final run прошёл.
- Приватные runtime/credentials, реальные fingerprints/screenshots и synthetic baseline — в `.local-review/yandex-recheck-20261102` с ACL текущего пользователя и SYSTEM; безопасные отчёты и logs — `.build/yandex-recheck-20261102`. В commit данные/секреты не входят.
