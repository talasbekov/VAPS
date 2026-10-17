# Обновление и очистка старых пакетов

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Авторизовано пользователем собрать обновление и убрать лишние файлы проекта; выполнять в текущем изолированном worktree.

**Goal:** Выдать новый офлайн ZIP с картой и исправлением организаций, с очисткой старых пакетов после успешного обновления.

**Architecture:** Штатный app-only update сохраняет backup/rehearsal/fingerprint и запрет миграций. Дополнительный `--cleanup-root` после SUCCESS запускает отдельный stdlib-модуль. Модуль удаляет только полностью распознанные пакеты приложения из непосредственных детей явно указанного каталога; действующая установка, текущий пакет, одна последняя предыдущая версия, контейнерные пути и резервные копии сохраняются.

**Tech Stack:** Python stdlib, Docker Compose v2, Linux/amd64, unittest, существующий LAN builder.

**Spec:** Требования и границы в этом документе; конкретный серверный каталог из истории пользователя: `/home/eco/updates/Smart Josparlau`, действующая установка `smart-josparlau-offline-2026-09-13`.

## Global Constraints

- Не менять backend/схему, импортные ID, даты и учётные записи.
- Не удалять volumes, образы, контейнеры, резервные копии и файлы других проектов, включая Digital.
- Не определять назначение каталога только по имени. Пакет должен иметь корректный release.json, образы Smart backend/frontend, ограниченный набор файлов и совпадающие хэши.
- Не удалять полные установки/source/media/private/.env, неизвестные файлы, symlinks и mount points. Для удаления использовать проверенные отдельные файлы и пустые каталоги, без общего recursive delete/prune.
- `--check`, ошибка/откат обновления и отсутствие SUCCESS никогда не запускают удаление.
- Ошибка необязательной очистки не откатывает успешно обновлённое приложение; отдельный отчёт объясняет причину.
- Сборка из чистого коммита, новая папка вне репозитория. Серверного доступа нет, выдаётся переносимый архив и точные команды.

## Review Focus

- Скопированная установка либо каталог другого Compose-проекта с похожим именем должны сохраняться.
- Архив с лишним .env/media, traversal либо ссылкой не является кандидатом.
- Каталог/файл, изменившийся между планом и удалением, должен сохраняться.
- Новый контейнерный bind mount или изменившийся SUCCESS должен остановить очистку.
- `--cleanup-root` вместе с `--check` либо неудачной установкой не должен ничего удалять.

### Task 1: Ограниченная очистка и подключение обновлятора

**Files:** `deploy/lan/cleanup-old-releases.py`, `deploy/lan/test_release_cleanup.py`, `deploy/lan/update.py`, `deploy/lan/test_unified_update.py`, `deploy/lan/build.py`, `deploy/lan/UPDATE-RU.md`.

**Interfaces:** `plan_cleanup(root, protected, current_revision)` возвращает JSON-совместимый план; `apply_plan(plan, protected)` повторно проверяет пути/идентичность и удаляет лишь перечисленные файлы; `cleanup_after_update(update, folder, root, package)` проверяет SUCCESS/живые контейнеры, сохраняет план и результат в backup.

- [x] Написать и наблюдать RED для реальных временных каталогов/ZIP, защиты данных/ссылок/mounts, retention и повторной проверки.
- [x] Реализовать модуль и опциональный `--cleanup-root`; включить файл в manifest и полную поставку.
- [x] Полный Linux deploy suite65pass. Первоначальная ошибка shallow bind `/checks` исправлена только в стенде на `/work/deploy/lan`; логи сохранены. Независимый review: три Important устранены RED→GREEN (Options.device именованных bind volumes, kernel mountinfo для same-device bind, повреждённый DEFLATE и отдельный отчёт ошибки). Повторный обзор: открытых Critical/Important нет.
- [x] Обновить серверную инструкцию и заметки; исходники готовы к чистому коммиту перед сборкой.

### Task 2: Поставка и реальная проверка

**Files:** Новые собственные скрипты/логи `.ux-work/*20261016*`, `.local-review/update-cleanup-20261016/`; архив вне Git.

**Interfaces:** Вход — чистый коммит задачи1; выход — ZIP, SHA256, verification.json, инструкция запуска на известном серверном пути.

- [x] Исходный Docker inventory18контейнеров сохранён; prepare и Linux/amd64 build2ca558a6 offline PASS.
- [x] Новый frontend-контейнер:8карта+3организации browser PASS; свежий canonical gate с production build/types PASS.
- [x] Настоящий app-only/cleanup на новой7service копии:134таблицы/15318строк/128seq/8952media/4private совпали, backup восстановлен/сверен;2старых fixture-пакета удалены, защищённые сохранены; check без удаления.
- [x] Все manifest/source hashes и11файлов ZIP/CRC/содержимое сверены. Прежние18container IDs/images/mounts сохранены; свой стенд/volumes/networks и5временных тегов убраны.
- [x] Задачи/журнал и серверные команды обновлены. ZIP383951507байт, SHA256 d218c578af03c6c3144a58d784fc87e8a4c1774b9ed2431dd2329610b5513804. Серверного применения не было.
