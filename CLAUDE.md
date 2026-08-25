# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Smart Josparlau — правила работы Claude Code

## Проект

Smart Josparlau: Personnel Records (в разработке). Эталон формы — прототип Smart Жоспарлау; описание продукта и карта модулей — `obsidian-vault/Продукт/` (`Карта-модулей.md`).

| Часть | Где | Гейт |
|---|---|---|
| Бэкенд — Django/DRF, PostgreSQL | `organization_management/apps/*` | `pytest` по всем приложениям; схема API — `schema.yaml` / `/api/schema/` |
| Фронтенд — Next.js + TypeScript | `Backend/PersonnelStatus/PersonalRecordFront` (стенд `next dev`, :3106), `frontend/` | `tsc` + полный `playwright.smoke.config.ts` с `SMOKE_LIVE=1` |
| Задачи | Plane http://localhost:8090, workspace `vaps`, проект **Smart Josparlau** | `plane_task.py` (ниже) |
| Знания, журнал, дефекты | `obsidian-vault/` — вход `00-Index.md` | — |
| Секреты | `~/.config/vaps/` (ключ Plane, пароль стенда) | в репозиторий и в текст команд не попадают |

Заморожено: `.claude/memory` и `docs/api-gaps.md` (с 19.08.2026, снапшот — `obsidian-vault/Archive/`), ClickUp (с 24.08.2026; старые id вида `86eyqf5dc` остались в описаниях задач). BMAD — в `Archive/bmad-process/`, стори-цикл спит с 10.08.2026.

## Жёсткие правила

1. Задачи нет в Plane — задачи нет. Своё (находка, техдолг, «заодно») — только в `Предложено Claude`, в работу без разрешения заказчика не брать.
2. Статус в Plane меняется в момент перехода; `Review` → `Done` напрямую нельзя.
3. Всё сделанное записано в vault в том же заходе. Не записано — не сделано.
4. Закрытие задачи = гейт + vault + коммит + пуш + `Done` + замер RSS + пересборка Plane — и сразу следующая задача.
5. `git add -A` / `git commit -a` запрещены; в `main` не коммитить; секреты в репозиторий не попадают.
6. Фронт — сначала `/ui-ux-pro-max`, потом код.
7. Задача делается на обеих сторонах (фронт + бэк); сломанное соседнее — провал задачи.
8. Результат проверки — видимый вывод команды, не слово «проверено».

## Команды

```bash
# Plane — ключ читается из ~/.config/vaps/plane-api-key, в команды не подставлять
python3 /home/erda/plane/migration/plane_task.py list "Smart Josparlau" --open
python3 /home/erda/plane/migration/plane_task.py states "Smart Josparlau"
python3 /home/erda/plane/migration/plane_task.py set "Smart Josparlau" <issue-id> "In Progress"
python3 /home/erda/plane/migration/plane_task.py add "Smart Josparlau" "Название" --desc "зачем; откуда взялась; что будет, если не делать" --state "Предложено Claude"
#   --state Backlog — только для задач, пришедших от заказчика. Команда идемпотентна по имени.
python3 /home/erda/plane/migration/plane_task.py plan "Smart Josparlau" obsidian-vault/WIKI/<план>.md
cd /home/erda/plane && docker compose -p plane-selfhost --env-file .env up -d   # если Plane не поднят

# Память стенда — RSS в КБ; свежий next dev = сотни МБ, порог 2000000
ps -o pid,rss,etime,cmd -C node --sort=-rss | head

# Гейт — TODO: вписать точные вызовы (pytest из корня бэкенда; tsc / playwright smoke / запуск next dev — из package.json PersonalRecordFront)
```

Прямой API Plane: `GET/PATCH http://localhost:8090/api/v1/workspaces/vaps/projects/<project-id>/issues/`, заголовок `X-API-Key`. Стек и доступы — `/home/erda/plane/README-vaps.md`, `/home/erda/plane/CREDENTIALS.txt`.

## Obsidian vault — источник правды

Два слоя:

- **Знания**: `RAW/` (сырьё — не переписывать, только ссылаться) → `WIKI/` (заметки с `[[ссылками]]`, планы, эпики) → `OUTPUT/` (готовые документы наружу); журнал обработки — `LOG.md`. Продукт — `Продукт/`, канон требований — `Требования/`.
- **Разработка**: `Personnel-Records/`, `Frontend/`, `Infrastructure/` — в каждом `Status.md`, `Changelog.md`, `Decisions.md`, `Known-Issues.md`. Разделы VisitX и Accreditation создаются при старте работ.

Куда что писать — в том же заходе, что и работа, не пакетом в конце сессии (пакетная дозапись теряет «почему»):

| Событие | Файл |
|---|---|
| Ход работы, итог, коммит, замер RSS, результат прогона, стенд поднят/погашен | `<Модуль>/Changelog.md` |
| Изменилось состояние модуля | `<Модуль>/Status.md` |
| Решение и его причина, отвергнутый вариант, список зависимостей правки, отклонение от эталона | `<Модуль>/Decisions.md` |
| Найденный дефект и обходной путь | `<Модуль>/Known-Issues.md` |
| Взятие / закрытие задач («Закрытые» — с коммитом), ранжирование очереди, расхождения с Plane при недоступном трекере | бэклог-заметка `WIKI/Бэклог-Smart-Josparlau.md` |
| План — целиком, с рассуждением и отвергнутыми вариантами | `WIKI/<план>.md` |
| Транскрипт, статья, черновик | `RAW/` → далее по циклу из `00-Index.md` (RAW → WIKI → индекс → `LOG.md`) |

VAPS-специфичное в auto-memory (`.claude/memory`) и `docs/api-gaps.md` не пишется — только в vault. Auto-memory допустим лишь для общего, не относящегося к VAPS.

## Plane — задачи

Plane — вход задач, vault — их разбор и исполнение; расходиться не имеют права. Любая поставленная задача, даже «поправить подпись» или «перезапустить стенд», — карточка; работа над задачей, появившейся не из трекера, начинается с её заведения.

Состояния: `Backlog` → `In Progress` → `Review` → `On test` → `Done`; отдельно `Предложено Claude` и `Cancelled`. (`Review` и `On test` заведены руками в группе `started`; `Предложено Claude` — переименованная `Todo`.)

| Состояние | Когда | Зеркало в vault |
|---|---|---|
| `Backlog` | задача пришла от заказчика | — |
| `Предложено Claude` | всё, что придумал не заказчик: находка, техдолг, рефакторинг, «заодно бы починить», следствие чужой правки, шаг плана или ревью, ошибка из прогона (одна ошибка — одна карточка). В описании: откуда взялась и что будет, если не делать | — |
| `In Progress` | перед первой правкой кода. Из `Предложено Claude` — только после того, как заказчик перевёл карточку в `Backlog` или разрешил комментарием | строка в бэклог-заметку |
| `Review` | реализация завершена, идёт само-ревью / `/code-review` | — |
| `On test` | ревью пройдено, гоняются тесты и стенд. Из `Review` в `Done` напрямую нельзя | — |
| `Done` | гейт прогнан, вывод виден, дефектов нет. Красные тесты или дефект — обратно в `In Progress` | см. «Закрытие задачи» |
| `Cancelled` | заказчик пометил «не нужно» | причина в vault |

- Комментарий заказчика внутри карточки («не нужно», уточнение, приоритет) — указание.
- План (в том числе через superpowers) идёт в оба места: заметка в `WIKI/` целиком + шаги задачами через `plan` (шаг — строка списка верхнего уровня, вложенные строки уезжают в описание шага).
- Расхождение Plane ↔ vault ↔ код — дефект работы: чинить сразу. Трекер недоступен — расхождение записать таблицей в бэклог-заметку и довести, когда доступ вернётся.

## Цикл работы

**Старт сессии / модуля**
1. Прочитать `obsidian-vault/00-Index.md`, затем `<Модуль>/Status.md` и `<Модуль>/Known-Issues.md`.
2. `list "Smart Josparlau" --open`; прочитать новые комментарии заказчика в `Предложено Claude` и отработать их.
3. Ранжировать очередь; порядок с обоснованием — строкой в бэклог-заметку.

**Порядок выбора** — по смыслу, не сверху вниз: (1) блокирующее остальные — модель, контракт, от которых зависят экраны; (2) дефекты живого стенда; (3) задачи заказчика в логическом порядке сценария; (4) разрешённые заказчиком из `Предложено Claude`. Смежное (один файл/экран) — подряд: переключение контекста дороже правки.

**Взятие**: карточка → `In Progress` до первой правки кода; строка в бэклог-заметку; ветка не `main` (если на `main` — `git switch -c <ветка>`).

**По ходу**: каждое действие — правка, стенд, дефект, решение, отвергнутый вариант — строкой в vault сразу; статус Plane — в момент перехода.

**Закрытие задачи (Definition of Done), строго по порядку**
1. Код готов, гейт по глубине правки прогнан (таблица ниже), вывод виден, дефектов нет.
2. Vault: `Changelog.md` (дата, что сделано), `Status.md` при смене состояния, `Decisions.md` / `Known-Issues.md` при необходимости; строка задачи в бэклог-заметке — в «Закрытые».
3. Git: файлы явно → `git status --short`, `git diff --cached --stat` глазами → `git commit` → `git push` → `git status -sb` показывает ветку в ноль с `origin`.
4. Карточка → `Done`; хэш коммита — последним шагом в строку `Changelog.md` (записанный до коммита устаревает при `--amend`).
5. Замер RSS `next dev`; цифра — в ту же запись vault; выше порога — перезапуск по PID.
6. Пересборка Plane: `list --open`; состояния сверить с фактом (зависшее в `Review`/`On test` — довести или вернуть в `In Progress`); дубли свести; комментарии заказчика отработать; находки разложить по колонкам; очередь ранжировать заново. Итог — строкой в `Changelog.md` и бэклог-заметку: что сделано, что решено, что отложено и почему.
7. Отчитаться заказчику — и в том же заходе взять следующую задачу.

Отказ пуша (сеть, права, разошедшиеся истории) — блокер: карточка не переводится в `Done`, причина пишется в vault, разбирается до взятия следующей задачи.

**Останов допустим ровно в четырёх случаях**: очередь пуста; нужно решение заказчика (вилка, которую нельзя закрыть допущением); инструмент недоступен и не поднимается; заказчик прервал. В каждом — сказать прямо, что остановило и что уже сделано. «Очередь пуста» — тоже вывод, требующий проверки: полный прогон → находки карточками в `Предложено Claude` → только потом отчёт, что работа встала и ждёт решений.

## Задача целиком: фронт + бэк + связность

- Требование упирается в модель или API — меняются модель и API в тот же заход. Заглушка на клиенте вместо серверного факта — долг, не выполнение.
- **До кода** — грепом найти всех читателей изменяемого поля/эндпоинта/компонента (карточка, реестры, сводки, отчёты, экспорт, мок-слой, e2e-пины) и решить по каждому; список и решение — в `Decisions.md`.
- **Расширять, не подменять**: старый источник живёт, пока его кто-то читает; новое добавляется рядом, старое снимается отдельным шагом после переезда читателей. Существующие строки переносит миграция с бэкфиллом — новая сущность не должна быть пустой у уже заведённого.
- **Контракт с двух концов в один заход**: поле на сервере → типы клиента → мок-слой. Иначе тесты зелены на одной стороне и врут про другую.
- **После кода** — весь гейт, не свои тесты: `pytest` по затронутым приложениям целиком, `tsc` + полный smoke. Упавший соседний тест — часть твоей задачи. Пины канон-строк (состав колонок, подписи) правятся осознанно, с комментарием почему, а не подгоном под новый вывод.
- **UI-правка** — снимок экрана на стенде обязателен: сбитая вёрстка и выдуманные числа видны на картинке и невидимы для ассертов «текст на месте».
- **Новый тест** — красная проба: обязан падать на мутации, которую стережёт.

## Полный прогон работоспособности

Решает глубина правки, не таймер:

| Затронуто | Гонять |
|---|---|
| Модели, миграции, схема БД, индексы/ограничения | полный прогон |
| Контракт API: эндпоинт, поле, код ошибки, права | полный прогон |
| Бизнес-логика, сервисы, расчёты, переходы состояний, сигналы | полный прогон |
| Архитектура: перенос слоёв, общие хуки/провайдеры, роутинг, авторизация | полный прогон |
| Общий компонент или токен дизайн-системы, который читают многие экраны | полный прогон |
| Цвет, отступ, подпись, иконка, порядок в одном месте | целевые пробы + `tsc` |
| Текст в доке, комментарий, запись в vault | ничего |

Сомневаешься — считай правку глубокой.

**Когда гонять полный прогон (решение заказчика 25.08.2026):** полный прогон НЕ прерывает работу над очередью. Он гоняется, когда работы закончились — очередь пуста или заказчик сказал остановиться; тогда прогон и есть следующая работа. По ходу задачи хватает целевых проб её глубины (таблица выше) плюс `tsc`. Ориентир — примерно раз в шесть часов активной работы: если за это время очередь так и не опустела, прогон делается всё равно, между задачами. Тот же прогон обязателен после перезапуска или пересборки стенда и когда что-то повело себя странно без явной причины.

Состав прогона:
1. **Бэкенд весь**: `pytest` по всем `organization_management/apps`; обход API по схеме (`schema.yaml` / `/api/schema/`, не по памяти) — каждый эндпоинт отвечает (не 5xx, не 404 на живом маршруте), включая нетронутые.
2. **Фронтенд весь**: `tsc`; полный `playwright.smoke.config.ts` с `SMOKE_LIVE=1` (без переменной живые спеки молча скипаются, скип читается как зелень); обход экранов кликами — каждый раздел, каждый ключевой сценарий до конца, консоль браузера — на ошибки.
3. **Связка фронт ↔ бэк**: экраны проверяются на живых данных, не на моке (мок зелен и при 500).
4. **Память стенда**: замер RSS — раздувание тоже дефект.
5. Инструмент — по задаче (Playwright, pytest, curl по схеме, скилл `webapp-testing`, `project-sentinel` для полного аудита, `/code-review`); результат виден выводом команды.

С результатом: каждая ошибка — своя карточка в `Предложено Claude` (что сломано, где — файл/эндпоинт/экран, как воспроизвести, чем грозит; «поправить всё найденное» карточкой не считается); очередь пересортировать; взять следующую задачу — прогон часть работы, не остановка. Запись в `Changelog.md`: дата, что гонялось, чем, числа (сколько тестов, сколько прошло), что найдено, какие карточки заведены. Зелёный прогон записывается тоже — «ничего не найдено» это факт о системе.

## Git

- `main` прямых коммитов не принимает — только тематическая ветка.
- Одна задача — один коммит с указанием карточки Plane: `feat(events): …`, `fix(ops): …`, `chore(stand): …`. Попутное и несвязанное — отдельным коммитом, не прицепом.
- `git add -A` и `git commit -a` запрещены: в дереве мусор и тяжёлые каталоги (`frontend/` с зависимостями — сотни МБ, прототипные выгрузки, снимки `.shot-tmp*`). Файлы перечисляются явно.
- Перед пушем в индексе нет паролей, ключей, `.env`.
- Первый пуш ветки — `git push -u origin <ветка>`. «Запушил» без вывода команды — обещание, не факт.

## Фронтенд

- Любая правка вида или поведения (`Backend/PersonnelStatus/PersonalRecordFront`, `frontend/`) — сначала скилл `/ui-ux-pro-max`, потом код: новые экраны и компоненты, рефакторинг UI, цвет/типографика/отступы/сетка, состояния загрузки/ошибки/пустоты, навигация, анимация, адаптивность, доступность. Чисто серверная работа (модели, миграции, сервисы, API без изменения экрана) скилла не требует.
- Канон формы — прототип Smart Жоспарлау и `obsidian-vault/Продукт/`; принятые отклонения — `Frontend/Decisions.md`. Результат скилла — рекомендация; при конфликте с эталоном или решением заказчика побеждает эталон, расхождение записывается в `Decisions.md`.

## Стенд `next dev` (:3106)

Течёт: за долгую сессию RSS уходит в гигабайты, процесс рвёт соединения и съедает память машины. `CLIENT_FETCH_ERROR`, `ECONNRESET`, `fetch failed`, обрывы на `/api/auth/csrf/` — в 9 случаях из 10 раздувшийся dev-сервер, а не дефект кода.

- Мерить после каждой закрытой задачи и перед e2e / обходом стенда (команда — в «Командах»). Порог 2 ГБ (≈2000000 КБ): гасить по PID и поднимать заново, не дожидаясь падений. Не `pkill -f` — паттерн убивает собственный шелл.
- Обрыв соединения → сначала замер и перезапуск; дефект заводится, только если повторилось после чистого перезапуска.
- Один `next dev` на машину: два делят `.next` и травят сборку друг друга. Параллельная сборка — `NEXT_DIST_DIR=.next-build`.
- Закончил проверку — погасить стенд; забытый на ночь к утру занимает всю память.
- Каждый замер и перезапуск — строкой в `Frontend/Changelog.md` с цифрой RSS. Раздувание раньше срока повторяется — карточка в `Предложено Claude`, а не молчаливый рестарт.

## Status

This repository is freshly initialized. No source code, build configuration, or test framework has been added yet. Commands below will need to be updated as the project takes shape.

## Common Commands

_Not yet configured — add build, lint, test, and run commands here as the project is set up._

Likely candidates once scaffolded:

```bash
# Install dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Lint
ruff check .
```

# BMAD Epic and Story Decomposition Rules

When creating epics and stories with BMAD, always decompose work as deeply as possible.

The goal is to create small, implementation-ready stories that can be built, tested, reviewed, and reverted independently.

## Main Rule

Do not create large stories that mix multiple responsibilities.

Bad examples:

* Build authentication
* Build admin panel
* Build Telegram bot
* Build user management
* Build CRUD
* Build integration
* Build API layer

Always split large work into smaller stories.

## Story Size Rules

Each story must have:

* one clear goal
* one responsibility
* one small deliverable
* clear acceptance criteria
* clear technical tasks
* clear dependencies
* clear tests
* clear files to create or modify

A story is too large if:

* it touches more than 5 files
* it mixes backend and frontend
* it mixes database and API logic
* it mixes implementation and review
* it contains several endpoints
* it contains several bot commands
* it cannot be tested independently
* it cannot be implemented in one focused coding session

If a story is too large, split it before finalizing.

## Required Structure For Every Story

Every story must use this structure:

```md
## Story X.Y: Title

### Goal
Short result of this story.

### Scope
What must be implemented.

### Out of Scope
What must not be touched.

### Acceptance Criteria
- [ ] Given ..., when ..., then ...
- [ ] Given ..., when ..., then ...

### Technical Tasks
- [ ] Task 1
- [ ] Task 2
- [ ] Task 3

### Files To Create
- `path/to/file`

### Files To Modify
- `path/to/file`

### Dependencies
- Depends on Story X.Y
- Blocks Story X.Z

### Tests
- Unit:
- Integration:
- Manual:

### Definition of Done
- [ ] Code implemented
- [ ] Tests added
- [ ] Tests passing
- [ ] Lint passing
- [ ] No hardcoded secrets
- [ ] Documentation updated if needed
```

## Backend Decomposition

Split backend work into separate stories by layer:

1. Models
2. Migrations
3. Schemas / Serializers
4. Repository / Query layer
5. Services
6. API Views / ViewSets
7. URL routing
8. Permissions / RBAC
9. Validation
10. Error handling
11. Audit logging
12. Tests
13. Documentation

Do not combine all backend layers into one story.

## API Decomposition

Each endpoint with business logic must be a separate story.

For every API story include:

* HTTP method
* URL path
* request schema
* response schema
* permissions
* validation rules
* error responses
* tests

If one story contains multiple endpoints, split it.

## Frontend Decomposition

Split frontend work into separate stories:

1. API client
2. Page layout
3. Form
4. Validation
5. Table / list
6. Detail view
7. Loading state
8. Error state
9. Permissions / route guard
10. Tests

Do not create a story called “Build page”. Split it into smaller stories.

## Telegram Bot Decomposition

Split Telegram bot work into separate stories:

1. Bot initialization
2. Command registry
3. Each command separately
4. Conversation state
5. Callback handlers
6. Message templates
7. Backend API integration
8. Logs and status tracking
9. Error handling
10. Tests

Each bot command must be its own story.

## Claude Code / Shell Execution Decomposition

Split Claude Code, Codex, shell, SSH, and tmux work into separate stories:

1. Command validation
2. Execution adapter
3. Non-interactive execution
4. Interactive/tmux session handling
5. Output parsing
6. Status tracking
7. Log collection
8. Timeout handling
9. Error handling
10. Security restrictions
11. Audit log
12. Tests

Do not mix command execution, logs, status tracking, and security in one story.

## Database Decomposition

Split database work into separate stories:

1. Table/model creation
2. Migration
3. Indexes
4. Constraints
5. Seed data
6. Data migration
7. Rollback strategy
8. Query optimization
9. Data integrity tests

Every risky migration must include rollback notes.

## Final Output Required

After creating epics and stories, always include:

1. Epic list
2. Story list
3. Dependency map
4. Recommended execution order
5. Risks and edge cases
6. Blockers
7. Next BMAD command

Before finalizing, check every story.

If any story is too large, split it.
If any dependency is unclear, add it.
If any test is missing, add it.
If implementation order is unclear, create dependency map first.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships. It is an OPTIONAL aid, not a mandatory step — reach for it only when it earns its keep.

Rules:
- For targeted lookups (a known file, function, symbol, or string), use grep/Read/git directly — they are faster and exact. graphify is NOT needed for these.
- Reach for graphify on BROAD or cross-cutting questions where you don't yet know where to look — "what calls X", "how does Y relate to Z across modules", architecture orientation in unfamiliar code. Then: `graphify query "<question>"` (scoped subgraph), `graphify path "<A>" "<B>"` for relationships, `graphify explain "<concept>"` for focused concepts; `graphify-out/wiki/index.md` for navigation; read `graphify-out/GRAPH_REPORT.md` only for broad architecture review.
- Updating the graph is by NECESSITY, not routine: run `graphify update .` (AST-only, no API cost) only when backend app-code (`Backend/PersonnelStatus/Personnel-Records/organization_management/apps`) changes meaningfully. ⚠️ Текущий `graphify-out/` построен по УДАЛЁННОМУ `Backend/VAPS` — до первого `graphify update .` он описывает код, которого больше нет. Skip it for throwaway spikes (`spikes/`, `deploy/spike-*`) and docs — they don't belong in the graph.
