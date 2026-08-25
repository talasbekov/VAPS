# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**VAPS** — Personnel Records, VisitX (visitor management), and Accreditation system. Python project (inferred from `.gitignore`).

## Obsidian vault — единственный источник правды

Вся документация, знания, статус, история и открытые дефекты проекта VAPS ведутся в `obsidian-vault/` (открывается как обычный Obsidian vault — папка markdown-файлов, без live-коннектора). Точка входа и карта знаний: `obsidian-vault/00-Index.md` — читать первым.

Vault устроен в два слоя:

- **Слой знаний («второй мозг»)**: `RAW/` (сырые материалы — не переписывать, только ссылаться), `WIKI/` (структурированные заметки с `[[wiki-ссылками]]`, сюда же планы/эпики), `OUTPUT/` (готовые документы для внешнего использования), `LOG.md` (журнал обработки). Описание продукта — `Продукт/`, канон требований — `Требования/`.
- **Слой разработки**: рабочие разделы (Personnel-Records / Frontend / Infrastructure) с оперативным состоянием — Status / Changelog / Decisions / Known-Issues. Раздел BMAD-Process — в `Archive/bmad-process/` (стори-цикл спит с 10.08.2026; вернуть из архива при возврате к BMAD).

Правила для Claude Code:

- **Перед началом работы** над модулем (Personnel-Records / Frontend / Infrastructure) — прочитать `obsidian-vault/<Модуль>/Status.md` и `obsidian-vault/<Модуль>/Known-Issues.md`. Разделы VisitX и Accreditation не начаты — создаются при старте работ. Описание продукта и модулей — `obsidian-vault/Продукт/` (карта: `Продукт/Карта-модулей.md`).
- **После завершения работы** — обновить `Status.md` (если сменилось состояние модуля), добавить строку в `Changelog.md` (дата, что сделано, короткий хэш коммита), и `Decisions.md`/`Known-Issues.md` при необходимости.
- **Новый сырой материал** (транскрипт, статья, черновик) класть в `obsidian-vault/RAW/`, обработку вести по циклу из `00-Index.md` (RAW → WIKI → индекс → запись в LOG.md).
- **Не заводить** новые записи в `.claude/memory` (auto-memory) или `docs/api-gaps.md` для VAPS-специфичного контента — только в vault. Auto-memory может продолжать накапливать записи только НЕ специфичные для VAPS (например, про личность/стиль работы разработчика в целом), если харнесс сам их предлагает.
- `docs/api-gaps.md` и старая `.claude/memory` заморожены на 2026-08-19 — актуальные версии их содержимого перенесены в `obsidian-vault/*/Known-Issues.md` и `obsidian-vault/*/Decisions.md`; снапшот на дату заморозки лежит в `obsidian-vault/Archive/`.

## Plane — источник задач (ОБЯЗАТЕЛЬНО)

Задачи ведутся в **самостоятельно поднятом Plane**: http://localhost:8090, рабочее пространство `vaps`, проект **Smart Josparlau**. ClickUp с 24.08.2026 не используется (перенос — `obsidian-vault/WIKI/Бэклог-Smart-Josparlau.md`; исторические id вида `86eyqf5dc` остались в описаниях задач и в леджерах). Стек и доступы — `/home/erda/plane/README-vaps.md`, `/home/erda/plane/CREDENTIALS.txt`.

**Как работать с задачами.** Готовая обёртка над API (ключ берёт из `~/.config/vaps/plane-api-key`, права 600 — в командах ключ не писать):

```bash
python3 /home/erda/plane/migration/plane_task.py list "Smart Josparlau" --open   # незакрытые
python3 /home/erda/plane/migration/plane_task.py states "Smart Josparlau"        # состояния проекта
python3 /home/erda/plane/migration/plane_task.py set "Smart Josparlau" <issue-id> "In Progress"
python3 /home/erda/plane/migration/plane_task.py add "Smart Josparlau" "Название" --desc "зачем"
python3 /home/erda/plane/migration/plane_task.py plan "Smart Josparlau" <план>.md  # шаги плана → задачи
```

Прямые вызовы — `GET/PATCH http://localhost:8090/api/v1/workspaces/vaps/projects/<project-id>/issues/` с заголовком `X-API-Key`. Если Plane не поднят: `cd /home/erda/plane && docker compose -p plane-selfhost --env-file .env up -d`.

Plane — вход задач, vault — источник правды по их разбору и исполнению; расходиться они не имеют права.

Требования ниже обязательны к выполнению и не отменяются «мелкостью» правки:

1. **Подтягивать задачи из Plane.** В начале работы над разделом — `plane_task.py list "<проект>" --open`. Не выдумывать себе задачи в обход трекера; если работа появилась не оттуда — сначала завести карточку, потом делать.
2. **Взял в работу → сразу `In Progress`.** Перед первой правкой кода. Не после, не «в конце заодно».
3. **Код готов → `Review`.** Реализация завершена, идёт ревью (само-ревью / `/code-review`).
4. **Ревью пройдено → `On test`.** Гоняются тесты и проверка на стенде. В `Done` из `Review` напрямую не переводить.
5. **Тесты и проверка зелёные → `Done`.** Только по факту: гейт прогнан, вывод виден, дефектов нет. Красные тесты или найденный дефект возвращают карточку в `In Progress`, а не закрывают её.
   Цепочка состояний проекта ровно такая: `Backlog` → `In Progress` → `Review` → `On test` → `Done` (плюс `Предложено Claude` и `Cancelled`). `Review` и `On test` заведены руками в группе `started` — в чистом Plane их нет; колонка `Предложено Claude` — переименованная `Todo` из поставки.
6. **Каждый переход состояния зеркалить в vault.** Взял в работу — строка в бэклог-заметке; закрыл — перенести строку в «Закрытые» с коммитом, добавить запись в `<Модуль>/Changelog.md`, обновить `Status.md`, а отклонения и решения — в `Decisions.md`/`Known-Issues.md`. Задача не считается закрытой, пока vault не обновлён.
7. **Следить за актуальностью обоих.** Расхождение «в Plane одно, в vault другое» — дефект работы. Замеченное расхождение чинить сразу, не откладывая до конца сессии. Если трекер недоступен (стек не поднят, API не отвечает) — расхождение ЗАПИСАТЬ таблицей в бэклог-заметку vault и довести состояния, когда доступ вернётся.
8. **Колонка `Предложено Claude` — всё, что придумал не заказчик.** Задача, которую заказчик не ставил, заводится ТОЛЬКО в это состояние: побочная находка, техдолг, рефакторинг, «заодно бы починить», последствие чужой правки, идея по улучшению, задача, родившаяся из плана или ревью. В `Backlog` кладётся то, что пришло от заказчика.
   ```bash
   python3 /home/erda/plane/migration/plane_task.py add "Smart Josparlau" "Название" --desc "зачем и откуда взялось" --state "Предложено Claude"
   ```
   В описании обязательно — откуда задача взялась (какая работа её породила) и что будет, если её не делать. Заказчик читает эту колонку и управляет ей: комментарий внутри карточки («не нужно», уточнение, приоритет) — это указание. Задачу из `Предложено Claude` НЕ брать в работу самовольно: сначала заказчик переводит её в `Backlog` или разрешает комментарием, и только тогда `In Progress`. Помеченное «не нужно» — в `Cancelled`, с записью причины в vault.
9. **После каждой законченной задачи — замерить фронт и рассортировать Plane.** Не «когда накопится», а сразу по закрытии карточки. Сначала замер: раздулся ли `next dev` (см. § «Стенд фронтенда» ниже — `ps -o rss`, порог 2 ГБ, перешагнул — перезапуск по PID); цифра идёт в ту же запись vault. Затем трекер: прогнать `list "Smart Josparlau" --open`, сверить состояния с фактическим положением дел (закрытое — в `Done`, зависшее в `Review`/`On test` — довести или вернуть в `In Progress`), свести дубли, прочитать новые комментарии заказчика в `Предложено Claude` и отработать их, разложить свежие находки по колонкам и выстроить порядок оставшегося по приоритету. Итог этой пересборки — строкой в vault (`<Модуль>/Changelog.md` + бэклог-заметка), вместе со всеми действиями по самой задаче: что сделано, что решено, что отложено и почему. Задача не закрыта, пока фронт не замерен, Plane не пересортирован и всё это не записано в Obsidian.

## Работа ведётся ТОЛЬКО через Obsidian + Plane (ОБЯЗАТЕЛЬНО)

Два инструмента и никаких «в голове» или «в переписке»: **Obsidian-vault — журнал и знание, Plane — задачи**. Ниже — не пожелания, а условия сдачи работы.

1. **Каждое действие по проекту записывается в vault.** Сделал правку, поднял/погасил стенд, нашёл дефект, принял решение, отверг вариант, наступил на яму — это строка в соответствующем файле: ход работы и итог → `<Модуль>/Changelog.md`, состояние модуля → `Status.md`, решение и его причина → `Decisions.md`, найденный дефект и обходной путь → `Known-Issues.md`, сырьё → `RAW/`, разбор → `WIKI/`. Не записано — считай, не сделано: следующая сессия начинается с чтения vault, а не с расспросов.
2. **Каждая поставленная задача заводится в Plane — даже мелкая.** «Поправить подпись», «перезапустить стенд после прогона», «проверить пароль» — всё это карточки. Задача, которой нет в Plane, не существует: она теряется на переключении контекста. Работа над задачей, заведённой в обход трекера, начинается с её заведения:
   ```bash
   python3 /home/erda/plane/migration/plane_task.py add "Smart Josparlau" "Название" --desc "зачем" --state Backlog
   ```
   Команда идемпотентна по имени — повтор дубль не создаёт. `--state Backlog` — только для того, что пришло от заказчика; всё, что придумал сам, идёт в `--state "Предложено Claude"` (см. п. 8 выше).
3. **План (в том числе рождённый через superpowers) идёт В ОБА места.** Сам план — заметкой в `obsidian-vault/WIKI/` (целиком, с рассуждением и отвергнутыми вариантами); его шаги — задачами в Plane, по одной на шаг:
   ```bash
   python3 /home/erda/plane/migration/plane_task.py plan "Smart Josparlau" obsidian-vault/WIKI/<план>.md
   ```
   Шагом считается строка списка верхнего уровня, вложенные строки уезжают в описание своего шага. План, который живёт только в ответе чата, — потерянный план: чат обрывается, vault и трекер остаются.
4. **Порядок записи — по ходу дела, не «потом одним махом».** Статус в Plane переводится в момент перехода (см. раздел выше), запись в vault делается в том же заходе, что и сама работа. Пакетная дозапись в конце сессии теряет причины: остаётся «что», пропадает «почему».
5. **Расхождение между vault, Plane и кодом — дефект работы.** Чинится сразу; если инструмент недоступен (стек не поднят, API молчит) — расхождение записывается таблицей в бэклог-заметку и доводится, когда доступ вернётся.

## Непрерывный цикл: не останавливаться, пока в Plane есть задачи (ОБЯЗАТЕЛЬНО)

Закрытая задача — не конец работы, а точка перехода к следующей. Останавливаться и ждать нового указания заказчика НЕЛЬЗЯ, пока очередь не пуста.

1. **Закрыл задачу → сразу открыл список.** После записи в vault и пересортировки Plane (§ Plane, п. 9) — `plane_task.py list "Smart Josparlau" --open`. Есть незакрытые — берётся следующая по приоритету и переводится в `In Progress`. Ответ заказчику пишется по ходу, а не вместо работы: отчитался о закрытой задаче — и в том же заходе взялся за следующую.
2. **Порядок выбора — не «сверху вниз по списку», а по смыслу.** Перед взятием следующей ранжировать очередь: сначала то, что блокирует остальные (модель/контракт, от которого зависят экраны), затем дефекты живого стенда, затем задачи заказчика по их логическому порядку в сценарии, затем собственные находки из `Предложено Claude` (и только те, что заказчик разрешил). Смежные задачи, живущие в одном файле/экране, делать подряд — переключение контекста дороже самой правки. Ранжирование — строкой в бэклог-заметку vault: почему именно этот порядок.
3. **Останов допустим ровно в четырёх случаях:** очередь пуста; задача требует решения заказчика (вилка, которую нельзя закрыть допущением); доступ к нужному инструменту потерян (стек не поднят и не поднимается); заказчик прервал сам. Во всех четырёх — сказать прямо, что именно остановило, и что уже сделано.
4. **«Задач нет» — тоже вывод, требующий проверки.** Пустая очередь означает: прогнать полный тест проекта (см. § ниже), разобрать найденное в карточки `Предложено Claude`, и только потом отчитаться заказчику, что работа встала и ждёт его решений.

## Каждая закрытая задача — коммит и пуш (ОБЯЗАТЕЛЬНО)

Работа, лежащая незакоммиченной, потеряна: её сносит переключение веток, чужая правка и любой сбой машины. Поэтому **закрытие карточки Plane включает коммит и отправку на `origin`** — наравне с записью в vault, замером памяти фронта и пересортировкой трекера. Не «когда накопится», не «в конце сессии», не «после нескольких задач».

1. **Порядок шагов закрытия:** код готов и проверен → запись в vault → `git add` нужных файлов → `git commit` → `git push` → перевод карточки в `Done` → хэш коммита дописывается в строку `Changelog.md`. Хэш ставится ПОСЛЕДНИМ шагом: записанный до коммита, он устаревает при любом `--amend`.
2. **Коммитить относящееся к задаче, а не всё дерево.** `git add -A` и `git commit -a` запрещены: в дереве постоянно лежит мусор и тяжёлые каталоги (`frontend/` с зависимостями — сотни МБ, прототипные выгрузки, временные снимки `.shot-tmp*`). Файлы перечисляются явно; перед коммитом — `git status --short` и `git diff --cached --stat` глазами.
3. **Одна задача — один коммит.** Сообщение в принятом формате (`feat(events): …`, `fix(ops): …`, `chore(stand): …`) с указанием карточки Plane. Правки, родившиеся попутно и к задаче не относящиеся, идут отдельным коммитом, а не прицепом.
4. **Пуш обязателен и проверяется выводом.** `git push` (первый раз на новой ветке — `git push -u origin <ветка>`), затем `git status -sb` должен показать ветку в ноль относительно `origin`. «Запушил» без вывода команды — не факт, а обещание.
5. **Ветка `main` не принимает прямых коммитов.** Работа идёт в тематической ветке; если оказался на `main` — сначала `git switch -c <ветка>`.
6. **Секреты не уезжают.** Перед пушем — проверить, что в индексе нет паролей, ключей и `.env` (пароль стенда живёт в `~/.config/vaps/`, не в репозитории).
7. **Отказ пуша — это блокер задачи, а не мелочь.** Не отвечает сеть, отвергнут по правам, разошлись истории — карточка не переводится в `Done`, причина пишется в vault, и разбирается она до взятия следующей задачи.

## Полный прогон работоспособности — по глубине правок, а не по часам (ОБЯЗАТЕЛЬНО)

Время от времени проект проверяется ЦЕЛИКОМ — а не только то, что трогали последней задачей. Цель — ловить не свои регрессии, а состояние системы: чужие правки, протухшие фикстуры, отвалившиеся эндпоинты, раздувшийся стенд.

**Решение о прогоне принимается по глубине правки, а не по таймеру** (заказчик: «условно просто перекрасить кнопку — нет необходимости гонять весь функционал»). Судить по тому, что задача реально затронула:

| Что затронула задача | Что гонять |
| --- | --- |
| Модели, миграции, схема БД, индексы/ограничения | **полный прогон** |
| Контракт API: новый/изменённый эндпоинт, поле, код ошибки, права | **полный прогон** |
| Бизнес-логика, сервисы, расчёты, переходы состояний, сигналы | **полный прогон** |
| Архитектура: перенос слоёв, общие хуки/провайдеры, роутинг, авторизация | **полный прогон** |
| Общий компонент/токен дизайн-системы, который читают много экранов | **полный прогон** |
| Цвет, отступ, подпись, иконка, порядок в ОДНОМ месте | целевые пробы + `tsc`, полного прогона не нужно |
| Правка текста в доке, комментарий, запись в vault | ничего не гонять |

Сомневаешься, куда попала задача, — считай её глубокой и гони полный прогон: пропущенная регрессия дороже лишних десяти минут.

**Независимо от глубины правок, полный прогон обязателен:** перед тем как отчитаться о пустой очереди; после длинной череды мелких задач, накопившейся без единой полной проверки (порядка пяти-семи подряд — счёт держать по леджеру); после любого перезапуска или пересборки стенда; когда что-то повело себя странно без явной причины. Календарный интервал жёстко не задан: раз в пару часов активной работы — разумный ориентир, но решает содержание сделанного, а не часы.

Что входит в прогон:

1. **Бэкенд, весь.** `pytest` по всем приложениям `organization_management/apps`, не по затронутым. Отдельно — обход API: каждый эндпоинт схемы должен отвечать (не 5xx, не 404 на живом маршруте), включая те, которые никто не менял. Схема — источник списка (`schema.yaml`/`/api/schema/`), а не память.
2. **Фронтенд, весь.** `tsc` + ПОЛНЫЙ `playwright.smoke.config.ts` (с `SMOKE_LIVE=1` там, где спеки живые — без переменной они молча пропускаются, и скип читается как зелень). Плюс обход экранов кликами: каждый раздел открывается, каждый ключевой сценарий проходится до конца, консоль браузера читается на ошибки.
3. **Связка фронт ↔ бэк.** Экран, который читает эндпоинт, проверяется на ЖИВЫХ данных, а не на моке: мок зелен и тогда, когда сервер отвечает 500.
4. **Память стенда.** Замер `next dev` (§ «Стенд фронтенда») — раздувание тоже дефект работоспособности.
5. **Инструмент выбирается по задаче, не по привычке.** Playwright, pytest, curl по схеме, скилл `webapp-testing`, `project-sentinel` для полного аудита, `/code-review` — что даёт результат быстрее и полнее, тем и пользоваться. Единственное требование: результат должен быть ВИДЕН выводом команды, а не «проверено».

Что делается с результатом:

6. **Каждая найденная ошибка — карточка Plane в `Предложено Claude`**, поимённо: что сломано, где (файл/эндпоинт/экран), как воспроизвести, чем грозит. Одна ошибка — одна карточка; «поправить всё найденное» карточкой не считается.
7. **После разбора — пересортировать всю очередь** по значимости и по логике (см. § выше, п. 2): сломанное на живом стенде обгоняет новые фичи, блокирующее обгоняет косметику, смежное собирается в один заход.
8. **Взять следующую задачу и продолжить.** Прогон — не остановка работы, а её часть.
9. **Результат прогона — записью в vault** (`<Модуль>/Changelog.md`): дата, что гонялось, чем, какие числа (сколько тестов, сколько прошло), что найдено, какие карточки заведены. Зелёный прогон записывается тоже — «ничего не найдено» это факт о состоянии системы, а не пустота.

## Задача делается ЦЕЛИКОМ: фронт + бэк + сквозная связность (ОБЯЗАТЕЛЬНО)

Любая задача заказчика реализуется сразу на обеих сторонах — фронтенд И бэкенд, — а не «сначала экран, потом когда-нибудь модель». Если требование упирается в модель или API, меняется модель и API; заглушка на клиенте вместо серверного факта — не выполнение задачи, а долг.

Реализованное обязано быть согласовано со ВСЕМ существующим функционалом. Сломать соседнее место, закрывая своё, — это провал задачи, а не «побочный эффект»:

1. **До кода — обойти зависимости.** Грепом найти всех, кто читает изменяемое поле/эндпоинт/компонент (карточка, реестры, сводки, отчёты, экспорт, мок-слой, e2e-пины) и решить, что с каждым из них будет. Список зависимостей и решение по ним — в `Decisions.md`.
2. **Расширять, а не подменять.** Пока старый источник данных кто-то читает, он остаётся жить (новое поле/таблица добавляется рядом, старое снимается отдельным шагом после переезда всех читателей). Данные существующих строк переносит миграция с бэкфиллом — новая сущность не должна быть пустой у того, что уже заведено.
3. **Контракт правится с двух концов одновременно.** Поле, добавленное серверу, в тот же заход появляется в типах клиента и в мок-слое; иначе сборка/тесты зелены на одной стороне и врут про другую.
4. **После кода — прогнать ВЕСЬ гейт, а не свои тесты.** Бэк: `pytest` по затронутым приложениям целиком. Фронт: `tsc` + полный `playwright.smoke.config.ts`, а не один спек. Падение соседнего теста — часть твоей задачи; пины канон-строк (состав колонок, подписи) правятся осознанно и с объяснением в комментарии, а не подгоном под новый вывод.
5. **Проверить глазами то, что изменил.** Снимок экрана на стенде — обязателен для UI-правок: сбитая вёрстка и выдуманные числа видны на картинке и невидимы для ассертов «текст на месте».
6. **Красная проба на каждый новый сторож.** Тест обязан падать на мутации, которую он стережёт, иначе он вакуумный.

## Фронтенд — только через `/ui-ux-pro-max` (ОБЯЗАТЕЛЬНО)

Любая работа с фронтендом (`Backend/PersonnelStatus/PersonalRecordFront`, `frontend/`) ведётся через скилл **`/ui-ux-pro-max`** — он вызывается ДО правки разметки, стилей, компонентов и состояний экрана, а не после.

- Правило распространяется на всё, что меняет вид, ощущение, движение или способ взаимодействия: новые экраны и компоненты, рефакторинг UI, цвет/типографика/отступы/сетка, состояния загрузки/ошибки/пустоты, навигация, анимация, адаптивность, доступность.
- Скилл не отменяет канон проекта: прототип Smart Жоспарлау и `obsidian-vault/Продукт/` остаются источником формы, а `Frontend/Decisions.md` — источником принятых отклонений. Результаты поиска скилла — рекомендации; при конфликте с эталоном или решением заказчика побеждает эталон, а расхождение записывается в `Decisions.md`.
- Чисто серверная работа (модели, миграции, сервисы, API без изменения экрана) скилла не требует.

## Стенд фронтенда: следить за памятью `next dev` (ОБЯЗАТЕЛЬНО)

`next dev` (PersonalRecordFront, :3106) течёт: за долгую сессию RSS уползает в гигабайты, процесс начинает рвать соединения и съедает оперативку машины. Это не гипотеза, а повторяющаяся яма — падения вида `CLIENT_FETCH_ERROR` / обрывы на `/api/auth/csrf/` в 9 случаях из 10 означают раздувшийся dev-сервер, а не дефект кода.

Обязанности:

1. **Мерить ПОСЛЕ КАЖДОЙ ЗАКОНЧЕННОЙ ЗАДАЧИ — обязательно, а не «регулярно».** Замер входит в закрытие карточки наравне с прогоном тестов и пересортировкой Plane: задача не закрыта, пока RSS фронта не замерен и цифра не записана в vault. Плюс перед прогоном e2e и обходом стенда:
   ```bash
   ps -o pid,rss,etime,cmd -C node --sort=-rss | head
   ```
   RSS в килобайтах. Норма свежего `next dev` — сотни МБ.
2. **Порог — 2 ГБ RSS (≈2000000).** Перешагнул — гасить и поднимать заново, не дожидаясь странных падений. Гасить **по PID**, не `pkill -f` (паттерн убивает собственный шелл).
3. **Обрывы соединений сначала списывать на память.** Увидел `ECONNRESET`/`fetch failed`/красноту на аутентификации — сперва замерить RSS и перезапустить стенд, и только если после чистого перезапуска повторилось — заводить дефект.
4. **Один `next dev` на машину.** Два сервера делят `.next` и травят сборку друг друга; проба «на соседнем порту» ломает основной стенд. Нужна параллельная сборка — `NEXT_DIST_DIR=.next-build`.
5. **Не оставлять стенд поднятым после работы.** Закончил проверку — погасить процесс. Забытый на ночь `next dev` к утру занимает всю память.
6. **Каждый перезапуск и замер — строкой в vault** (`Frontend/Changelog.md`), с цифрой RSS. Повторяющееся раздувание раньше срока — карточка в `Предложено Claude`, а не молчаливый ежечасный рестарт.

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
