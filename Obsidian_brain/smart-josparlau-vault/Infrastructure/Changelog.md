---
title: Infrastructure — Changelog
module: infrastructure
updated: 2026-08-19
tags: [infra, changelog]
---

# Infrastructure — Changelog

## 10.09.2026 — промпт для подготовки тестового прода в закрытом контуре

По просьбе заказчика составлен промпт для отдельной сессии: офлайн-бандл (шрифты `next/font/google` → локальные, Sentry без DSN, `docker save`, хардкод `10.15.3.187` → env), админка и чистый bootstrap справочников, основной сценарий проходки ОМ под учётками `acc_*`, три экрана по виду (Матрица календаря, Обратная связь, объект посещения в мероприятии), рунбук по образцу `deploy/spike-1.9`. Редакция 2 того же дня по слову заказчика: добавлены блоки аутентификации/авторизации и учёток, паритет «сайт ↔ админка», сортировка админки по значимости с пустым «Прочее», проверка ТОЛЬКО через браузер по карте кликов (pytest и e2e из гейта сняты), адресат — Кодекс Астра 6. Редакция 3: в блок по виду добавлен модуль «Сбор сил на ОМ» (`app/employees/page.tsx`, два этажа вкладок → один). Текст — [[../WIKI/Промпт-тестовый-прод-закрытый-контур]]. Карточка в Plane заводится той сессией, что возьмёт промпт в работу; код не менялся.

## 2026-09-10 — локальный контур фронт + бэк переподнят, Plane №380

Исполнитель: Кодекс Астра 6.

По прямой команде заказчика целевые порты `:8100` и `:3106` проверены и были свободны, поэтому выполнен чистый запуск без остановки соседних стендов. Бэк поднят из канонического каталога с локальными PostgreSQL-настройками, фронт — через штатный `dev:guard`; соседние `:8102`, `:3108`, `:3110` оставлены как есть. Проверка: бэк `GET /api/schema/` → `HTTP 200`, фронт `GET /` → `HTTP 200`; RSS целевого `next-server` `821264 КБ`, RSS бэка `125928 КБ`, оба в допустимых пределах.

Карточка Plane №380 уже была в `On test`, статус не менялся. Изменений кода нет, коммит и push не выполнялись. Исполнитель: Кодекс Астра 6.

Контрольный замер через 2 минуты после запуска: RSS `next-server` `1846576 КБ`, ниже лимита `2500000 КБ`; `dev:guard` продолжает наблюдение. Исполнитель: Кодекс Астра 6.

## 09.09.2026 — №1067: локальный контур полностью перезапущен

Исполнитель: Кодекс Астра 6.

## 10.09.2026 — локальная integration-ветка №1116

Исполнитель: Кодекс Астра 6.

Из `main@a3303cf3` создан изолированный `/tmp/sj-integration-1116` (`codex/integration-1116`). В него последовательно перенесены проверенные коммиты шести карточек: №828, №1015, №1069, №1017, №1079, №1118. Конфликт №1015/№1069 разрешён вручную с сохранением protected storage и точной семантики fallback; `git diff --check` чист. `main` и активные соседние worktree не изменялись. Публикация и merge отложены до единой браузерной приёмки и явного разрешения внешней отправки в GitHub.

## 10.09.2026 — Plane №1079: повторная browser acceptance после review-fix

Исполнитель: Кодекс Астра 6.

Review-fix `398ae6248cf977e815fa9ac909c809a45808e874` подтверждён независимым повторным ревью: production-зависимости теперь устанавливаются из committed `package-lock.json` через `npm ci`, fresh-разрешение `/sharp` удалено, `sharp=0.35.4` сохранён. Production frontend на `:3108` и Django на `:8100` прошли живую браузерную проверку `service-summary.spec.ts` под двумя не-административными ролями: `role_duty_officer` открыл своё рабочее место, `role_division_operator` получил ожидаемый понятный отказ. Видимый итог: `1 passed (4.5s)`. RSS `next-server` после прогона — `144420 КБ`; git worktree чист.

Карточка остаётся `In Progress`, потому что новый commit ещё не опубликован. Автоматическая проверка отклонила push без явного подтверждения конкретного GitHub destination/payload; обход не применяется. После явного разрешения требуется push `codex/1079-review-fix`, запись SHA и перевод в `Review`.

По прямому поручению заказчика остановлен только соседний mock/dev Smart Josparlau на :3107 (PID 1417953/1417954/1417965); процессы пользовательского проекта вне этого контура не затрагивались. Plane self-host перезапущен через штатный compose; Django из канонического каталога поднят на :8100 с локальными PostgreSQL-настройками, потому что production settings корректно отказались стартовать без `DJANGO_SECRET_KEY`; Next.js после `npm ci --prefer-offline --no-audit --no-fund` (815 пакетов) поднят на :3106. Проверка: frontend `GET /` — 200, backend `GET /api/schema/` — 200, Plane `GET /` — 200. Порты: :3106 PID 1417203, RSS 639268 КБ; :8100 PID 1415387, RSS 121076 КБ; :8090 слушает Docker proxy. RSS фронтенда ниже порога 2500000 КБ. Изменений кода и коммита нет.

## 09.09.2026 — №1062: три рабочих каталога сведены в один

Исполнитель: Кодекс Астра 6.

Итоговый `main` **a3303cf37c285bf4d1bcc640dcedc6502743c375** опубликован; `git ls-remote origin refs/heads/main` вернул тот же SHA, `git status -sb` чист. В нём `81b3a0e4` (дерево всех проходок, включая №1049/№982), `a942649d` (№1043) и `a3303cf3` (уникальные Superpowers-only правила). Backend `core + ops + operations`: **5136 passed,9 warnings,433.02s**. Frontend `npm run gate:front`: TypeScript/rewrites/check:shots/neighbours и production build **39/39**. `makemigrations --check --dry-run` с local_postgres: **No changes detected**. Первый вызов без settings дошёл до ожидаемого отказа production-конфига о DJANGO_SECRET_KEY; секрет не выводился.

Штатно, без `--force`, сняты worktree `/home/erda/Музыка/Smart-Josparlau-codex-982`, `/home/erda/Музыка/Smart-Josparlau-codex-queue` и `/tmp/sj-squash-1052`; `git worktree list` теперь содержит только `/home/erda/Музыка/Smart Josparlau`. Мerged локальные ветки №1043/№1062/squash удалены обычным `git branch -d`. Страховочные `3fdaddc5`/`3eb07a82` оставлены ветками: это восстановление старых частичных состояний, не дополнительные каталоги. Frontend dependencies852МБ перенесены из №1043 в основной каталог, их `tsc` исполним; smoke-снимки сохранены в `smoke-results/worktree-982` и `smoke-results/1062-consolidated-artifacts`. Сгенерированные кэши вынесены в `/tmp/sj1062-generated-cache`, кодом не являются и могут быть восстановлены до очистки `/tmp`.

Старый dev из удалённого пути остановлен строго сторож→сервер и поднят из основного каталога на :3106. `GET /` →200, cwd PID1121875 — основной `PersonalRecordFront`, RSS **783356 КБ** на первом замере; поздний контрольный RSS **1452632 КБ** до перезапуска старого процесса, оба ниже2500000. Повторная файловая проверка показывает один видимый каталог проекта. Полный smoke не повторялся: его известные внешние отказы уже разнесены в №1055–1061; интеграционный backend/frontend gate зелёный.

## 09.09.2026 — №1062: интеграционное дерево собрано, frontend green

Исполнитель: Кодекс Астра 6.

Доказано: `ebc61a3e` (старый основной checkout), №1049 `3040dbb3` и №982 `557ff464` являются предками исходного `343e0909`; дерево squash `81b3a0e4` побайтно совпадает с `343e0909`. Поэтому старые dirty-наборы не накладываются повторно. Созданы страховочные коммиты `3fdaddc5` и `3eb07a82`; они сохраняются до конца, но являются старыми/частичными проекциями уже вошедшего кода. Уникальная №1043 fast-forward добавлена в main как `a942649d`; уникальные Superpowers-only правила перенесены отдельным `a3303cf3` через тематическую ветку. Наличие ранее замеченного N+1 проверено: squash уже содержит `prefetch_related_objects(visits, "security_object", "deputies", "document_versions")`, uncached-путь и два теста, новая правка не нужна.

Первый запуск гейтов во временном worktree не стартовал: отсутствовали локальные `.venv` и `node_modules`; второй frontend запуск дошёл до сборки, но без `.env.local` остановился на обязательном `NEXTAUTH_SECRET`. Содержимое секрета не выводилось. После подключения существующих игнорируемых зависимостей/env из №1043 полный `npm run gate:front` прошёл: rewrites16, check:shots, neighbours, production build **39/39** со страницей `/service-employees`. Backend `core + ops + operations` выполняется под pytest-lock.

## 09.09.2026 — №1062: начата консолидация рабочих деревьев

Исполнитель: Кодекс Астра 6.

Инвентаризация: основной `/home/erda/Музыка/Smart Josparlau` (`feat/frontend-battle-modules`,26 tracked+17 untracked); `/home/erda/Музыка/Smart-Josparlau-codex-queue` (`codex/core-walkthroughs-20260908`,19 tracked+146 untracked); `/home/erda/Музыка/Smart-Josparlau-codex-982` (`codex/service-employees-1043`, чист, коммит a942649d); временный `/tmp/sj-squash-1052` (`81b3a0e4`, чист). Причина трёх папок — параллельные Git worktree одного репозитория, а не три независимых проекта. До объединения и push ничего не удаляется.

## 08.09.2026 — приоритетный переход: пять инфраструктурных находок из «Предложено Claude», не мешающих основной проходке

Заказчик прямым словом (чат, не Plane) остановил ревью №825 и попросил приоритет на основную проходку ОМ и ежедневного расхода — её ведёт Кодекс Астра 6 (Plane №1045). Поручение: взять из бэклога то, что НЕ мешает его работе. Backlog-колонка Plane целиком занята той же проходкой (№977-№992, №1043, №1046) или ждёт решения заказчика (№942); свободных для взятия карточек в ней не нашлось. Вместо этого взято пять инфраструктурных находок из «Предложено Claude» — вне `organization_management/apps/ops`/`apps/operations` и вне фронтового раздела ОМ, то есть без пересечения по файлам. Исполнитель: Claude Code (Sonnet 5).

- **№871 — `git gc` заблокирован.** `.git/gc.log` с предупреждением «833 висячих коммита» удалён (вариант «б» из трёх, предложенных самой карточкой как самый дешёвый и безопасный — автоматический `gc` сам щадит объекты младше `gc.pruneExpire` по умолчанию, историю руками не трогал). После коммита предупреждение появилось СНОВА — ожидаемо: авто-`gc` перезапустился и заново нашёл те же дальние висячие коммиты (часть — легитимные, от приёма приватного индекса по №807), это не регресс, а его штатное поведение до истечения двухнедельного срока или разовой ручной уборки при одной живой сессии.
- **№876 — устаревшая запись в общем git-индексе.** Техническая находка (12 файлов с индексом старше HEAD, выдававших ложный `MM`) на HEAD уже не воспроизводится — `git diff --cached --stat` пуст, index==HEAD. Осталась только процессная часть: в CLAUDE.md добавлено, что занятость файла проверяется `git diff HEAD -- <файл>`, а не `git status`.
- **№919 — фоновой pytest молча снимается по памяти.** Задокументирован замер 06.09.2026: тяжёлый прогон, дважды снятый фоном без единой строки вывода, в переднем плане на ТОЙ ЖЕ свободной памяти прошёл целиком — правило в CLAUDE.md: apps/ops(+operations) при малой свободной памяти гонять в переднем плане.
- **№1009 — `plane_task.py add` не выставлял приоритет.** Добавлен флаг `--priority` (urgent/high/medium/low/none, с отбоем неизвестного значения) и колонка приоритета в `list` (печатается только когда не `none`). Проверено живым вызовом API: карточка заведена с `--priority high`, `list` показал `(high)`, невалидное значение отбито до сетевого вызова; тестовая карточка снята (`Cancelled`). Правило про P0/P1 → `--priority urgent/high` добавлено в CLAUDE.md.
- **№968 — stop-hook указывал на снятый каталог.** `.claude/settings.json` нёс путь `/home/erda/Музыка/VAPS/...` (проект переехал 28.08.2026); переведён на текущий `/home/erda/Музыка/Smart Josparlau/...`. Проверено прямым запуском команды — exit 0.

Пропущено намеренно: №828 (ставить ли `token_blacklist`) и №885 (правка пункта про ppid) — обе карточки сами себя помечают как требующие слова заказчика (цена/компромисс у №828, уже принятое решение №836 корректируется у №885), а не техническую находку. №993 (MSW `onUnhandledRequest`) отложена — фронтовый `node_modules` был пуст на живом стенде (см. ниже), гейт недоступен до переустановки.

## 10.09.2026 — Plane №828 взята в работу

Исполнитель: Кодекс Астра 6.

Карточка №828 (`170a6dd9-21e8-4f2a-8839-162c8646ab55`) переведена в `In Progress` перед первой правкой. Причина: настройки включают ротацию refresh-токенов и обещают отзыв старого токена, но `rest_framework_simplejwt.token_blacklist` отсутствует в `INSTALLED_APPS`, поэтому поведение нужно подтвердить и исправить безопасно. Работа ведётся в отдельной ветке `codex/828-token-blacklist`; требование приёмки — живой браузерный сценарий под не-административной учёткой: вход, обновление, выход и отказ обновления отозванным токеном. Секреты в записи не фиксируются.

### Результат №828

Исполнитель: Кодекс Астра 6.

- RED: новая регрессионная проба сначала получила `200` при повторной отправке старого refresh; это подтвердило корень дефекта.
- Код: в `INSTALLED_APPS` добавлен `rest_framework_simplejwt.token_blacklist`, `BLACKLIST_AFTER_ROTATION` включён; комментарии бэкенда и клиента приведены к фактической ротации с отзывом. Клиент уже сохранял новый refresh, дополнительных изменений логики не потребовалось.
- Стенд: штатные миграции `token_blacklist.0001`–`0013` применены к локальной PostgreSQL без ошибок; таблицы `OutstandingToken`/`BlacklistedToken` созданы.
- Pytest: `bash scripts/pytest-lock.sh ... pytest organization_management/apps/common/tests/test_token_refresh_rotates.py -q` → `4 passed in 9.19s`.
- Финальный `npm run gate:front` с локальным `NEXTAUTH_SECRET` → TypeScript, rewrites, снимки, neighbours и production build зелёные; сборка сгенерировала `39/39` страниц. Первый запуск без секрета остановился штатной защитой конфигурации, значение не выводилось.
- Финальный RSS-замер по правилу `next-server|next dev` после остановки изолированного стенда: процессов нет (`ps ... | grep ...` не вернул строк); общий живой стенд не затрагивался.
- Временный `node_modules` worktree и generated `.next-build*` удалены; `pnpm-lock.yaml` восстановлен к `HEAD`, в коммит не попадёт.
- Коммит: `316ec6e3` (`fix(auth): blacklist rotated refresh tokens (Plane №828)`). В коммит вошли только четыре тематических файла; vault остаётся внешним вторым мозгом.
- Browser acceptance на изолированных `Next :3109`/`Django :8101`, Chromium из локального кэша, persona `role_ops_reader` (`is_staff=false`): `BROWSER_ACCEPTANCE 1 login=200 dashboard=visible first_refresh=200 old_refresh=401 new_refresh=200 logout=session-empty`. Пароли и JWT в журнал не записывались.
- Исторический `observer` оставлен без изменений: защищённый `role-accounts-password` не совпадает с ним (`check_password=False`); acceptance выполнен на существующей не-административной `role_ops_reader` (`check_password=True`).

**Побочная находка при взятии: `node_modules` пуст на живом стенде `:3106`.** Дев-сервер крутился в цикле падений (`Cannot find module .../jest-worker/processChild.js`, `@swc/helpers/package.json` и т.д.) — сам каталог `node_modules` в основной рабочей копии оказался ПУСТ (0 записей), при этом ни один `npm`-процесс в этой директории не был запущен (в соседнем ворктри `Smart-Josparlau-codex-queue` шёл свой независимый `npm ci`, не связан). Это блокировало не только меня, но и браузерную проходку Кодекса — запущен `npm ci` в основной директории. Прогон занял 16 минут (815 пакетов), сторож `dev-guard.sh` сам поднял сервер по завершении установки — `GET /` вернул 200, компиляция чистая, без ручного вмешательства в сам сторож.


## 07.09.2026 — завершение полного аудита Plane №770

Исполнитель: Кодекс Астра 6.

- Сверены документация, все состояния Plane и committed-код. Финальный срез до закрытия №770: 957 карточек; 13 находок заведены отдельно в `Предложено Claude` (№953–963, №965–966), не взяты в работу.
- Без удаления перенесены в Archive 38 исторических/заменённых файлов; пять продуктовых заметок заменены короткими актуальными навигационными версиями. Манифест: [[../WIKI/Аудит-2026-09-07/evidence/archive-manifest]].
- Сформирован полный Project Sentinel-комплект Markdown/HTML/JSON/SARIF/JUnit: [[../WIKI/Аудит-2026-09-07/report]]. Репозиторий Кодексом Астра 6 не изменялся, коммита аудита нет; связь держится Plane №770 и этой записью.

## 05.09.2026 — Plane №770: подготовка строго к ревью

Исполнитель: Кодекс Астра 6.

- Принято поручение прочитать документацию проекта в Obsidian. Главный источник требований по текущему слову заказчика — `RAW/README.md`; роль Кодекс Астра 6 — строго ревью, без реализации исправлений кода Claude Code.
- Инвентаризированы 386 текстовых документов (13434254 байта, 89456 строк); начато полное чтение. Историческая иерархия в `00-Index.md` расходится с новым указанием заказчика; приоритет для ревью задаётся новым указанием. Чтение продолжается, результат и покрытие — [[../Archive/documentation-refactor-2026-09-08/Ревью-2026-09-05/00-Контекст-ревью|архивный срез ревью 05.09]].

## 05.09.2026 — Plane №769: строгие правила AGENTS.md

Исполнитель: Кодекс Астра 6.

- По поручению заказчика добавлен обязательный блок в начале AGENTS.md: второй мозг `/home/erda/Музыка/Obsidian_brain/`, фиксация всей документации и работ в vault проекта, подпись исполнителя, запуск очереди Plane по команде и непрерывное выполнение до исчерпания разрешённых задач.
- Согласованы прежние разделы: ожидание Review касается отдельной карточки, а не всей очереди; отсутствие задач проверяется по всей выдаче Plane, блокер одной задачи не останавливает независимые. Решение и его границы: [[Decisions]]. Карточка №769 переведена Backlog → In Progress перед правкой.
- Исходный AGENTS.md сохранён для сравнения в `/tmp/smart-josparlau-agents-6BN4by/AGENTS.before.md`. Дифф с исходным файлом просмотрен; `rg` подтвердил все новые правила и записи в vault, `git diff --cached --check` — код 0. Для документации гейт приложения не требуется по AGENTS.md. Файл прежде не отслеживался Git, поэтому в индекс вошёл весь существующий документ с точечными дополнениями (580 строк); сторонние правки приложения исключены.
- RSS next-server PID 272653: 2043068 КБ, ниже порога 2500000 КБ, перезапуск не требуется.
- Коммит `d99900a1` опубликован в `origin/feat/frontend-battle-modules`; `git status -sb` подтвердил отсутствие ahead/behind. Карточка №769 → Review, комментарий «было/стало» подписан `Исполнитель: Кодекс Астра 6`; повторный `list --open` подтвердил Review. On test/Done не выставлялись. Поручение изменить правила выполнено; запуск очереди разработки ждёт команды заказчика.

## 05.09.2026 — Plane №768: устаревший Stop-хук Codex

- Запрос заказчика: «что за хуки? исправь». Карточка №768 (`a26789ac-e671-48ea-9570-c2145b3d7c75`) заведена в Backlog и переведена в In Progress до правки.
- Причина воспроизведена: `.codex/hooks.json` запускал `bmad-story-automator stop-hook` с `PROJECT_ROOT=/home/erda/Музыка/VAPS`; каталог отсутствует, команда завершается с кодом 127 (`No such file or directory`).
- Снята только эта регистрация: конфигурация проекта теперь содержит `"hooks": {}`. Путь не заменён на новый, поскольку стори-цикл BMAD заморожен по AGENTS.md с 10.08.2026. Сам автоматизатор и AGENTS.md сохранены. Читатель конфигурации — Codex; исходники фронта и бэка не затронуты.
- Проверка Python: `PASS: valid JSON; project hooks: 0; stale VAPS path absent`, код 0. До правки команда хука давала 127. Проверяется конфигурация на диске; повторное событие Stop в самом Codex возможно после завершения ответа. Сборка приложения и pytest для этой правки не требуются.
- Отдельно при диагностике повторилась ошибка песочницы `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`; команды выполнялись с разрешённым запуском вне песочницы. Этой правкой сбой bwrap не исправляется.
- RSS next-server PID 272653: 564592 КБ, ниже порога 2500000 КБ. Стенд не перезапускался.
- Коммит `15c5bd2d` (`fix(codex): remove obsolete BMAD stop hook (Plane #768)`) запушен в `origin/feat/frontend-battle-modules`; `git status -sb` без ahead/behind. В коммите только `.codex/hooks.json`, сторонние правки не затронуты.
- Карточка №768 переведена в Review, добавлен комментарий «было/стало» для ручной проверки в Codex. Повторный `list --open` подтвердил Review. On test/Done не выставлялись. В рамках этого прямого запроса следующая задача не выбиралась; посторонние карточки и изменения принадлежат параллельным сессиям.

_Одна строка на коммит: дата, короткий хэш, сообщение. Сгенерировано скриптом из git log, дополняется вручную по ходу будущей работы._

## История (git log)

- 2026-05-31 `664a04c6` Initial commit
- 2026-06-01 `7577182f` Add VAPS project: backend modules, BMAD/WDS tooling, docs and graphify graph
- 2026-06-02 `9cf3815e` Update README.md
- 2026-06-02 `baad1f7e` docs: add technical audit report based on VAPS v7.8.2
- 2026-06-02 `a3b9e3d9` Delete ПланРасстановка.docx
- 2026-06-02 `dc68bcf1` docs: update technical audit report with prioritized execution plan
- 2026-06-05 `49b4d32a` docs: generate architecture dependency map
- 2026-06-05 `a206eb5a` feat(auth): introduce centralized PermissionService for RBAC
- 2026-06-07 `fe2a9730` Add RECONCILIATION.md: single source of truth across VAPS docs
- 2026-06-07 `1fa238a1` docs: add core context foundation implementation plan
- 2026-06-07 `fc306bdd` feat(core): add rich core_employees model with IIN validator and full_name sync (DB-CORE-004, §45.2)
- 2026-06-08 `bcd54cff` docs(operations): add RBAC foundation design spec
- 2026-06-08 `64ced023` docs(operations): add RBAC foundation implementation plan
- 2026-06-08 `246c5f12` docs(epics): add initial-migrations epic (generate missing app migrations)
- 2026-06-08 `fc2d7e22` feat(db): generate initial migrations for local apps (initial-migrations Story 1.1)
- 2026-06-09 `75ee10d8` docs(epics): mark initial-migrations Story 1.1 verified complete
- 2026-06-09 `13ddb4a5` docs(epics): mark initial-migrations Story 4.x done, log new test-cleanup follow-up
- 2026-06-09 `acbea52b` docs(epics): mark Story 6.x done, split out websocket follow-up (Story 7.x)
- 2026-06-09 `bd7b79ef` ci(migrations): add GitHub Actions makemigrations drift gate (Story 3.x)
- 2026-06-09 `d03f064d` docs(plans): add Story 6.x fix-broken-tests implementation plan
- 2026-06-09 `98987106` feat(db): seed dictionaries reference data via migration (Story 2.x)
- 2026-06-10 `462a80c1` chore: stop tracking docs/ and graphify-out/ (local-only)
- 2026-06-10 `44a17fde` deleted docs
- 2026-06-10 `eeea4660` Added description to README.md
- 2026-06-10 `b12603a9` Changed .gitignore
- 2026-06-15 `4ce19ddc` feat(E1): walking skeleton stories 1.1–1.8 + BMAD artifacts + graph
- 2026-06-16 `d849611b` feat(E1): спайк 1.9 — контур-проба, бандл носителя + рунбук (путь B, A5 открыт)
- 2026-06-16 `ec5ac3ad` fix(E1): ревью спайка 1.9 — guard отрицательных счётчиков + install-probe fallback (+ бандл 1.8-hardening)
- 2026-06-16 `3b2485b1` chore(graph): graphify update после ревью спайка 1.9 (AST-only)
- 2026-06-17 `0bd68fb8` feat(E1): спайк 1.10 — перф-грид прототип + инструментация + BUDGET (путь A, замер за Bratan)
- 2026-06-18 `faf52f3d` 1.9 story
- 2026-06-18 `aef97623` docs(E1): спайк 1.9 — финализация ревью пр.6 (RUNBOOK + findings + defer)
- 2026-06-18 `9e424eb0` feat(E1): спайк 1.10 — патчи ревью пр.1 (детектор каскада D1 + BUDGET)
- 2026-06-18 `777610ac` feat(E1): спайк 1.11 — выгрузка донора (рецепт + stdlib-профилировщик + ревью)
- 2026-06-18 `1b65f54f` chore: graphify по необходимости — ослабить CLAUDE.md + убрать PreToolUse-нудж
- 2026-06-21 `ca7343de` 2.2 Story
- 2026-06-21 `ff90c84b` 2.3 story
- 2026-06-22 `21841e08` fix(E1): спайк 1.11 — патч ревью пр.4 (валидация типа поля model)
- 2026-06-22 `68a397ad` fix(E2): стори 2.1 — патч ревью пр.2 (явное ребро DAG миграций)
- 2026-06-22 `d0cb150b` feat(E2): стори 2.4 — списочный состав на дату (версионированный знаменатель)
- 2026-06-22 `da365d77` feat(E2): стори 2.5 — сервис увольнения (сервис-слой)
- 2026-06-22 `be2db041` chore(bmad): трекинг сессии + graphify (E2: 2.4 done, 2.5 done)
- 2026-06-22 `b304ba29` feat(E2): стори 2.6 — канон сортировки списков (FR-5)
- 2026-06-22 `40c7a6f6` chore(E2): gate+round-trip — стори 2.1/2.2/2.3 → done
- 2026-06-23 `c3ce5d3b` feat(E2): стори 2.7 — импорт справочников должностей/званий из CSV (FR-39)
- 2026-06-23 `66585685` feat(E2): стори 2.8 — Django-auth-совместимость User (фундамент Admin)
- 2026-06-23 `c5779d92` 2.8 story
- 2026-06-25 `edc922ef` 3.1-3.6 stories
- 2026-06-25 `ba735d61` 3.7-3.10 stories
- 2026-06-25 `9294d0a7` feat(E3): стори 3.11 — секондмент-возврат (FR-15) + DETACHED read-only (FR-16); ревью 3.10→done
- 2026-06-26 `7d6ce75e` feat(E3): стори 3.12 — движок catch-up материализации эффектов (FR-41 ядро)
- 2026-06-26 `c014b70f` test(E3): стори 3.14 — сервис-уровневый конкурентный смоук статусов
- 2026-06-26 `cd183653` docs(E3): спайк 3.13 — часы без NTP (FINDINGS + RUNBOOK админа)
- 2026-06-26 `e25112d2` fix(E1): спайк 1.11 — патчи ревью пр.5 (natural-key guard, mask, отчёт)
- 2026-06-26 `20a4e8a2` test(E3): стори 3.14 — патчи code-review (docstring + ассерт pk победителя)
- 2026-06-26 `4bdea8e8` 4.4 stories review
- 2026-06-27 `f367b4a5` fix(E4): стори 4.4 — патч ревью (честный коммент update_status)
- 2026-06-27 `0ced6b15` feat(E4): стори 4.5 — read-only API чтения аудита (FR-36)
- 2026-06-27 `50094591` test(E4): стори 4.6 — audit-coverage CI-страж (AR-9) + чистка статического теста 4.4
- 2026-06-29 `5e98fe3f` feat(E4): стори 4.7 — аудит увольнения + ревью 4.6/4.7 + ретроспектива E4
- 2026-06-29 `e95a5e14` feat(E5): стори 5.1 — вход оператора (JWT-middleware)
- 2026-06-29 `fec75d97` fix(E5): стори 5.1 — security-патчи code-review (JWT trust-architecture)
- 2026-06-29 `f49218cf` 5.2, 5.3a, 5.3b stories
- 2026-06-30 `0d90d35a` docs(bmad): закрытие спайков 1.11/3.13 → done (E1/E3 завершены)
- 2026-06-30 `6104efbd` feat(E5): amendment-flow — 5.4a сервис версий v2+ + 5.4b энфорс ретро-правки
- 2026-06-30 `ac5c24c5` feat(E5): светофор-селектор — 5.5a светофор подразделения + 5.5b каскад по дереву
- 2026-06-30 `3799ac54` feat(E5): 5.6a derive-блокировка «на завтра» + декомпозиция 5.6
- 2026-06-30 `23b00741` feat(E5): 5.6b override-сущность + легальный обход блокировки «на завтра»
- 2026-06-30 `6b724607` 5.7 story
- 2026-07-01 `00bca91b` fix(E5): 5.7a code-review — notify() вариант B (in-txn) + non-fatal + kind CheckConstraint + recipient strip
- 2026-07-01 `28e4487c` docs(bmad): E5 — декомпозиция 5.7b → 5.7b1 (recipient-config) + 5.7b2 (catch-up-джоба)
- 2026-07-01 `281d4048` feat(E5): 5.7b1 recipient-config + 5.7b2 catch-up детект отставания + code-review
- 2026-07-01 `9f646ec4` feat(E5): 5.7c read-API уведомлений (GET /notifications/?since=)
- 2026-07-02 `97fc0299` fix(E5): 5.7c code-review — isolation-гвард (alias/relative + непустой скан), blank-guard селектора, anon-write 405 + фикс 500 на whitespace X-User-Id
- 2026-07-02 `d0d4af6c` feat(E5): 5.8a POST /api/operations/daily-submissions/ — сдача дня по HTTP + code-review
- 2026-07-02 `4bcc00e6` feat(E5): 5.8b POST /{id}/amend/ — ручной amendment по HTTP + code-review
- 2026-07-02 `6f49ec24` chore(graphify): обновление графа кода после 5.8a/5.8b
- 2026-07-02 `d0c728c6` feat(E5): 5.8c GET list+detail сдач — история и деталь по HTTP + code-review
- 2026-07-02 `c898dc83` chore(graphify): обновление графа кода после 5.8c
- 2026-07-04 `8307295c` chore(design-sync): первый синк дизайн-системы донора в claude.ai/design
- 2026-07-04 `be847033` chore(design-sync): зафиксировано одобрение ревью превью пользователем
- 2026-07-04 `dd2af16e` feat(E5): 5.9 аудит сдач — DAILY_SUBMISSION_SUBMITTED/AMENDED + TOMORROW_BLOCK_OVERRIDDEN + code-review
- 2026-07-04 `2b0fe72c` chore(graphify): обновление графа кода после 5.9
- 2026-07-04 `6392562b` feat(E8): 8.1 scaffold Vite react-ts — каркас фронтенда с контурным гейтом
- 2026-07-06 `75519a00` fix(E8): 8.1 code-review проход 1 — даунгрейд до спеки + ужесточение гейта
- 2026-07-06 `362c7d91` docs(E8): спека 8.2 канон-линтеры — ready-for-dev
- 2026-07-07 `026f6044` feat(E8): 8.2 канон-линтеры — boundaries/баны/deps-gate/самотест + code-review проход 1
- 2026-07-07 `4d9ad410` feat(story-8.3): Кодоген типов из схемы
- 2026-07-07 `6d747804` feat(story-8.4): apiClient и DomainError-парсинг
- 2026-07-07 `1ef7009d` feat(story-8.5): useApiMutation и ConflictDialog
- 2026-07-07 `dcf5ec42` feat(story-8.6): Auth-подключение
- 2026-07-07 `fd136f41` feat(story-8.7): Роутер, routes.ts и layout
- 2026-07-07 `454aacbc` feat(story-8.8): Печатный каркас
- 2026-07-07 `76c42040` feat(story-5.10): Property — иммутабельность снапшота
- 2026-07-08 `cc2dc2cd` feat(story-5.11): Фрактальная сводка
- 2026-07-08 `5e2b4ed6` chore(E5): ретроспектива эпика 5 + doc-синхронизация
- 2026-07-08 `9ad9d62c` feat(story-6.1): App documents и Attachment
- 2026-07-08 `4e1350b2` feat(story-6.3): Генератор .docx (перенос из донора)
- 2026-07-08 `02cd511d` feat(story-6.4): Генераторы .xlsx/.csv/.pdf
- 2026-07-08 `4f9906da` feat(story-6.5): Выпуск расхода
- 2026-07-09 `984c5283` feat(story-6.6): спайк async-timing — async по умолчанию числами не оправдан
- 2026-07-09 `9f0657d7` feat(story-6.7): Story 6.7: Скачивание и повторная выдача
- 2026-07-09 `b7f7d927` docs(story-6.8): спека golden-master → ready-for-dev; авто-оркестратор остановлен
- 2026-07-09 `e515fb65` feat(story-6.8): Golden master 20–30 исторических дней (расход)
- 2026-07-09 `98ad0e0c` feat(story-6.9): Зерно parallel-run — ночная diff-джоба против донора
- 2026-07-09 `00bb0bbf` feat(story-6.10a): HTTP-выпуск расхода и чтение по дате/периоду
- 2026-07-09 `c735813a` feat(story-6.10b): блокировка «на завтра» — HTTP и override
- 2026-07-09 `37035ff9` docs(story-9.1): бумажный контракт экрана №1 (массовый слепой ввод)
- 2026-07-09 `4e0172e3` feat(story-9.2): чистая state machine клавиатурной грамматики грида
- 2026-07-09 `0cc64ad5` feat(story-9.3): property-based свойства грамматики (fast-check)
- 2026-07-09 `bafab604` feat(story-9.4): грид-компонент (TanStack Virtual + грамматика 9.2)
- 2026-07-09 `0b586161` feat(story-9.5): фокус-слой грида (RTL+userEvent + ConflictDialog focus-return)
- 2026-07-09 `3a1a5c10` feat(story-9.6): валидация в гриде (zod + конфликт-маркеры soft/hard)
- 2026-07-09 `6ba10217` feat(story-9.7): prefill «вчера» + отправка только дельт (bulk-3.8)
- 2026-07-09 `7530b19d` feat(story-9.8): перф-смоук грида — блокирующие детерминированные счётчики
- 2026-07-13 `8aa089f1` fix(story-6.9): правки cross-model ревью — non-blocking контракт закрыт с обеих сторон
- 2026-07-13 `6fff9ec6` chore(graphify): обновление графа после правок ревью 6.9 (parallel_run)
- 2026-07-13 `148833a0` fix(story-6.10a): правки cross-model ревью — реальный горизонт данных вместо вакуумной пробы
- 2026-07-13 `972c6195` chore(graphify): обновление графа после правок ревью 6.10a
- 2026-07-14 `a56608d4` fix(story-6.10b): правки cross-model ревью — блок по живым laggards, 409 на дубль override, горизонт 31д
- 2026-07-14 `cfdbbbb0` chore(graphify): обновление графа после правок ревью 6.10b
- 2026-07-14 `87bec54f` docs(story-9.1): правки ревью вычиткой — таблица §3.2 синхронизирована с реализованной грамматикой
- 2026-07-14 `d13fed85` fix(story-9.2): правки cross-model ревью — guard-тест сверяет с ожидаемой таблицей §3.2, самоисцеление входа
- 2026-07-14 `f4b653be` fix(story-9.4): правки cross-model ревью — type-ahead seed живой, самоисцеление rows, фокус не падает при скролле
- 2026-07-14 `6d8f9c59` fix(story-9.3): правки cross-model ревью — инвариант «нажатия не теряются» перестал быть вакуумным
- 2026-07-14 `d2aec070` fix(story-9.5): правки cross-model ревью — клик-синк фокуса, оверрайд только с причиной, позиционные ассерты
- 2026-07-14 `1d858e5e` fix(story-9.6): правки cross-model ревью — блокируются данные, а не только фокус
- 2026-07-14 `30de448e` fix(story-9.7): правки cross-model ревью — bulk-shape выровнен с живым 3.8
- 2026-07-14 `8535e275` fix(story-9.8): правки cross-model ревью — перф-смоук перестал быть вакуумным
- 2026-07-14 `f8f10873` feat(story-9.9): e2e слепого ввода — реальный браузер против прод-харнеса
- 2026-07-14 `ea748c8c` fix(story-9.9): правки cross-model ревью — вакуумные ассерты закрыты
- 2026-07-14 `fa619070` feat(story-10.1): бумажные контракты экранов светофора и расхода
- 2026-07-14 `596987c4` fix(story-10.1): правки cross-model ревью — контракты сверены с raise-сайтами
- 2026-07-15 `f0868806` feat(story-10.1a): REST bulk-роут статусов — backfill AI-4 (bulk-POST + regen схемы)
- 2026-07-18 `22fa60d5` chore: добавлен HTML-прототип VAPS (визуальный эталон)
- 2026-07-19 `d7bb85ed` feat(story-10.2): экран массового обновления
- 2026-07-19 `e2c78902` feat(story-11.1): ASGI + channels_redis — WS-транспорт уведомлений
- 2026-07-19 `3cce774e` chore(graphify): обновление графа после story-10.2/11.1
- 2026-07-19 `7c88f0a2` feat(story-11.2): публикация в WS из notify() через transaction.on_commit
- 2026-07-19 `9e013d2e` feat(story-10.3): экран сдачи дня
- 2026-07-19 `608765f4` chore(graphify): обновление графа после story-10.3/11.2
- 2026-07-19 `a56ad92b` feat(story-10.3a): роут каскадного дерева светофора
- 2026-07-19 `1353291c` feat(story-11.3): WS-клиент с reconnect, дочиткой ?since= и индикатором связи
- 2026-07-19 `303476eb` chore(graphify): обновление графа после story-10.3a/11.3
- 2026-07-19 `15b9268f` feat(story-10.4): светофор-дерево
- 2026-07-19 `8573b329` feat(story-11.4): центр уведомлений — колокольчик, панель и WS-обновление кэша
- 2026-07-19 `ad59582a` feat(story-10.5): экран расхода
- 2026-07-19 `101cc01e` chore(graphify): обновление графа после story-10.4/10.5/11.4/11.5
- 2026-07-19 `53b30a4e` feat(story-10.6): amendment-флоу UI
- 2026-07-19 `c5a6ee44` feat(story-11.6): e2e-уведомления — живой стек с браузером
- 2026-07-19 `ca8f849d` chore(graphify): обновление графа после story-10.6/11.6
- 2026-07-19 `84515f6c` feat(story-10.7): печатная форма расхода
- 2026-07-19 `a5cfcb38` feat(story-10.8): личный экспорт оператора («щит»)
- 2026-07-19 `dee419f7` chore(graphify): обновление графа после story-10.7/10.8
- 2026-07-20 `c18d992e` feat(story-10.9): журнал «сообщено → исправлено» (каркас)
- 2026-07-20 `21617863` feat(story-10.10): e2e сдачи целиком — живая цепочка через все экраны
- 2026-07-20 `5e94c1dc` chore(graphify): обновление графа после story-10.9/10.10
- 2026-07-20 `bd5009d5` chore(bmad-story-automator): cross-model review + File List check are defaults, not habits
- 2026-07-24 `82ffba89` chore(gitignore): track docs/frontend/ — Smart Josparlau session memory
- 2026-07-24 `01491212` feat(smart-josparlau): add Dictionaries screen (§30)
- 2026-07-24 `a0f1a394` feat(smart-josparlau): add unified shift calendar (§25, day view)
- 2026-07-24 `b4ef1c15` feat(smart-josparlau): add remaining §30 dictionaries (journal entry types, post requirement groups)
- 2026-07-24 `92430180` test(smart-josparlau): extend e2e-mock to personnel/objects/dictionaries/calendar/placement
- 2026-07-24 `a24cd27c` test(smart-josparlau): close the last e2e-mock gap — RECON→DEMAND→FORCES→PLACEMENT
- 2026-07-24 `3f3fb1c5` test(smart-josparlau): e2e-mock coverage for audit, analytics, duties
- 2026-07-24 `b4f26ea8` feat(smart-josparlau): operational profile tab structure (§20.5)
- 2026-07-24 `59e4f58a` feat(smart-josparlau): combat duty groups on Routes (§24.5-24.10)
- 2026-07-24 `642aa70b` feat(smart-josparlau): combat duty execution lifecycle (§24.19-24.23)
- 2026-07-24 `82b08550` feat(smart-josparlau): combat duty roster replacement (§24.21)
- 2026-07-24 `43e573e6` docs(smart-josparlau): update ledger for §24.1 requirement formation (Этап 18)
- 2026-07-24 `88ca928b` docs(smart-josparlau): ledger for Этап 19 — calendar+analytics combat groups
- 2026-07-25 `ea03583f` docs(smart-josparlau): ledger for Этап 20 — accessibility audit pass one
- 2026-07-25 `cf348837` docs(smart-josparlau): ledger for Этап 21 — §24.22 handover checkpoint
- 2026-07-25 `d4ea1354` feat(smart-josparlau): cascading replacement of departed staff (§9.11)
- 2026-07-25 `d33b0ee8` docs(smart-josparlau): ledger for Этап 22 — §9.11 cascading replacement
- 2026-07-25 `1633d9bc` feat(smart-josparlau): keyboard navigation for operational-profile tabs
- 2026-07-25 `7870b6db` feat(smart-josparlau): axe-core accessibility audit across all screens
- 2026-07-25 `6a3a23c2` fix(smart-josparlau): close moderate/minor axe findings, fix real contrast bug
- 2026-07-25 `abacc30a` feat(a11y): add skip-to-content link to AppLayout (WCAG 2.4.1)
- 2026-07-27 `7a2ce30a` feat(smart-josparlau): placement print form (§9.15) as marked demo preview
- 2026-07-27 `40141290` feat(smart-josparlau): read-only case archive of a closed security event
- 2026-07-27 `3c90bf00` feat(smart-josparlau): immutable passport versions with deep-linked read-only view
- 2026-07-27 `f26da1ee` feat(smart-josparlau): bind security events to a published passport version (§9.6)
- 2026-07-27 `e4b56442` feat(smart-josparlau): bind duty shifts to a published passport version (§9.6)
- 2026-07-27 `d7520ea2` feat(smart-josparlau): monthly duty plan with server-side KPI and conflicts (§21.27-21.30)
- 2026-07-27 `d0a45704` feat(smart-josparlau): create individual duty shifts from the UI (§21.31/§21.33/§21.34)
- 2026-07-27 `90bf1ff0` feat(smart-josparlau): duty shift card with server-side conflicts and named gaps (§21.32)
- 2026-07-27 `87bc906f` feat(smart-josparlau): edit and cancel a planned duty shift (§21.31)
- 2026-07-27 `a393d0ca` feat(smart-josparlau): employee availability matrix with named missing layers (§21.30)
- 2026-07-28 `9d4538de` feat(smart-josparlau): duty shift list and history with named missing columns (§21.30)
- 2026-07-28 `1c3e60b6` feat(smart-josparlau): objects registry KPI with policy-driven passport freshness (§21.7)
- 2026-07-28 `5bb22e34` feat(smart-josparlau): monthly plan lifecycle with server-side action policy (§21.27-21.28)
- 2026-07-28 `ab6b24ae` feat(smart-josparlau): server-side safe projection and sensitive identity disclosure (§20.27-20.33)
- 2026-07-28 `05a0d480` feat(smart-josparlau): service report registry with async jobs and server-side masking (§22.18-22.25)
- 2026-07-28 `328ec0fd` feat(smart-josparlau): report history with artifact revisions and permission-scoped visibility (§22.25)
- 2026-07-28 `82015f21` feat(smart-josparlau): report job card with server-side redaction of foreign parameters (§22.26-22.28)
- 2026-07-28 `98a3155d` feat(smart-josparlau): server-owned analytics snapshot and stable-ID drill-down (§22.3-22.12)
- 2026-07-28 `37e4fef3` feat(smart-josparlau): server-owned attention detectors with own policy (§22.11)
- 2026-07-28 `3c5b4633` feat(smart-josparlau): operations analytics hierarchy by stable IDs (§22.13/§22.15)
- 2026-07-28 `d7797d2d` feat(smart-josparlau): append-only transition journal and §22.14 funnel
- 2026-07-28 `e420ef42` feat(smart-josparlau): feedback registry with server-owned confidentiality (§28)
- 2026-07-28 `40ac55e0` feat(smart-josparlau): feedback card with diff-written timeline (§28 detail)
- 2026-07-28 `ffa19f5d` feat(smart-josparlau): settings section owns the attention policy (§29)
- 2026-07-28 `ef2a4655` feat(smart-josparlau): conflict rules own the rest-after-duty mode (§29/§21.35)
- 2026-07-28 `4745e97b` fix(deploy): wait for redis before starting vaps-backend.service
- 2026-07-28 `3b937e36` fix(deploy): wait for postgres before starting vaps-backend.service
- 2026-07-28 `a6070600` fix(deploy): check dep readiness via backend venv, not host binaries
- 2026-07-28 `ce4a9107` feat(smart-josparlau): settings own the passport freshness policy (§29/§21.7)
- 2026-07-29 `faeb0af1` feat(smart-josparlau): dictionary usage becomes a live server-side count (§30)
- 2026-07-29 `4dd580e3` feat(smart-josparlau): пределы периодов и хранения переезжают в «Настройки» (§22.5/§29)
- 2026-07-29 `a6025d3a` feat(smart-josparlau): оперативный рейтинг — read model и сводка агрегатов (§19)
- 2026-07-29 `0a98ee9f` feat(smart-josparlau): динамика оперативного рейтинга — ряд закрытых периодов и граница смены методики (§19.20)
- 2026-07-29 `9d481a84` feat(smart-josparlau): аналитика рейтинга — отчёт с подавлением малых групп (§22.16-22.17)
- 2026-07-31 `0f385b11` feat(smart-josparlau): рабочее пространство оценивания — задания, форма, отправка (§19.7-19.10, §19.14)
- 2026-07-31 `7d29faf6` feat(smart-josparlau): исправление оценки — новая запись, цепочка и diff (§19.17-19.18)
- 2026-07-31 `accb0858` feat(smart-josparlau): реестр итоговых оценок и карточка агрегата (§19.15-19.17)
- 2026-07-31 `5af40845` feat(smart-josparlau): конфликты редакций и идемпотентность отправки (§19.25-19.26)
- 2026-07-31 `c6b51a25` feat(smart-josparlau): журнал оценивания — события, отказы и ссылки (§19.27)
- 2026-07-31 `50616da7` feat(smart-josparlau): уведомления оценивания — код вместо текста, deep link с перепроверкой прав (§19.28)
- 2026-07-31 `52089489` feat(smart-josparlau): экспорт рейтинга — агрегированная выгрузка, состояния и отказ sensitive (§19.29)
- 2026-08-01 `e334f433` docs(smart-josparlau): ledger A146-A152 — решения Этапов 64-68
- 2026-08-01 `c0145c1a` feat(smart-josparlau): устойчивый ID сотрудника и подразделения на смене дежурства (§22.9)
- 2026-08-01 `8363320a` feat(smart-josparlau): аналитика нагрузки — раздел LOAD_POLICY и серверный LoadMetric (§22.9)
- 2026-08-01 `d49f9708` fix(smart-josparlau): разделы «Настроек» выводятся из SECTION_TITLE — LOAD_POLICY был молча спрятан списком
- 2026-08-01 `74a4dad8` fix(smart-josparlau): живое первое впечатление — донор-дефолты demo-режима и посадочная «/» (Этап 71)
- 2026-08-01 `3efff53b` fix(smart-josparlau): переход Бюллетень→Рекогносцировка + сквозная e2e полного цикла ОМ (Этап 72)
- 2026-08-01 `487e1931` refactor(smart-josparlau): фиксы код-ревью — 15 замечаний пяти углов (Этап 73)
- 2026-08-02 `6dcf2072` feat(host-перенос): эквивалентность доказана — 125/125 общих e2e против PersonalRecordFront (Этап M2)
- 2026-08-03 `63ef14ff` feat(host-перенос): единый источник — josparlau/src генерируется синком (Этап M3)
- 2026-08-08 `7f6c3c27` docs: карта пробелов API — какие экраны стоят без бэкенда
- 2026-08-08 `7aa934b1` docs: очередь переезда — вычеркнуты staffing-slots, vacancies и attachments
- 2026-08-08 `35c1bd6b` docs: план бэка раздела ОМ — 64 адреса /api/ops/*, а не 37
- 2026-08-08 `3102df3b` chore(graphify): обновление графа после фиксов ревью 08.08
- 2026-08-10 `478d39a2` docs(api-gaps): реестр по факту бэка — objects-список и staffing-slots/attachments уже живые
- 2026-08-10 `93db190f` feat(ops): срез A2 — паспорт объекта живой end-to-end: секторы/посты, версии, свежесть, KPI
- 2026-08-10 `cecc0c18` feat(ops): срез B1 — командный центр и реестр ОМ живые: жизненный цикл всех девяти стадий
- 2026-08-10 `3ea0d528` feat(ops): срез C1 — план дежурств живой: виды, смены, месячный план, конфликты
- 2026-08-10 `782b5904` feat(ops): срез C2 — боевые группы живые, календарь закрыт целиком
- 2026-08-10 `5e974489` feat(ops): срез D1 — настройки (владелец политик), справочники и аудит живые
- 2026-08-10 `5619be19` feat(ops): срез G — оперативный рейтинг живой: все 15 адресов и семь экранов
- 2026-08-10 `78a9f915` feat(ops): срез H — аналитика службы и мероприятий живая: все 6 адресов
- 2026-08-10 `1754be70` feat(ops): срез I — служебные отчёты живые: каталог, генерация, артефакты
- 2026-08-10 `bc2783e1` feat(ops): срез J — обратная связь живая: реестр, карточка, разбор, закрытие
- 2026-08-10 `faca519f` refactor(front): обратная связь переписана целиком — легаси-чат /feedback удалён
- 2026-08-10 `3c8addd3` refactor(front): /feedback рендерит новый модуль сам — без редиректа в раздел ОМ
- 2026-08-10 `1edd09cc` refactor(front): дублирующая SPA-группа /ops/* выведена — адреса ведут на переписанные страницы
- 2026-08-10 `7b9ccaa7` chore(front): демонтаж копии josparlau и host-e2e — SPA-встройка выведена целиком
- 2026-08-10 `b2ae02a7` feat(ops): расход дня ОМ живой — тонкие адаптеры /api/ops/daily/* над /api/operations/
- 2026-08-10 `861958bf` fix(core): гонки легаси-эндпоинтов core закрыты — лок, state-гвард и аудит
- 2026-08-10 `7aeaea18` chore(graphify): обновление графа после фикса гонок core
- 2026-08-11 `af94b77f` docs(ledger): обход стенда 11.08 и hydration-фикс занесены в журнал дефектов
- 2026-08-11 `00dbe361` chore(graphify): обновление графа после обхода стенда 11.08
- 2026-08-11 `2c9f3ef9` docs(ledger): дефект №8 — живость раздела ОМ держалась на untracked .env.local
- 2026-08-11 `7666db11` fix(ops): права раздела ОМ живые — identityHandlers снят, коды прав приведены к бэку
- 2026-08-11 `2fbe1ef9` feat(ops): роль OPS_READER в сиде RBAC — чтение объектов и плана дежурств
- 2026-08-12 `4e015edd` fix(reports): порядок пагинируемого списка задаёт модель + CheckConstraint.condition
- 2026-08-12 `c3fdc293` chore: вывести vite-SPA frontend/ и бэк Backend/VAPS — работаем на старом стеке
- 2026-08-14 `6dcef734` docs(api-gaps): два дефекта перетирания формы фоновыми данными
- 2026-08-15 `70499e90` docs(api-gaps): три модуля прототипа без бэка — ГВО, охраняемые лица, законы
- 2026-08-15 `9e9a7eea` docs(api-gaps): таймаут смоука на /employees и /statuses
- 2026-08-17 `1300472a` docs(api-gaps): сведения об ОМ — четыре факта без источника и дефект «ответственный»
- 2026-08-17 `3b0c2b78` docs(api-gaps): «ответственный» починен, молчаливые skip проб — тоже
- 2026-08-17 `96343669` docs(api-gaps): командный центр — источник численности и чего в нём нет
- 2026-08-17 `c51eb851` docs(api-gaps): аналитика ОМ — что перенесено, что нет и почему
- 2026-08-17 `6213e9f5` fix(ops): порядок таблицы аналитики ОМ объявлен aria-sort, проба пинит его
- 2026-08-17 `8db5e625` docs(api-gaps): аналитика службы — два владельца чисел и что осталось без источника
- 2026-08-17 `7416c475` docs(api-gaps): паспорт объекта — три вкладки из шести и почему
- 2026-08-17 `0031dbb7` docs(api-gaps): профиль — ручка «кто я», молчащий фильтр статусов и мёртвый путь правки
- 2026-08-17 `ee910fe7` fix(front): спринт 3, хвост — имена фильтрам, слово к цветной точке, подписи KPI
- 2026-08-17 `54583a35` docs(api-gaps): дашборд-500 перепроверен playwright-cli, фикс подтверждён
- 2026-08-18 `6920a88b` fix(front): спринт 4 — формы стали одним механизмом, RHF + zod
- 2026-08-18 `db3b6c70` docs(api-gaps): период статуса не доезжал из ручки штатки — три врущие колонки от одного корня
- 2026-08-18 `d9990781` docs(api-gaps): «GET, который пишет» оказался «GET, который падает 500»
- 2026-08-18 `7381aa2b` docs(api-gaps): инвариант «у каждого работающего есть статус» — сигнал плюс команда
- 2026-08-19 `09f06e63` chore: игнорировать .playwright-cli/ (снапшоты @playwright/cli)
- 2026-08-19 `9b742063` docs(api-gaps): три определения текущего статуса сведены к двум явно разным
- 2026-08-19 `b1c4a615` docs(api-gaps): фолбэк «в строю» на фронте — шесть мест, включая вакансии
- 2026-08-19 `b86f68e3` docs(api-gaps): непокрытая ветка оргструктуры закрыта перехватом
- 2026-08-19 `0366260b` docs(api-gaps): Celery-задачи статусов не доезжают на стенде — инвариант рвался тремя путями
- 2026-08-19 `8397eb28` docs(api-gaps): итог смоук-обхода 19.08 — красных по существу нет, три падения на входе
- 2026-08-19 `d6b31728` docs(obsidian): дизайн vault для VAPS — единственный источник правды
- 2026-08-19 `cdc20e95` docs(obsidian): план миграции в vault — 11 задач от скелета до CLAUDE.md
- 2026-08-19 `90446857` chore(obsidian): scaffold vault skeleton for VAPS documentation
- 2026-08-19 `5d4dbc4f` feat(obsidian): generate per-module changelogs from full git log
- 2026-08-24 Поднят self-hosted [Plane](https://github.com/makeplane/plane) взамен ClickUp: `/home/erda/plane`, compose-проект `plane-selfhost`, 13 контейнеров, http://localhost:8090 (порт уведён с 80 — на машине стенд VAPS и чужие контейнеры). Секреты сгенерированы, дефолтные пароли Postgres/RabbitMQ/MinIO заменены. Заведено пространство `VAPS` (slug `vaps`) и 21 проект; 17 задач Smart Josparlau перенесены снимком ClickUp (`/home/erda/plane/migration/`), остальные проекты пустые — ClickUp в день переезда ушёл в rate limit и на чтение. **Две ямы:** смена паролей БД без заполнения `DATABASE_URL`/`AMQP_URL` даёт мёртвый API при живой главной странице (compose подставляет дефолтную строку подключения); регистрация первого администратора через HTTP отвечает 500 — админ и пространство заведены через `manage.py shell`. Подробности — [[Status#Трекер задач: self-hosted Plane (24.08.2026)]]
- 2026-08-24 Перевыпущены ВСЕ секреты машины и закрыт порт БД стенда. Plane: Postgres, RabbitMQ, MinIO (root переименован), `SECRET_KEY`, `LIVE_SERVER_SECRET_KEY`, пароль учётки; старый API-ключ отозван. Стенд VAPS: Postgres пересоздан на привязке `127.0.0.1:5434` вместо `0.0.0.0` (данные целы — тот же том, 168 ОМ), пароль роли и пароль `admin` сменены. **Литералы паролей убраны из репозитория:** `vaps` был дефолтом в двух `settings`, `[УДАЛЕНО: секрет вне vault]` — в 30 e2e-спеках и `scripts/create_users.py`; теперь единственное место правды — `~/.config/vaps/{db-password,stand-admin-password}` (600, вне git), спеки берут пароль через `e2e/stand-credentials.ts`, а `settings` читают файл сами. Чистка Docker: ~70 ГБ (образы 60.6, кэш 9.8, 79 бесхозных томов 1.8); тома чужого стека `infra-*` намеренно не тронуты. Подробности — [[Status#Секреты стендов перевыпущены, порт БД закрыт (24.08.2026)]]
- 2026-08-24 Работа с задачами переведена на API Plane: заведены состояния `Review` и `On test` в группе `started` (в поставке Plane их нет — цепочка правила `Backlog → In Progress → Review → On test → Done` без них невыполнима), написана обёртка `/home/erda/plane/migration/plane_task.py` (list/states/set; ключ читает из `~/.config/vaps/plane-api-key`, 600 — в командах не светится). Раздел «источник задач» в корневом `CLAUDE.md` переписан с ClickUp на Plane; бэклог-заметка переименована `Бэклог-ClickUp-Smart-Josparlau` → [[../WIKI/Бэклог-Smart-Josparlau]], входящие ссылки перешиты
- 2026-08-24 В корневой `CLAUDE.md` добавлено обязательство «работа только через Obsidian + Plane»: каждое действие по проекту — строкой в vault (Changelog/Status/Decisions/Known-Issues), каждая поставленная задача — карточкой в Plane даже если мелкая, план (в т.ч. рождённый через superpowers) — заметкой в `WIKI/` И задачами в Plane по шагу на карточку. Чтобы правило было исполнимым, а не декларацией, обёртка `/home/erda/plane/migration/plane_task.py` получила команды `add` (идемпотентна по имени — повтор дубль не создаёт) и `plan` (разбирает markdown-план: строка списка верхнего уровня → задача, вложенные строки → описание шага). Проверено заведением и удалением трёх пробных карточек
- 2026-08-26 `1494b93e` chore(docker): **прод-образ фронта переведён на standalone и получил потолок памяти** (Plane №111). Было: `runner` копировал standalone, но образ собирался на `node:18-alpine` (EOL), `sharp` приходил только транзитивно, потолка кучи V8 не было вовсе, а у контейнера — лимита памяти. Стало: стадии `deps → builder → sharp-deps → runner` на `node:22-alpine`; в рантайм уезжает только `.next/standalone` + `.next/static` + `public`; `NODE_OPTIONS=--max-old-space-size=512` в рантайме и `2048` на сборке (сборке запас нужен, рантайму — нет); `mem_limit: 1g` **и** `deploy.resources.limits.memory: 1g` в обоих компоузах (разные ветки compose читают разные ключи); `sharp@0.33.5` отдельной стадией и в `dependencies`; `.dockerignore` вычищает контекст (`.next` 439 МБ, `.next-mock` 131 МБ, `e2e`, `smoke-results`, `personalrecordfront-frontend.tar` 77 МБ). Гейт: `docker compose config -q` зелёный на обоих компоузах, `docker build` **exit 0**, образ **101 МБ**, `require('sharp').versions.sharp` = `0.33.5`, контейнер под `-m 1g` отвечает `/` → **200**, `/settings/permissions/` → **307**, потребление **66 МБ из 1 ГБ**. Фронтовая половина (дефект сборки, вскрытый этой задачей) — [[../Frontend/Changelog]]
- 2026-08-26 `вне-репозитория` fix(plane): **`plane_task.py plan` разбирает только раздел «Шаги»** (Plane №140). Раньше он читал ВЕСЬ файл плана и делал задачей каждую строку списка верхнего уровня — то есть в трекер уезжали факты разведки, слова заказчика и ОТВЕРГНУТЫЕ варианты, помеченные как работа. Замер на живых планах: `План-роли-в-сборе-сил.md` — 14 задач по старому правилу против 8 шагов по новому; в шести лишних оказались, например, «Закрыть звенья ролями по имени» и «Не выдавать новые права никому» — обе с пометкой «отвергнуто» в самом плане. `План-расстановка-без-боксов-потребности.md` — 8 против 6. Теперь шагом считается строка списка ВНУТРИ заголовка, начинающегося на «Шаг»; нет такого раздела — отказ с объяснением, как оформить план, а не молчаливая пачка карточек. Добавлен `--dry-run`: показывает разбор и НЕ заводит ничего — так проверяется план перед заведением. Проверено на трёх планах и на файле без раздела «Шаги» (отказ). ⚠️ Скрипт живёт в `/home/erda/plane/migration/`, а это НЕ репозиторий: правка есть только на машине, в коммит не попадает. Копия на всякий случай — `obsidian-vault/Archive/plane_task-plan-fix-2026-08-26.md`

## 27.08.2026 — две копии vault сведены в одну (Plane №184)

Коммит `23a05037`.

Внешний каталог `/home/erda/Музыка/Obsidian_brain/smart_josparlau_vault/`
заменён симлинком на репозиторный `obsidian-vault/`. Проверка после замены:

```
$ ls -la /home/erda/Музыка/Obsidian_brain/ | grep smart_josparlau
lrwxrwxrwx 1 erda erda 54 авг 27 17:16 smart_josparlau_vault -> /home/erda/Музыка/Smart Josparlau/obsidian-vault
$ diff -rq "…/obsidian-vault" "…/smart_josparlau_vault" && echo "содержимое едино"
содержимое едино
```

Расхождение до замены (внешняя копия отставала): `Frontend/Changelog.md`
401 строка против 528, `Personnel-Records/Decisions.md` 1067 против 1127,
`WIKI/Бэклог-Smart-Josparlau.md` 810 против 814. Слияние не потребовалось —
репозиторная копия надмножество. Внешняя перед удалением сохранена архивом
`vault-external-backup-2026-08-27.tar.gz` (4,3 МБ).

`CLAUDE.md`: строка таблицы про знания и журнал возвращена на `obsidian-vault/`
с указанием второго адреса; в раздел «Obsidian vault — источник правды» добавлен
абзац про симлинк и признак рецидива. Причина выбора и отвергнутый вариант —
[[Decisions#27.08.2026 — vault сведён в одну копию: репозиторий канон, внешний адрес — симлинк (Plane №184)]].

## 28.08.2026 — .gitignore перестал пропускать каталог media (Plane №241)

Правило `./organization_management/media/` не ловило ничего: git сверяет шаблон
с путём относительно `.gitignore`, и «./» в начале делает шаблон недостижимым.
Из-за этого каталог с аватарками — 111 МБ, которые кладёт сид №205, — висел в
`git status` у каждого, кто поднимал стенд, и ждал случайного `git add .`.

Правка узкая: поправлена ОДНА строка про медиа. Соседние две («staticfiles»,
«Employees.csv») с тем же «./» оставлены как были и это записано прямо в файле:
по ним уже отслеживаются 163 файла статики, и смена правила там — отдельное
решение, а не побочный эффект.

Проверено: `git check-ignore -v organization_management/media/employees/photos`
называет новую строку, `git status` каталог больше не показывает.

## 2026-08-28 — vault переехал из репозитория, `CLAUDE.md` приведён в соответствие

Заказчик перенёс хранилище: теперь `/home/erda/Музыка/Obsidian_brain/smart-josparlau-vault/` — настоящий каталог, а не симлинк на `obsidian-vault/` в репозитории. Каталога `obsidian-vault/` в проекте больше нет.

- **Проверено до всего остального:** содержимое уехало целиком. Сверены пофайлово восемь файлов, тронутых в тот же день (`00-Index.md`, оба `Changelog.md`, оба `Decisions.md`, `Frontend/Known-Issues.md`, бэклог-заметка, план №259) — все на месте, записи по №255, №256 и №259 внутри.
- **`CLAUDE.md`, семь правок:** адрес в таблице частей; обозначение `<vault>` для остальных упоминаний; путь в команде `plane_task.py plan`; шаг «старт сессии»; канон формы фронтенда; снапшот заморозки; карта модулей. Раздел «Obsidian vault — источник правды» переписан целиком.
- **`git rm --cached obsidian-vault`** — 400 файлов сняты с учёта. До этого `git status` показывал их удалёнными, и любое чтение состояния дерева тонуло в этих строках.
- Коммит `c87b2761`.

**Чужие правки в дереве не тронуты.** В момент работы вторая сессия правила бэкенд по задаче №267 (разведение прав согласующего и ведущего ОМ) — семь файлов `apps/ops` и `apps/operations`. В индекс попали только `CLAUDE.md` и снятие vault с учёта; чужое осталось нетронутым и незакоммиченным.

Разбор последствий переезда — [[Decisions#Vault переехал из репозитория в Obsidian_brain (28.08.2026, решение заказчика)]].

## 2026-08-29 — бэкенд-стенд :8100 перезапущен между блоками обхода

Перезапуск согласован перепиской двух сессий: :8100 кормит и dev-стенд, и обход портала, идущий по прод-стенду :3108, — поэтому он гасился НЕ по готовности правки, а в промежутке между блоками персон (после `persona admin`: 45 passed за 37,0 мин, прод-стенд 210 484 КБ, ни одного перезапуска).

Проверялось не «процесс поднялся», а что ручка ОТДАЁТ: `/api/ops/daily/divisions/` → 54 строки, первая несёт `division_type: "organization"`, первый узел типа `department` — «Департамент охраны», порядок — обход дерева. То есть на живом API оказались разом №295 (`can_submit`, `last_submitted_at`), №296 (очередь дерева) и №307 (тип узла).

**Записано как правило смены:** `runserver` поднят с `--noreload`, и за день это трижды стоило ложных результатов — правишь бэк, а ручка отдаёт старое, отчего пробы «зелены» вхолостую либо краснеют без вины кода. Пока стенд общий, перезапуск после правки `apps/ops` / `apps/operations` обязателен, а если по стенду идёт чужой прогон — либо ждать промежутка, либо поднимать ВТОРОЙ сервер на другом порту к той же базе (приём применялся сегодня: :8101 под свои пробы, `SMOKE_API` в него; экран при этом продолжал ходить в :8100, база одна).

## 29.08.2026, 23:19 — стек переподнят целиком (указание заказчика)

Погашено по PID и поднято заново всё: Django `:8100`, dev `:3106` со сторожем, прод `:3108`. Прогонов в этот момент не шло (`playwright` в процессах не висел) — ничей прогон не оборван; соседняя сессия предупреждена заранее.

| Стенд | pid | RSS после подъёма | Проверка |
|---|---|---|---|
| Django `:8100` | 681079 | 137 908 КБ | `/api/schema/` → 200 |
| dev `:3106` | 681364 (сторож 681333) | 1 574 792 КБ спустя 10 мин | `/` → 200 |
| прод `:3108` | 682896 | 154 844 КБ | `/` → 200 |

**Проверено делом, а не фактом запуска:** 13 целевых проб по прод-стенду — зелёные. Перед подъёмом сделан `git pull`, поэтому прод собран уже с `270e7126` соседней сессии, то есть стенд описывает код обеих.

**Цифры до гашения:** dev `:3106` держал **2 139 628 КБ** — выше порога 2 ГБ, перезапуск ему требовался и без указания; прод `:3108` — 198 520 КБ, рос ровно.

⚠️ **Осторожно с чужим процессом:** `pid 3492` (`next-server`, 119 МБ, живёт часами) — НЕ наш стенд, у него `cwd=/app`, это контейнер Plane. Гашение уронило бы трекер с нашими карточками. Проверять `cwd`, а не только имя процесса.

**О росте dev.** За десять минут после подъёма dev набрал 1,5 ГБ, но между подъёмом и замером прогнаны 13 проб: `next dev` компилирует маршруты на лету и держит их. Замер «после нагрузки» нельзя сравнивать с замером «сразу после подъёма» — чтобы цифра значила рост, мерить надо в одинаковых условиях.

Сразу после этого соседняя сессия получила от заказчика то же указание и переподняла стек ещё раз — её pid'ы отменяют перечисленные выше.

### 29.08.2026, 23:40 — замер памяти dev-стенда: порог 2 ГБ недостижим

Проверял вывод соседней сессии («dev набирает 1,9 ГБ за три пробы») и не подтвердил его. Гасил и поднимал стенд сам, мерил ОДИН И ТОТ ЖЕ pid (701684, `next-server v15.2.4`):

| Момент | RSS |
|---|---|
| сразу после подъёма, один запрос `/` | **1 594 884 КБ** |
| после `status-vacancy-actions` | 2 058 924 |
| после `status-event-link` | **1 697 124** — меньше предыдущего |
| после `hydration` | 2 707 276 |

Отдельный замер до этого: стенд на 2 590 172 КБ от трёх спек не вырос ВОВСЕ, а осел до 2 299 844.

**Три вывода, каждый меняет правило работы:**

1. **Свежий стенд стартует на 1,6 ГБ.** Правило «порог 2 ГБ, выше — гасить по PID» на практике означает «гасить после первой же спеки». Мягкий порог сторожа (2500 МБ) ближе к правде, чем персональный.
2. **RSS колеблется на сотни мегабайт в обе стороны** — V8 отдаёт память обратно. «Раздулся до 2,7 ГБ» и «осел до 1,7 ГБ» случаются в одном прогоне подряд, поэтому одиночный замер не говорит ни о чём.
3. Значит «замер после каждой задачи» ловит не рост, а случайную точку колебания.

**Ловушка, на которой сессии разошлись, — та самая, о которой предупреждает CLAUDE.md.** Соседняя сессия намерила «87 376 КБ сразу после подъёма» и вывела из этого накопление за три пробы. 87 376 — это ОБЁРТКА `node` (у меня в тот же момент 89 472), а не `next-server`, который рядом весил 1,6 ГБ. Правило «мерить `next-server`, а не „ноды“» написано ровно про это и всё равно сработало против нас — в день, когда мы весь день чинили молчащие проверки.

Заведена карточка: поднять персональный порог до уровня сторожа либо требовать ДВА замера подряд выше порога. CLAUDE.md не трогал — правка правила решение заказчика (прецедент №308).

### 29.08.2026, 23:55 — `scripts/stands.sh`: команда вместо правила, которое надо помнить

Вывод из разбора выше, сформулированный соседней сессией и с которым я согласен: **правило, которое человек обязан помнить в момент усталости, не работает; работает команда, которая печатает нужное.** Правило «мерить `next-server`, а не ноду» живёт с Plane №44 — и за один день не помогло НИ РАЗУ: обе сессии, знавшие его, попались.

Заведён `scripts/stands.sh` (коммит `24dd3974`). Печатает разом: pid, `comm`, RSS, порт и **рабочий каталог**; чужие процессы помечает «ЧУЖОЙ — не гасить» по `cwd`, а не по имени (у контейнера Plane имя ровно такое же); обёртки вынесены отдельно с подписью «их RSS ни о чём не говорит». `--watch` даёт три замера подряд.

**Инструмент доказал свой довод на первом запуске:** `--watch` показал 691 788 → 691 788 → **503 132** КБ за двадцать секунд покоя. Одиночный замер действительно не отличает рост от колебания.

Скрипт отбирает процессы по `comm`, а не `pgrep -f`: тот находит СЕБЯ, и первая редакция напечатала собственный шелл в списке серверов — та же болезнь дня, поймана на себе.

**Цифра в карточку о пороге:** пока шёл разбор, сторож сам перезапустил dev — он дорос до 2,7 ГБ после трёх спек. Сейчас 503 МБ. Сторож со своими 2500 МБ отработал как задумано, а персональный порог 2000 за то же время сработал бы четырежды.

## 2026-08-30 — полный прогон работоспособности: зелёный целиком

Гонялся потому, что очередь свелась к карточкам, ждущим решения заказчика, — по правилу это и есть следующая работа.

**Фикстуры.** `seed_smoke_fixtures` (привлечённых 3, мероприятие на «PLACEMENT» с 1 заявкой) + `seed_expense_chain --no-submit` (`STAND_RELEASED_SUBMISSIONS=0` — сдач за день на стенде не осталось, лечение №330 работает).

**Бэкенд целиком.** `pytest organization_management/apps` — **4356 passed**.

**Обход API по СХЕМЕ, а не по памяти.** Из `/api/schema/?format=json` взяты все GET-ручки без параметров пути — **106 штук** — и вызваны под `admin`. Пятисоток и сбоев соединения: **0**.

**Фронтенд целиком.**
- `npm run gate:front` — `tsc` + `check:rewrites` + прод-сборка, зелёный;
- `npm run stand:prod && npm run smoke:prod` — **256 passed, 4 skipped** за 4,8 мин по прод-стенду :3108;
- обход портала БЛОКАМИ ПО ПЕРСОНАМ по прод-стенду: `observer` — 47 passed за 6,4 мин; `erda` — 47 passed за 9,3 мин; `admin` — 47 passed за 38,2 мин. Итого **141 проба, ни одного падения**.

**Память.** Прод-стенд :3108 за весь обход: 200 508 → 314 560 → 330 708 → **345 268 КБ**, ни одного перезапуска — ровно то поведение, ради которого обход и переехал с dev на прод (№173). Dev-стенд :3106 всё это время стоял без нагрузки и держался на 2 062 400 КБ (выше личного порога 2 ГБ, ниже сторожевого 2500 МБ — снова случай из карточки №323).

**Уборка.** `purge_probe_events --yes --force` — строк с меткой «(e2e)» не найдено: уборка в `global-teardown` отработала сама (по ходу прогонов сняла 18 через API и добила 8 упрямых командой).

**Найдено: НИЧЕГО.** Это факт о системе, а не отсутствие результата: за заход закрыты восемь карточек и семь шагов плана, тронуты гейт доступа, экран статусов, борд расхода, строевая записка, бланк расстановки и справочники раздела — и ни одна из 4356 бэкенд-проб, 256 целевых и 141 пробы обхода не покраснела.

**Стенды после прогона.** Прод-стенд :3108 погашен по PID (345 268 КБ на момент гашения) — он поднимался под прогон и держать его дальше незачем. Dev :3106 перезапущен: 2 062 400 → **1 275 600 КБ**. Django :8100 живёт, `/api/schema/` → 200.

## 2026-08-30 — порог RSS dev-стенда поднят до 2500 МБ (Plane №323, `737f1d21`)

**Решение заказчика 30.08.2026:** поднять личный порог до сторожевых 2500 МБ. Отвергнуты «два замера подряд выше порога» (RSS колеблется, но правило усложняется) и «отдать всё сторожу, личный порог снять» (терялся бы замер в журнале после каждой задачи).

**Почему правило было негодным — числами.** Свежий `next dev` стартует на 1,27-1,6 ГБ и пересекает 2 ГБ после первого же прогона проб. Замеры 29-30.08.2026: старт 1 594 884 КБ → 2 058 924 → 1 697 124 (МЕНЬШЕ предыдущего: V8 отдаёт память обратно) → 2 707 276. За заход 30.08.2026 стенд гасился по этому правилу ЧЕТЫРЕЖДЫ (2 030 820, 2 746 088, 3 037 184, 2 218 476 КБ), и ни разу перезапуск не был вызван реальной поломкой.

**Правлено в CLAUDE.md:** порог в шапке команды замера и в разделе «Стенд `next dev`»; довод записан там же с числами. Формулировка «мягкий порог сторожа ВЫШЕ правила — между 2 ГБ и 2500 МБ гашу я» заменена: пороги теперь совпадают, и дыры между ними больше нет. Заголовок про дыру исправлен — она осталась только между 2500 МБ и жёстким потолком (№122), и это по-прежнему верно.

## 2026-08-30 — проверочный прогон после регрессии: зелёный, кроме одной мигающей пробы

Гонялся не по расписанию, а по поводу: в ходе №340 нашлась моя собственная регрессия от №339 (обнуляемый `scope_division` уронил дашборд у всех, чья область не описывается одним узлом). Правило говорит прямо — «что-то повело себя странно» и есть основание для полного прогона.

**Бэкенд целиком.** `pytest organization_management/apps` — **4364 passed**.

**Фронтенд целиком по прод-стенду :3108** (пересобран из `f7aea4c2`):
- `npm run gate:front` — зелёный;
- `npm run smoke:prod` — **256 passed, 4 skipped, 1 failed** за 4,9 мин;
- обход портала БЛОКАМИ ПО ПЕРСОНАМ: `observer` — 47 passed за 5,9 мин; `erda` — 47 passed за 9,2 мин; `admin` — 47 passed за 38,2 мин. Итого **141 проба, ни одного падения**.

**Единственное падение разобрано и НЕ списано.** `prototype-skin.spec.ts:372` («активный пункт подводится в зону видимости сам») — «активный пункт на 54px ниже нижнего края меню». Повторы: проба одна — зелёная; весь файл (61 проба) — зелёный; в полном прогоне — красная один раз. Причина видна из кода: проба ждёт НАЧАЛА прокрутки (`scrolled > 0`) и меряет сразу, а подводка идёт плавно — под нагрузкой замер попадает в середину движения. Недокрут 54 px ≈ высота одного пункта, что догадке соответствует. Заведена карточка №341; сам не правил, потому что починка меняет ПРЕДМЕТ пробы (сейчас она стережёт «меню вообще прокрутилось»).

**Регрессия, ради которой прогон и затевался, обходом подтверждена починенной:** дашборд открывается под всеми тремя персонами и под всеми 28 ролевыми учётками.

**Память.** Прод :3108 за весь обход: 200 → 288-330 МБ, ни одного перезапуска. Dev :3106 всё это время без нагрузки — 509 520 КБ.

**Уборка.** `purge_probe_events --yes --force` — строк с меткой «(e2e)» не найдено, `global-teardown` отработал сам.

**Стенды после.** Прод :3108 погашен по PID (288 344 КБ) — поднимался под прогон. Живы dev `:3106` (509 520 КБ, `/` → 200) и Django `:8100` (`/api/schema/` → 200).

## 31.08.2026 — стенды подняты заново после перезагрузки машины

**Почему.** Указание заказчика «переподними проект». На момент захода не работало ничего своего: `:8100` и `:3106` не слушались вовсе, единственный живой `next-server` (pid 3758, cwd `/app`) — веб Plane в контейнере, а не наш стенд. Контейнеры (`vaps-db-5434`, `plane-selfhost-*`, `smartqoldau-*`) подняты сами и имели аптайм ~2 минуты — то есть машину перезагрузили, а стенды после этого не поднимал никто.

**Поднято по `.claude/launch.json`.**
- Django `:8100` — `DJANGO_SETTINGS_MODULE=…local_postgres .venv/bin/python manage.py runserver 0.0.0.0:8100 --noreload` (pid 10111, 116 504 КБ). `--noreload` осознанно, по записи 29.08.2026: помнить, что после правки `apps/ops` / `apps/operations` стенд надо перезапускать руками.
- Next dev `:3106` — `PORT=3106 npm run dev:guard`; сторож поднял сервер pid 10238, лимит 2500 МБ, свой лог `/tmp/next-dev-3106.log`.

**Проверено выводом, а не словом.**

| Проба | Ответ |
|---|---|
| `http://127.0.0.1:8100/api/schema/` | 200, 483 281 байт |
| `http://127.0.0.1:3106/` | 200 |
| `http://127.0.0.1:3106/api/auth/csrf/` | 200 |
| `http://127.0.0.1:3106/dashboard/` | 200 |

`/login/` даёт 404 — это НЕ дефект: в `app/` такого маршрута нет вовсе, вход живёт на корневой `page.tsx`. Без косой черты адреса отвечают 308 (`trailingSlash: true`) — ожидаемо.

**RSS сразу после подъёма:** `next-server` 1 191 048 КБ (свежий старт, обычные для него 1,27-1,6 ГБ), Django 116 504 КБ. Порог 2500 МБ не тронут.

**Карточки Plane нет:** задача пришла командой в переписке, кода не тронуто ни строкой — гейт не гонялся.

## 31.08.2026 (вечер) — стенды подняты заново после второй перезагрузки машины

**Почему.** Повторное указание заказчика «переподними проект». Аптайм машины — 18 минут: после дневного подъёма (запись выше) машину перезагрузили снова, и своё не поднялось. `:8100` и `:3106` не слушались вовсе; единственный живой `next-server` (pid 3627, cwd `/app`) — веб Plane в контейнере, gunicorn на `:8000` — API Plane, ни то ни другое к нам не относится. Контейнеры (`vaps-db-5434`, `plane-selfhost-*`, `smartqoldau-*`) поднялись сами.

**Поднято по `.claude/launch.json`** (через `setsid … & disown`, иначе Django уходит вместе с фоновой командой):
- Django `:8100` — `DJANGO_SETTINGS_MODULE=…local_postgres .venv/bin/python manage.py runserver 0.0.0.0:8100 --noreload` (pid 20038, 117 868 КБ, лог `/tmp/django-8100.log`). `--noreload` осознанно: после правки `apps/ops` / `apps/operations` стенд перезапускать руками.
- Next dev `:3106` — `PORT=3106 npm run dev:guard`; сторож поднял сервер pid 20284, лимит 2500 МБ, лог `/tmp/next-dev-3106.log`. Прокси на бэкенд поднялся на `http://127.0.0.1:8100` (строка из лога сборки rewrites).

**Проверено выводом, а не словом.**

| Проба | Ответ |
|---|---|
| `http://127.0.0.1:8100/api/schema/` | 200, 485 293 байта |
| `http://127.0.0.1:3106/` | 200, 47 965 байт |
| `http://127.0.0.1:3106/api/auth/csrf/` | 200 |
| `http://127.0.0.1:3106/dashboard/` | 307 → `/api/auth/signin?callbackUrl=%2Fdashboard%2F` |

307 на дашборде — НЕ дефект: запрос шёл без сессии, гейт уводит гостя на вход. В дневной записи там стоял 200, потому что тот curl шёл с живой сессией.

**RSS сразу после подъёма:** `next-server` 1 345 340 КБ (обычный старт 1,27-1,6 ГБ), Django 117 868 КБ. Порог 2500 МБ не тронут.

**Карточки Plane нет:** задача пришла командой в переписке, кода не тронуто ни строкой — гейт не гонялся.

## 02.09.2026 — сведены в одну заметку учётки стенда с логинами, паролями и ролями

Заказчик попросил записать в vault логины и пароли пользователей, которых просил
завести, вместе с их ролями. Заведена [[Учётки-стенда]]: три комплекта учёток
(семь персон заказчика `acc_*` из Plane №348, 28 ролевых `role_*`, устаревшие
портальные `demo_role_*`) плюс рабочие `admin`/`erda`/`observer`.

**Данные сверены с базой стенда, а не переписаны из планов** (02.09.2026): состав
грантов и их области взяты из `operations.UserRole`, привязка к сотрудникам — из
`Employee.user`, каждый пароль проверен `User.check_password` — четыре комплекта
подошли. Так нашлось, что писать по планам было бы неверно: у `demo_role_1…6`
после снятия портальной системы (Plane №352) НЕ ОСТАЛОСЬ НИ ОДНОГО ГРАНТА —
учётки входят, но прав не имеют, и для ручной проверки прав больше не годятся.
Отмечено в заметке; решать, сносить их или выдавать гранты, — отдельной карточкой.

Пароли в заметке продублированы из `~/.config/vaps/*` осознанно: vault лежит вне
репозитория, в коммит не уезжает, а заказчику они нужны под рукой для ручного
входа. Настоящим источником остаются файлы конфига — заметка может отстать, если
пароль сменят, и в ней написано, чем сверить.

## 05.09.2026 — №772: `plane_task.py list` больше не показывает последнюю сотню вместо очереди

**Что было.** `plane_task.py` брал `/issues/?per_page=100` ОДНОЙ страницей и поле `next_cursor` из ответа не читал вовсе. Ответ Plane курсорный, поэтому `list --open` печатал последние 100 задач из 796. 05.09.2026 три сессии Claude одновременно прочли «открытых 100, из них 15 в Предложено Claude» и начали делить несуществующий дефицит очереди. Тем же одностраничным списком проверяла себя на дубли команда `add`: задача старше сотни последних не находилась, и «идемпотентно по имени» было обещанием, а не свойством.

**Что сделано.** Добавлен помощник `call_all(path)`: прокрутка по `next_cursor`, пока `next_page_results` истинно, с защитой от неподвижного курсора (вечный цикл вместо конца списка). Через него теперь идут все три списочных запроса — `list`, проверка дублей в `_create` и `states`. `per_page` намеренно НЕ увеличивался вместо прокрутки: сервер вправе отдать меньше запрошенного, и тогда потолок вернулся бы молча.

**Замер — до и после, на одном и том же трекере:**
- до правки: `list "Smart Josparlau" --open` → **99 строк**;
- после правки: **461 строка**, номера от №36 до №805.
Срез очереди, который до сих пор был не виден целиком: Review 339, Предложено Claude 65, On test 42, In Progress 15.

**Коммита нет и быть не может:** `/home/erda/plane/migration/plane_task.py` лежит ВНЕ репозитория проекта (как и vault). Копия исходного файла на время проверки — в рабочем каталоге сессии; проверка «до/после» сделана подменой файла туда и обратно, файл возвращён в исправленное состояние.

**Следствие для правил.** В `CLAUDE.md` стоит предупреждение №772 с двумя запретами («не делать вывод „очередь пуста“ по `list`» и «искать дубль прямым запросом»). Снимать его самому нельзя — файл правил меняется только словом заказчика; оно и написано условно («пока карточка не закрыта»), так что до проверки заказчиком остаётся в силе.

**Проверка дублей всей очереди прокруткой** (то, чего раньше нельзя было сделать): 796 задач, 8 имён встречаются больше одного раза — все восемь короткие заголовки-разделы заказчика (`Статусы сотрудников.` ×3, `Система. Роли и права.` ×3, `Модуль Сбор сил на ОМ.` ×3, `ОМ. Бюллетень.` ×3, `Система.` ×2, `Мой профиль.` ×2, `Модуль Обзор.` ×2, `ОМ. Создать бюллетень.` ×2). Свои карточки не дублируются. Сводить чужие одноимённые — решение заказчика, а не моё.

## 06.09.2026 — №811: мутационная проверка перестала ломать общее дерево на время ожидания замка

- **Дефект приёма, а не кода.** Правило «новый тест — красная проба» естественно пишется тремя шагами: сломать правку, прогнать `scripts/pytest-lock.sh … pytest`, восстановить. В этой форме сломанный файл лежит в ОБЩЕМ дереве всё время ОЖИДАНИЯ ОЧЕРЕДИ: сосед гонит полный прогон семь минут — семь минут в дереве заведомо сломанный код. Любой, кто в это окно запустит свой прогон, получит красноту неизвестного происхождения и пойдёт искать дефект у себя. За 05.09.2026 так вышло в обе стороны не раз.
- **Что сделано.** `scripts/pytest-mutate.sh`: скрипт СНАЧАЛА берёт замок (перезапуская себя через `pytest-lock.sh`) и только потом ломает файл. Порча живёт ровно столько, сколько идёт проверка; ожидание очереди проходит на целом дереве.
- **Успех — это КРАСНАЯ проба.** Код возврата 0 = «мутация поймана»; зелёная проба на сломанном коде — отказ с кодом 1 и объяснением возможных причин (структурно равный ответ и `structuralSharing` React Query — №810; проба, пишущая до чтения — №605; отбор, не проходящий через изменённый код; пин на строку вместо замера — №782). Раньше исход читали глазами, а «1 failed» в конце длинной простыни легко принять за беду, а не за доказательство.
- **Базовый прогон обязателен и идёт первым, под тем же замком.** «Краснеет на мутации» ничего не доказывает, если проба красная и без неё — а в общем дереве это обычное дело. Разводить два прогона по разным замкам значило бы ждать очередь дважды.
- **Отсутствие искомой строки — отказ, а не «ничего не заменилось».** Молчаливый пропуск дал бы зелёный прогон НЕИЗМЕНЁННОГО кода, то есть ложный вывод «проба не стережёт». Тот же класс, что №812 про молчащие шаги фикстуры.
- **Восстановление в `trap`** — переживает падение pytest, Ctrl-C и убитую задачу. Копии с суффиксом `$$`: два таких прогона не затрут копии друг друга.
- **⚠️ Замок не рекурсивный:** звать скрипт изнутри прогона, который уже держит замок, нельзя — отобьётся кодом 75 «база занята» им же самим. Записано в шапке скрипта.
- **Проверено запуском, четыре исхода, вывод виден:** мутация поймана (снят `@transaction.atomic` у `send_for_approval` → «✅ мутация поймана», код 0); проба зелена на сломанном коде (правка, которую она не стережёт → «🔴 ПРОБА ОСТАЛАСЬ ЗЕЛЁНОЙ», код 1); строки для замены нет (→ «нет строки для замены», код 1); базовый прогон красный (отбор `-k`, ничего не выбравший → «🔴 БАЗОВЫЙ ПРОГОН КРАСНЫЙ», код 1). После всех четырёх дерево проверено: правка восстановлена, копий не осталось.
- **Не сделано намеренно:** строка в `CLAUDE.md` рядом с «новый тест — красная проба». Правила проекта меняет заказчик, и текст предложен ему комментарием в карточке — своим решением файл правил не трогаю.
- **Коммит `53d1da33`, запушен.** Карточка №811 → `Review`.
- **Замер RSS после №811:** 1 917 572 КБ (~1873 МБ) — порог 2500 МБ не пройден.

## 06.09.2026 — №821: числа обхода и смоука в CLAUDE.md пересчитаны

- **Почему это правка, а не «заодно».** Правило №308 (29.08.2026) заведено ровно об этом: «числа посчитаны, а не помнятся». Тогда в CLAUDE.md стояли «пять персон, 133 пробы, 44 маршрута», а таких персон в коде не было вовсе; заказчик выбрал вариант «поправить правило под факт». Здесь то же самое расхождение выросло заново.
- **Посчитано, а не вспомнено (06.09.2026):** `npx playwright test -c playwright.walk.config.ts --list` → `Total: 150 tests in 1 file`; каждый блок `--list -g "persona <ключ>"` → `Total: 50`; в `e2e/portal-routes.ts` 47 записей `ROUTES`. Значит 50 = 47 маршрутов + 2 пробы каркаса (`aside`, `header`) + выход, и 150 = 3 × 50. Стояло «141 = 3 × 47».
- **Целевой смоук:** прогон того же дня по прод-стенду — 459 проб (437 passed, 4 failed — все четыре мигалки, разобраны карточкой №820, 18 skipped). В файле стояло «252 пробы; 29.08.2026 — 248 passed, 4 skipped».
- **Правлены три места:** строка команды смоука, строка команды обхода и абзац с разбором «проб 141 = 3 × 47». В абзаце оставлено, ЧТО ИМЕННО делать вместо сверки с числом: пересчитывать `--list`, потому что счёт растёт с каждым новым маршрутом.
- **🔴 Граница, которую я не переходил.** Правила проекта по существу меняет заказчик (это записано в этом же журнале 05.09.2026). Здесь правлены ТОЛЬКО измеренные числа и способ их пересчёта — то есть применено решение заказчика по №308, а не принято новое. Карточка уходит в `Review` его словом, и в записке это сказано прямо.
- **Гейт по глубине правки:** «Текст в доке… — ничего» (таблица CLAUDE.md). Числа взяты из вывода `--list` и из итога прогона, оба видны выше.
- **Коммит `00ef0e3e`, запушен.** Карточка №821 → `Review`.

## 06.09.2026 — №823: смерть стенда перестала выглядеть красным прогоном

- **Откуда взялась.** Находка полного прогона того же дня: прод-стенд :3108 (pid 1763228) исчез ПОСРЕДИ блока `persona observer`. Замер RSS 03:13:29 его показывает (317 016 КБ), замер 03:16:21 — уже нет. В отчёте Playwright это выглядело не как «стенд умер», а как находка о портале: `observer` — 45 passed и одно падение, `erda` — **50 падений подряд по `0 ms`**, каждое с именем маршрута и персоны. OOM это не был: единственная запись `Out of memory: Killed process` в `kern.log` за сутки — 01:45:31 и по чужому pid 1648161. В `/tmp/next-prod-3108.log` последняя строка — обычный вывод авторизации.
- **Три места, потому что дыра в трёх местах.**
  1. **След смерти в самом стенде.** `scripts/prod-stand.sh` запускал `node server.js &` и выходил — сервер оставался сиротой, и о его конце не знал никто. Теперь сервер поднимается под НАДЗИРАТЕЛЕМ (`setsid`-шелл держит его своим ребёнком и потому может `wait`), и в тот же лог уходит строка «СЕРВЕР ОСТАНОВЛЕН <время>: pid=…, СНЯТ СИГНАЛОМ 9 / вышел сам, код возврата N». Код выше 128 — это сигнал, и ровно этого бита не хватало, чтобы отличить «упал сам» от «его сняли». Pid ребёнка возвращается через `/tmp/next-prod-<порт>.pid`.
  2. **Предполётная проверка** — новый `e2e/global-setup.ts` в ОБОИХ конфигах: прогон по погашенному стенду обрывается одной строкой с адресом и командой подъёма, а не выполняется полусотней падений.
  3. **Послеполётная проверка** — первым делом в `e2e/global-teardown.ts`: стенд, умерший ПОСРЕДИ прогона, предполётная не ловит по построению, поэтому в конце любого прогона печатается громкая строка «🔴 ФРОНТ-СТЕНД … НЕ ОТВЕЧАЕТ В КОНЦЕ ПРОГОНА» с прямым указанием не заводить карточки, пока упавшее не перегнано на живом стенде.
- **Проверка — видимым выводом, а не словом «проверено».** Стенд поднят на запасном :3198 и снят `kill -9` → в логе «СЕРВЕР ОСТАНОВЛЕН 2026-09-06 03:33:45: pid=1959278, **СНЯТ СИГНАЛОМ 9**», pid-файл снят сам. Снят `kill` (SIGTERM) → «вышел сам, код возврата 0» (node обрабатывает TERM и выходит чисто — строка честная). Прогон по мёртвому :3198 → `Error: фронт-стенд http://localhost:3198 не отвечает — прогон не начат` вместо 50 красных. Стенд убит ПОСРЕДИ прогона `tables-data` → в выводе появилась громкая послеполётная строка. На ЖИВОМ стенде её нет: `tables-data` + `ui-access-rule` по :3108 — **13 passed за 16,2 с**, лишних строк не напечатано.
- **Проверка `HEAD` и без разбора кода ответа** — намеренно: 401 и 404 тоже означают «сервер на порту есть». Предмет проверки — процесс, а не маршрут.
- **Гейт:** `npm run gate:front` — код 0 (`tsc` + прод-сборка).
- **Коммит `10662d08`, запушен.** Карточка №823 → `Review`.
- **Замер RSS после №823:** чужой `next dev` :3106 — 1 824 156 КБ (~1782 МБ), порог 2500 МБ не пройден; чужой :3199 — 593 224 КБ; мой прод-стенд :3108 (pid 1978350) — 232 512 КБ; сирота pid 732435 — 103 400 КБ, возраст 9 ч 55 мин.
- **Прод-стенд :3108 погашен по PID**, и его смерть впервые записалась сама: «[prod-stand] СЕРВЕР ОСТАНОВЛЕН 2026-09-06 03:58:21: pid=1999933, вышел сам, код возврата 0» (№823 в работе на живом примере).
- **Само-ревью №821 нашло в ней же дефект того самого класса, о котором карточка** (06.09.2026, при разборе колонки `Review` по №825). Строка обхода получила указание «ПЕРЕСЧИТЫВАТЬ, а не сверять», а соседняя строка смоука — нет: там стояло голое «459 проб; 437 passed…», то есть новое число, которое устареет ровно так же, как устарело «252». И устарело уже: через час соседняя сессия добавила спеку, и в контрольном прогоне стало 461 (439 passed, 4 мигающих, 18 skipped). Строка переписана: число велено считать `--list`, а замер 06.09.2026 оставлен рядом как история. Карточка возвращалась в `In Progress` — заказчику незачем проверять работу, о которой уже известно, что она неполна.
- **Коммит `580212e4`, запушен.** Карточка №821 вернулась в `Review`.

## 06.09.2026 — №823 по ревью: секрет уехал в аргументы, `kill` читался как «вышел сам»

Ревью карточки (задача заказчика №825) нашло в моей же правке четыре вещи, три из них чинятся здесь.

- **🔴 УТЕЧКА СЕКРЕТА — и это моя регрессия, а не старый долг.** Первая редакция передавала `NEXTAUTH_SECRET` ПОЗИЦИОННЫМ аргументом в `setsid bash -c`, и он оказывался в `/proc/<pid>/cmdline` — файл с правами `-r--r--r--`, читает любой пользователь машины, тогда как `/proc/<pid>/environ` читает только владелец (`-r--------`). До правки секрет шёл ТОЛЬКО окружением. Проверено на живом процессе: `ps -eo pid,args | grep server.js` печатал значение целиком. Дороже всего это здесь потому, что CLAUDE.md предписывает снимать `ps` при каждом замере памяти и вставлять вывод в vault, карточки и переписку: правило «секреты в текст команд не попадают» нарушал бы не автор скрипта, а любой, кто выполнит замер.
  - Секрет уходит окружением (`NEXTAUTH_SECRET="$SECRET" setsid bash -c …`), внутренний шелл его наследует.
  - **Значение РОТИРОВАНО** (`openssl rand -base64 32` в `.env.local`, файл под `.gitignore`; прежнее сохранено в `/tmp/claude-1000/env.local.bak.*`): оно уже утекло минимум в два дампа `ps`, и одной правки кода мало. На бегущие серверы это не влияет — они держат старое значение в памяти; расхождение появляется в момент перезапуска. Соседняя сессия предупреждена: единственный процесс, всё ещё печатающий старый секрет, — надзиратель её `:3108` (pid 2070176).
- **`kill` читался как «вышел сам, код возврата 0»** — то есть в САМОМ ЧАСТОМ сценарии карточки лог отвечал не на тот вопрос: Next ставит свой обработчик SIGTERM (`next/dist/server/lib/start-server.js`) и выходит через `process.exit(0)`. Добавлен `NEXT_MANUAL_SIG_HANDLE=1` — сигнал доходит до ядра. **Проверено запуском:** «СЕРВЕР ОСТАНОВЛЕН 2026-09-06 04:18:07: pid=2121884, СНЯТ СИГНАЛОМ 15», и второй раз при гашении проверочного стенда — «СНЯТ СИГНАЛОМ 15». Мягкое завершение прод-стенду для проб не нужно.
- **Проверка «поднялся ли» была СЛАБЕЕ прежней.** Прежний скрипт ждал `sleep 4` и смотрел `kill -0`; новый смотрел на pid-файл, который надзиратель пишет ДО открытия порта, — то есть «поднят» печаталось и тому серверу, который умрёт на второй секунде. Теперь цикл ждёт ОТКРЫТИЯ ПОРТА (та же идиома `/dev/tcp`, что в проверке занятости) и обрывается, если ребёнок умер. **Проверено запуском на порт 80 (EACCES): «сервер не поднялся, смотрите …», а в логе строка остановки.**
- **`trap` в надзирателе** на TERM/HUP/INT пишет «НАДЗИРАТЕЛЬ СНЯТ (сервер мог остаться сиротой)»; дыра «SIGKILL по самому надзирателю следа не оставляет» названа вслух комментарием — отсутствие строки в логе не должно читаться как «стенд жив». Отказ старта надзирателя больше не уходит в `/dev/null`, а пишется в тот же лог. В payload добавлен `set -u` (внешний `set -u` в `bash -c` не наследуется — проверено).
- **Проверялся не тот адрес.** `standUrl()` брал `SMOKE_BASE_URL ?? SMOKE_APP`, а у целевого смоука адресов ДВА: `SMOKE_APP` читают 85 спек, `SMOKE_BASE_URL` — обход и `baseURL` конфигов. Задать руками одну переменную — обычное дело, и тогда проверка объявляла «жив» про сервер, по которому прогон не пойдёт. Теперь проверяются ОБА различающихся адреса. **Проверено:** `SMOKE_BASE_URL=:3198` (живой) + `SMOKE_APP=:3197` (мёртвый) → «фронт-стенд http://localhost:3197 не отвечает».
- **Пять секунд и «любое исключение = мёртв» давали ложные срабатывания.** `next dev` компилирует маршрут на первом запросе и легко перебирает 5 с, а в конце часового обхода загруженный сервер тоже может не ответить — и получал ярлык «умер», после чего инструкция велит не заводить карточки, то есть настоящая находка списывалась бы на стенд. Теперь три попытки, таймаут 20 с, и причина РАЗДЕЛЕНА: «соединение отклонено» против «нет ответа за 20 с». Обе печатаются в сообщении.
- **Послеполётный блок больше не печатается после отказа предполётной.** Playwright зовёт уборку и когда `globalSetup` бросил, и прогон печатал сначала одну внятную строку, а следом громкий блок «падения этого прогона — про стенд», хотя не выполнилось ни одной пробы. Отметка `STAND_PREFLIGHT_FAILED`. **Проверено:** прогон по мёртвому :3198 — блок в выводе 0 раз.
- **Не сделано намеренно:** признак принадлежности стенда (третий пункт карточки). Ревью показало, что без `NEXT_MANUAL_SIG_HANDLE` он был недостижим в принципе; теперь достижим, но это отдельная работа — заведу карточкой.
- **Гейт:** `npm run gate:front` — код 0. Живые пробы по проверочному стенду :3198 — `tables-data` + `ui-access-rule` = **13 passed**.
- **Коммит `c7b68a08`, запушен** (`e2ac5f00..c7b68a08`, `git show --stat` показал ровно четыре моих файла). Карточка №823 вернулась в `Review`. Третий пункт карточки — признак принадлежности стенда — заведён отдельной карточкой **№832** вместе с гипотезой SIGHUP.

## 06.09.2026 — №836: один стенд Django читался как два

- **Как нашлось.** Соседняя сессия завела подозрение «на :8100 два `runserver`, старый — сирота» и сама же его сняла, проверив родство: `ppid` младшего равен pid старшего. Проверено мной: pid 210476 (17 ч 43 мин) — родитель, pid 2207797 (11 мин) — его потомок.
- **Почему подозрение было закономерным, а не небрежностью.** Правило CLAUDE.md (пункт №764) велело проверять `ps -eo args | grep runserver` — БЕЗ `ppid`. А у стенда, поднятого правильно (без `--noreload`, как требует тот же пункт), эта команда печатает ДВЕ строки ВСЕГДА: родитель следит за файлами, потомок слушает сокет и перезапускается при каждой правке Python. Возраст у них всегда разный, и разница читается как «сирота рядом с новым».
- **Правлено.** В команду добавлены `pid,ppid,etime`, рядом — признак вслух: разные родители = два стенда; родитель и его потомок = один. Снята и вторая ловушка: «младший моложе — значит его только что подняли» здесь неверно, у потомка возраст обнуляется при каждой правке Python.
- **Цена, если бы не поймали:** «лишний» процесс погасили бы по pid, то есть заглушили бы рабочий стенд соседям. Тот же класс, что №44 (замеряли не тот процесс) и сам №764 (признак читается наоборот).
- **Коммит `88401d43`, запушен.** Карточка №836 → `Review`.

## 06.09.2026 — №811 (возврат из Review по ревью): скрипт мутаций выдавал прерванную и сломанную проверку за пройденную

- **Откуда взялось.** Ревью коммита `53d1da33` по задаче №825. Замысел признан верным и не менялся: замок берётся ДО порчи файла через самоперезапуск, литеральная замена без `sed`, обязательный базовый прогон, восстановление из КОПИИ (а не `git checkout`, который снёс бы чужую незакоммиченную работу). Но нашлись два способа получить неверный ответ и один — испортить общее дерево молча.
- **🔴 ПРЕРВАННАЯ ПРОВЕРКА ВЫГЛЯДЕЛА ПРОЙДЕННОЙ.** Обработчик `INT`/`TERM`, который не выходит сам, ВОЗВРАЩАЕТ управление следующей строке. Ctrl-C на прогоне с мутацией уводил pytest в ненулевой код, `if` не срабатывал — и скрипт печатал «✅ мутация поймана» с кодом 0. **Воспроизведено на минимальном примере той же формы:** прежняя ловушка — «✅ мутация поймана», код 0; новая — «ПРЕРВАНО СИГНАЛОМ», код 143. Добавлен `HUP`: закрытая вкладка и оборванный ssh убивают процесс БЕЗ выполнения `EXIT`.
- **🔴 КРАСНОТА ПО ПОСТОРОННЕЙ ПРИЧИНЕ СЧИТАЛАСЬ ДОКАЗАТЕЛЬСТВОМ — и здесь замер поправил само ревью.** Ревьюер предлагал различать коды возврата pytest (1 — упали тесты, 2 — ошибка сбора). Замер показал, что этого мало: мутация, сделавшая файл неразбираемым, дала код **1**, а не 2, — импорт в этом коде идёт ВНУТРИ функции, и pytest посчитал такое обычным падением («4 failed»). То есть по одному коду отличить нельзя. Теперь смотрится и ПРИЧИНА: `SyntaxError`/`IndentationError`/`ImportError`/`INTERNALERROR` или ошибки сбора в выводе — «проверка НЕ состоялась». Проверено обоими прогонами: осмысленная мутация ловится по-прежнему, неразбираемая отбивается.
- **🔴 НЕУДАВШАЯСЯ КОПИЯ ОСТАВЛЯЛА СЛОМАННЫЙ ФАЙЛ В ОБЩЕМ ДЕРЕВЕ МОЛЧА.** `cp -p` не проверялся: при отказе скрипт записывал путь несуществующей копии, ломал файл и тихо не восстанавливал — ровно то, что он призван предотвращать. Теперь отказ копии — выход ДО порчи, а несуществующая копия при восстановлении кричит.
- **Дописано:** подбор сирот (копия мёртвого прогона восстанавливается на старте по `kill -0`, тем же приёмом, что у замка); `PYTEST_MUTATE_LOCKED` снимается сразу — он экспортирован и наследовался pytest, так что вложенный вызов пропустил бы взятие замка и портил файлы БЕЗ него; неоднозначный `--old` (встречается больше раза) — отказ, иначе ломалось первое вхождение и скрипт ложно обвинял хорошую пробу; символическая ссылка — отказ (восстановление через `mv` заменило бы саму ссылку файлом); восстановление каждого файла печатается строкой; копии в `.gitignore` (прецедент №241).
- **Проверка на живом предмете.** Скрипт в этом же заходе прогнал шесть мутаций по №451 и №811 — все с верным вердиктом.
- **Коммит `4c699148`, запушен.**

## 06.09.2026 — №843: полный смоук перестал зависеть от того, что соседи делают с деревом

**Предмет.** Рабочий стенд Django :8100 поднят БЕЗ `--noreload` — и это правильно (№764: с флагом сервер не подхватывает правки Python вовсе, и признак читается наоборот). Но у автоперезагрузки есть вторая сторона: ЛЮБАЯ правка Python в дереве перезапускает сервер и рвёт все открытые соединения проб. В дереве, где работают три-четыре сессии, за восьмиминутный прогон это происходит гарантированно. Замер карточки: два прогона по одному коду — в первом ноль `ECONNREFUSED`, во втором ВСЕ ЧЕТЫРЕ падения по обрыву.

**Сделано.**

- **`Personnel-Records/scripts/smoke-backend.sh`** — отдельный бэкенд для прогона: свой порт (:8101 по умолчанию), `--noreload`, поднят из СВЕЖЕЙ выкладки `git worktree` по коммиту (`REF`, по умолчанию `HEAD`). Надзиратель тот же, что у `prod-stand.sh` (№823): держит сервер своим ребёнком, `wait` отличает «сняли сигналом» от «упал сам», строка уходит в лог. Порт занят — отказ, а не второй сервер. `--stop` гасит и убирает выкладку.
- **Рабочий каталог сервера — тоже выкладка.** Импорты Django берёт от каталога `manage.py`, и они были бы верны и без этого, но всё, что сервер открывает относительным путём, уходило бы в рабочее дерево. Найдено замером: без `cd` у процесса `/proc/<pid>/cwd` показывал рабочее дерево.
- **🔴 Попутно найдено то, без чего вся затея не работала бы вовсе: `BACKEND_URL` — переменная СБОРКИ, а не запуска.** `rewrites()` из `next.config.js` Next исполняет во время `next build` и кладёт готовые адреса в `routes-manifest.json`. `prod-stand.sh` передавал `BACKEND_URL` только серверу — то есть на проксирование она не влияла НИКАК. Замер: в `.next-prod/routes-manifest.json` стояло `http://127.0.0.1:8100/...` при любом значении переменной у процесса. Теперь сборка идёт С этой переменной, а `--no-build` сверяет запечённый адрес с запрошенным (по хосту и порту, `localhost` = `127.0.0.1`) и ОТКАЗЫВАЕТСЯ поднимать стенд, который ходил бы не туда, куда его позвали.
- **`npm run stand:isolated` / `npm run smoke:isolated`** — свой порт (:3109), свой каталог сборки (`.next-isolated`, внесён в `.gitignore`), свой `SMOKE_API`. Обычный прод-стенд :3108/`.next-prod` не задет ничем.
- **`SMOKE_API` оказался обязательной половиной ответа.** Спеки ходят в бэкенд не только через прокси фронта, но и НАПРЯМУЮ (`const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'` — так во всех живых спеках). Перевести один фронт мало: без `SMOKE_API` проба честно шла на :8100 мимо изоляции.

**Замеры (не обещания).**

- Сервер поднят из выкладки: `/api/schema/` → 200, `/api/operations/statuses/` без токена → 403.
- Модуль берётся ИЗ ВЫКЛАДКИ: тем же вызовом `organization_management.__file__` = `/tmp/smoke-backend-8101/Backend/.../organization_management/__init__.py`.
- `--noreload` работает: правка Python внутри выкладки — pid не изменился (2683712 до и после), ручка отвечает 200.
- Сторож запечённого адреса краснеет: запрошен :8101, запечён :8100 → отказ с кодом 1 и обеими цифрами в сообщении. Контроль: запрошен :8100 при запечённом :8100 → стенд поднялся, `GET /` → 200.
- Изоляция подтверждена сквозным прогоном: сборка на :8101 → в манифесте `http://localhost:8101`; `route-map-coverage` + `my-profile` по этому стенду — **13 passed**, лог бэкенда :8101 вырос 142 → 2998 строк, то есть прогон обслуживал именно он.
- **Болезнь поймана вживую по ходу починки:** первая попытка того же прогона БЕЗ `SMOKE_API` дала 1 failed с `connect ECONNREFUSED 127.0.0.1:8100`, и в этот же момент потомок `runserver` на :8100 сменился (2679685 → 2693911, возраст 30 с). С `SMOKE_API=http://127.0.0.1:8101` — 13 passed.
- Гейт фронта: `tsc --noEmit` код 0, `check:rewrites` — 16 префиксов покрыты, `check:shots` — чисто, прод-сборка прошла.

**Уборка.** Оба проверочных стенда погашены (`СНЯТ СИГНАЛОМ 15` в логах), выкладка убрана, проверочный каталог сборки `.next-smoke843` удалён.
- **Коммит `2b25928b`, запушен** (`git status -sb` — ветка в ноль с `origin`; `git show --stat` — ровно 4 файла, 240 вставок, чужого не унесено). Карточка №843 → `Review`.

## 06.09.2026 — №835: соседей считает и прод-стенд, а считающая часть покрыта пробой

Находка ревью №817 (задача №825): две вещи, названные тем ревью и сознательно не сделанные в том заходе.

- **1) Прод-стенд поднимался в переполненную машину молча.** `scripts/prod-stand.sh` спрашивал только «занят ли мой порт», а памяти берёт реально: 145-320 МБ сам сервер и ГИГАБАЙТЫ во время сборки. Ровно то положение, из которого OOM-killer снимает чужие прогоны, а признак читается не как нехватка памяти, а как «я сломал свою правку».
- **Общий дом `scripts/neighbours.sh`.** Фильтр `comm`, разбор порта, список соседей, сумма, бюджет машины, обе причины отказа и поимённый разбор «толстого» соседа переехали из `dev-guard.sh` в файл, который читают ОБА сторожа. Копия во втором скрипте означала бы два места, где правку забудут: `comm` у Next меняется от версии, и один устаревший фильтр молча перестал бы видеть соседей.
- **2) Считающая часть теперь покрыта пробой** — `scripts/tests/neighbours-test.sh`, 17 проверок. Источник строк процессов (`NEIGHBOURS_PS`), справка о портах (`NEIGHBOURS_PORT_OF`) и `meminfo` подставляются фикстурами: проба не трогает ни одного живого процесса. Проверяются сумма, отбор (посторонние процессы не в счёт), пустой случай, отличие сироты от чужого рабочего сервера, обе причины отказа, «память не померилась — не отказ», поимённый толстый сосед и пропуск своих pid.
- **Проба включена в гейт** — `npm run check:stand` внутри `gate:front`, рядом с `check:rewrites` и `check:shots`: проба, которую никто не гоняет, хуже отсутствующей.
- **Три мутации, все красные:** устаревший фильтр `comm` → 6 проверок падают (это и есть тихий дефект, ради которого файл заведён: сумма становится нулём, и оба сторожа пропускают переполненную машину); сирота и чужой сервер названы одинаково → падает различение; отказ по неизмеренной памяти (`available = 0`) → падает «не отказ».
- **Проверено на живой машине обоими скриптами:** при заниженном бюджете и dev-сторож, и прод-стенд печатают ОДИН и тот же список пяти соседей (4012 МБ) и отказываются подниматься, каждый со своим способом перекрыть решение (`DEV_GUARD_ALLOW_NEIGHBOURS=1` / `PROD_STAND_ALLOW_NEIGHBOURS=1`).

**🔴 Попутно найдено на себе: `kill` по обёртке НЕ гасит сервер.** В списке соседей обнаружился мой же мок-сервер на :3107 — 1423 МБ, возраст 13 минут, — который я считала погашенным: я сняла процессы `next dev -p 3107`, а держит память и порт их потомок `next-server`. Это та самая «вторая половина №122» (забытый мок-сервер рядом со стендом), и попалась она мне ровно потому, что новый список соседей печатает порт. Погашен по PID; урок — гасить надо `next-server`, а не обёртку, и проверять `ss -ltnp | grep <порт>`, а не «команда отработала».
- **Гейт и коммит по №835:** `npm run gate:front` (теперь с `check:stand`) — код 0. Коммит `ab7e36cb`, запушен. Перед коммитом сверен `git diff HEAD` по трём отслеживаемым файлам — чужих хунков нет.

## 06.09.2026 — №832: стенд сам говорит, кто его поднял

Находка ревью №823 (задача №825). Третий пункт той карточки стал достижим только после `NEXT_MANUAL_SIG_HANDLE=1` (коммит `c7b68a08`): пока обычный `kill` давал «вышел сам, код возврата 0», вопрос «кто снял» не имел смысла.

- **Что было.** «Лишний» `next-server` в списке опознавался ДОГАДКОЙ: порт есть — «наверное, чужой прогон, спрошу»; порта нет — «наверное, сирота». Спросить было не у кого поимённо, а гасить чужой рабочий стенд правила запрещают. Признак принадлежности отсутствовал вовсе.
- **Что сделано.** Метка `/tmp/next-stand-<порт>.owner`: pid, вид стенда (`dev`/`prod`), владелец (`STAND_OWNER`, если сессия его задала, иначе пользователь), pid и имя родителя, время подъёма. Пишут её ОБА сторожа при подъёме, снимают при остановке — dev-сторож в `stop_server`, прод-стенд в надзирателе (путь передан аргументом: надзиратель живёт в своей сессии и общий дом не подключает). Та же строка идёт в первую строку лога.
- **Ключ — ПОРТ, а не pid**, и это не мелочь: в списке соседей стоит `next-server`, то есть ПОТОМОК обёртки, и его pid с записанным не совпадёт никогда. Порт же — ровно то, по чему сосед и опознаётся.
- **Метка мёртвого стенда называется протухшей, а не отбрасывается молча.** Файл в `/tmp` переживает свой сервер, и «поднял такой-то» про несуществующий процесс увело бы разбор к живому человеку вместо сироты. Проверка — `kill -0` по записанному pid.
- **Проверено на живой машине end-to-end:** прод-стенд поднят на :3195 с `STAND_OWNER=проба-832` → метка на диске содержит все пять полей; список соседей печатает «слушает :3195 — поднял проба-832, prod, 2026-09-06 11:49:03»; после `kill` метка снята, в логе «СЕРВЕР ОСТАНОВЛЕН … СНЯТ СИГНАЛОМ 15». Порт после уборки свободен, посторонних процессов не осталось.
- **Проба выросла до 22 проверок** (`scripts/tests/neighbours-test.sh`, в гейте): метки нет — справка пуста; метка пишется файлом по порту; живая называет владельца и вид; список соседей её печатает; протухшая названа протухшей; метка снимается. Прежний пин «слушает … — может быть чужим прогоном» переписан на новое поведение осознанно: строка теперь называет владельца, а «сперва спросите» остаётся только там, где владелец не назвался.
- **Гейт и коммит по №832:** `npm run gate:front` — код 0. Коммит `682b9732`, запушен.

## 06.09.2026 — №830: боевой запуск переведён на ASGI, gunicorn объявлен

Решение заказчика 06.09.2026: перевести запуск на ASGI (gunicorn с воркером uvicorn). Карточка заведена мной же в ходе №804/№806 — вторая половина той работы: объявить зависимость мало, если её никто не запускает.

- **Что было не так, две вещи сразу.** (1) `Dockerfile` и `docker-compose.yml` звали `gunicorn`, которого нет НИ В ОДНОМ файле зависимостей: образ ставил зависимости и запускал бинарь, которого в них не значилось. (2) Команда была `config.wsgi:application` — WSGI, а он веб-сокет не обслуживает НИКАК. `ASGI_APPLICATION`, маршрут `/ws/operations/notifications/` и слой каналов существовали и не выполнялись: до ASGI-приложения запрос просто не доходил. То есть объявление `channels-redis` (№804) ничего не включало — обслуживать было некому.
- **Что сделано.** `gunicorn` объявлен в `base.txt` (`>=23.0`) и закреплён в `requirements.txt` (`==26.2.0`, версия снята разрешателем `pip download --no-deps`, а не придумана; обязательных зависимостей у пакета нет). Команда в обоих файлах — `gunicorn config.asgi:application -k uvicorn.workers.UvicornWorker`. `--keep-alive` снят намеренно: у асинхронных воркеров gunicorn его не применяет.
- **Проверено фактом, а не памятью:** модуль `uvicorn/workers.py` в закреплённой версии 0.52.4 ПРИСУТСТВУЕТ (разобрано колесо пакета — были основания думать, что его убрали в 0.30+). ASGI-приложение импортируется: `ProtocolTypeRouter`.
- **Устаревшая оговорка снята вместе с причиной.** В `base.txt` стояло «объявление — ещё не запуск: боевой контейнер запускает WSGI». Теперь это неправда, и строка переписана: оставить её значило бы, что файл врёт про себя.
- **🔴 Третья дверь в тот же отказ закрыта пробой.** У `test_production_dependencies.py` были сторожа на импорты боевого кода и на строки настроек. Команда запуска контейнера — не импорт и не настройка, и через неё оба дефекта и прошли. Добавлены две проверки: «команда запуска зовёт только объявленное в base.txt» и «боевой контур поднимает ASGI, а не WSGI». Вторая держит РЕШЕНИЕ, а не форму команды: сменить gunicorn на голый uvicorn можно, вернуться к `wsgi:application` — нельзя без нового решения заказчика.
- **Мутации, обе красные:** возврат `config.wsgi:application` в `Dockerfile`; `gunicorn`, закомментированный в `base.txt`.
- **Чего проверить нельзя и это названо вслух:** сборкой образа правка здесь не проверялась — боевого контура нет, docker для приложения не поднимается. Проверено то, что проверяемо: импорт ASGI-приложения, наличие модуля воркера в пинах, согласие команды запуска с объявленными зависимостями (пробой).
- **Гейт и коммит по №830:** `pytest apps/operations` — **3599 passed, 261,21 с**. Коммит `728b8ce4`, запушен. **Первый прогон этого гейта был УБИТ системой из-за нехватки памяти** (на машине четыре next-сервера на 2837 МБ, свободно 2156): прогон не упал ассертом, он ИСЧЕЗ — признак стоит помнить, он читается как «что-то странное», а не как нехватка памяти. После уборки (сирота 18,5 ч мной, запрещённый второй dev-сервер :3199 соседней сессией) прогон прошёл с первого раза.
- **Дополнение к №832** (коммит `960528bc`): поле метки `ppid` переименовано в `ppid-скрипта`. Находка соседа: оба сторожа поднимают сервер через `setsid`, и у ВСЕХ таких процессов родитель один — `systemd --user`; по ppid работающего стенда нельзя ни привязать его к сессии, ни отличить сироту от живого. Сосед на этом едва не обманулся. Признак, работающий вместо ppid, — молчание лога и отсутствие соединений.

## 06.09.2026 — №888: воркер взят из пакета `uvicorn-worker`, и сторож научился видеть команду целиком

Находка ревью по моему же коммиту `728b8ce4`. Решение заказчика 06.09.2026: перейти на `uvicorn-worker`; отвергнуто «прижать верхнюю границу uvicorn» (вопрос вернулся бы при первом же обновлении зависимостей и держался бы на памяти о том, зачем граница стоит).

- **Что было не так с моим комментарием.** Я написала «модуль `uvicorn/workers.py` ПРИСУТСТВУЕТ — проверено разбором колеса, а не памятью». По букве верно, и читатель выносил отсюда «тревога была напрасной». Тревога была НАПОЛОВИНУ верной: модуль на месте, но первым же оператором печатает «deprecated, use `uvicorn-worker` instead». Сначала это было названо вслух (`a64ed570`), потом закрыто по существу.
- **Что сделано.** `uvicorn-worker>=0.4.0` объявлен и закреплён (`==0.4.0`), команда в `Dockerfile` и `docker-compose.yml` — `-k uvicorn_worker.UvicornWorker`. Требования пакета сверены с нашими пинами: `uvicorn>=0.36` (у нас 0.52.4), `gunicorn>=21` (у нас 26.2.0). Имя класса взято из списка экспортов пакета, а не угадано по имени.
- **Новый сторож** — «класс воркера из объявленного пакета». Он спрашивает не «существует ли класс» (нечем: пакета в окружении нет), а «объявлен ли пакет, из которого он берётся» — ровно то, что проверяемо на нашей стороне, и ровно то, чего не хватало: `-k <модуль>.<Класс>` не является ни импортом, ни настройкой, ни исполняемым именем.

**🔴 ДВЕ СЛЕПОТЫ СТОРОЖА ПОДРЯД, И ОБЕ НАШЛА МУТАЦИЯ, А НЕ ЧТЕНИЕ.** Это главное из карточки:

1. **Читалась только первая строка команды.** `CMD` в `Dockerfile` перенесён обратным слэшем, и `-k` стоит на ВТОРОЙ строке — сторож её не видел вовсе. Мутация «вернуть устаревший модуль» прошла зелёной. Починено склейкой продолжений.
2. **Разделителем считался только пробел.** В `Dockerfile` команда записана JSON-массивом (`"-k", "uvicorn_worker.UvicornWorker"`), то есть между флагом и значением стоят кавычка и запятая. После починки склейки та же мутация СНОВА прошла зелёной — регулярка находила класс только в `docker-compose.yml`, где команда однострочная.

Обе слепоты тихие: сторож «работает», часть файлов проверяет, и по выводу неотличим от полного. Вывод для следующих сторожей: мутацию надо ставить в КАЖДОМ файле, который сторож обязан читать, а не в одном.
- **Гейт и коммиты по №888:** `pytest apps/operations` — **3601 passed, 244,05 с**. Коммиты `a64ed570` (оговорка про устарелость) и `bd605620` (переход на пакет), оба запушены.

## 06.09.2026 — №826 и №871: два решения заказчика по правилам и уборке

- **№826 (коммит `9200140a`).** В составе полного прогона стояло «⚠️ `seed_expense_chain` по умолчанию сдаёт день… Перед смоуком звать ЕГО с `--no-submit`». «Его» прочли как ближайшую названную команду — `seed_smoke_fixtures`, — у которой такого флага НЕТ: полный прогон 06.09.2026 начался с `unrecognized arguments: --no-submit`. Дефект был не в факте (факт верен), а в том, что местоимение допускало два прочтения и неверное стояло ближе. Команда названа по имени, оговорено, у какой флага нет, приведён текст отказа. Правило меняется только словом заказчика — оно получено.
- **№871.** Решение: не трогать `git prune`/`git gc`, пока в дереве живут четыре сессии. Карточка оставлена ОТКРЫТОЙ с условием возврата, а не закрыта: «отложено» и «сделано» — разные состояния, и путать их в трекере нельзя.

## 07.09.2026 — заливка веток в main и переподъём стендов (устная задача заказчика)

- **Слито в main только `feat/frontend-battle-modules`** — fast-forward, 479 коммитов, main целиком в неё входила. Ссылка обновлена через `git update-ref refs/heads/main feat/frontend-battle-modules` БЕЗ переключения ветки: в дереве лежали 7 незакоммиченных файлов (возможно чужой сессии), заказчик выбрал их не трогать, а `checkout main` унёс бы их за собой. Пуш: `3a351ed0..54a1d868 main -> main`, `git rev-list --left-right --count origin/main...main` → `0 0`.
- **Остальные 11 «впереди» веток НЕ вливались** — выбор заказчика из трёх вариантов. Это `archive/*` (июль-август), `claude/awesome-jemison`, `claude/frosty-villani`, `claude/gifted-tharp`, `claude/hungry-leavitt`, `claude/inspiring-feistel`, `e3-catchup-clock-concurrency`, `feat/prototype-skin`, `orphan/duty-calendar-stage8`. Все отстают от main на 700-1300 коммитов и тянут удалённый `Backend/VAPS`; отвергнуты варианты «плюс свежие боковые» и «все 30 веток».
- **Django-стенд :8100 поднят заново, БЕЗ `--noreload`** (две строки `runserver`: 16103 родитель, 16104 потомок — это ОДИН стенд). Первый запуск упал: `manage.py` по умолчанию берёт `settings.production`, а та требует `DJANGO_SECRET_KEY` (`ImproperlyConfigured`). Поднят с `DJANGO_SETTINGS_MODULE=organization_management.config.settings.local_postgres`.
- **Непрогнанные миграции найдены и прогнаны:** `migrate --check` давал код 1, висели `operations.0098_backfill_actor_display_signatures`, `0099_backfill_approval_remark_id`, `0100_notification_kind_forces_request_department` — то есть слитый в main код уехал впереди базы стенда. После `migrate` — код 0.
- **Фронт-стенд :3106** поднят `npm run dev:guard`: pid 14712/14748, потолок сторожа опущен до 3362 МБ из-за чужого `next-server` pid 3543 (138 МБ) — это процесс ВНУТРИ docker-контейнера (родитель `containerd-shim`), не сирота стенда, гасить его не надо.
- **Проверка живая:** `curl` → `/` на :3106 = 200, `/api/schema/` на :8100 = 200, Plane :8090 = 200. **RSS `next-server` после подъёма — 1 376 912 КБ** (порог 2500000 не превышен).

## 07.09.2026 — №769: Obsidian_brain подтверждён обязательным вторым мозгом

- **Исполнитель: Кодекс Астра 6.** Заказчик повторно и явно потребовал считать `/home/erda/Музыка/Obsidian_brain` обязательным вторым мозгом. Карточка Plane №769 возвращена из `Review` в `In Progress` для уточнения уже действующего правила, без создания дублирующей карточки.
- Причина уточнения: путь уже был записан в `AGENTS.md`, но формулировка должна прямо называть его **обязательным полем каждой работы**, чтобы правило нельзя было принять за справочную рекомендацию.
- `AGENTS.md` уточнён точечно: поле считается заполненным только после записи результата в проектный vault; без неё работа не завершена. Проверка документа: `git diff --cached --check -- AGENTS.md` — код 0; в индексе был только `AGENTS.md` (`4 строки: 2 добавлены, 2 удалены`). Гейты приложения не запускались, потому что код приложения не менялся.
- RSS основного `next-server` перед закрытием — **2 315 724 КБ**, ниже порога 2 500 000 КБ; перезапуск не нужен. Коммит `8f07a0dd` запушен в `origin/feat/frontend-battle-modules` (`2c4377df..8f07a0dd`). Карточка №769 возвращена в `Review`; `On test` и `Done` не выставлялись.

## 2026-09-07 22:35 — перезапуск бэка и фронта по слову заказчика

- Погашены по PID: `next dev` :3106 со сторожем (next-server pid 194559, RSS 2 360 144 КБ — под самым порогом 2500 МБ) и Django :8100 (родитель 11326 + потомок 192052). Чужой прод-стенд :3108 (pid 195588, метка «erda, prod, 21:53») не тронут.
- Django :8100 поднят `DJANGO_SETTINGS_MODULE=organization_management.config.settings.local_postgres .venv/bin/python manage.py runserver 0.0.0.0:8100` БЕЗ `--noreload` (Plane №764); первая попытка без переменной упала на `production.py` («DJANGO_SECRET_KEY must be set») — настройка по умолчанию в `manage.py` не стендовая. Две строки `runserver` (родитель 220529, потомок 220531) — один стенд. `/api/schema/` → 200. Лог `/tmp/claude-1000/django-8100.log`.
- `next dev` :3106 поднят `npm run dev:guard` (next-server pid 219349, старт 1 437 780 КБ), `/` → 200. Сторож видит сироту pid 3854 (82 МБ, порта нет) — это процесс внутри docker-контейнера (родитель containerd-shim), не наш, не гашен.

## 2026-09-08 — Wiki проекта по коду (промпт wiki-generation-prompt.md), этап 1
- Заказчик поручил прогнать `/home/erda/Музыка/wiki-generation-prompt.md`. Карточка заведена в Plane (`Backlog`): «Wiki проекта по коду: Use Case и Project Backlog в docs/».
- Этап 1 (разведка без записи файлов) выполнен тремя разведчиками: бэкенд, фронт, инфраструктура. Таблица из 38 UC в 9 модулях выведена заказчику в чат; ждём подтверждения списка — по промпту файлы до подтверждения не создаются.
- Находки этапа: `.gitignore:229` игнорирует `docs/*` (новые `docs/overview.md`, `docs/Project-Backlog.md`, `docs/usecases/` потребуют негейта или `git add -f`); `docs/api-gaps.md` и `docs/README.md` не затрагиваются; `docs/usecases/` не существует.
- Этапы 2–3 выполнены: `docs/overview.md`, `docs/Project-Backlog.md`, `docs/usecases/` — 38 UC в 9 модулях (GEN 3, ORG 4, STS 5, EXP 5, EVT 8, OBJ 3, RAT 3, DOC 2, ADM 5); итог 16 Done, 22 Partial, 0 Planned. Проверка: 38 ссылок → 38 файлов, каждый ровно один раз, разделы шаблона и шапки сходятся, счётчики совпадают. Гейт по глубине правки — «текст в доке»: ничего. Коммит `e62caeee`, ветка `feat/frontend-battle-modules`, пуш выполнен. Карточка №1028 → `Review`.
- Четыре UC получили статус ниже предварительного после чтения кода: EXP-003, EXP-004, EXP-005 (бэкенд без UI, нет расписания), GEN-002. Крупные кросс-модульные находки из «Открытых вопросов» бэклога: `AuditMiddleware` практически не пишет HTTP-аудит для `/api/ops/*` и `/api/operations/*` (ContentType по URL не находится); `/api/audit/logs/` открыт любому вошедшему без `audit.view`; клиентский WS не доходит до потребителя раздела (маршрут, токен, формат кадра); `CELERY_BEAT_SCHEDULE` отсутствует — фоновые задачи сами не запускаются. Карточки по ним в «Предложено Claude» не заводились: заказчик их читает в бэклоге, разложение по карточкам — отдельным решением.

## 08.09.2026 — №1033: Codex переключён с ChatGPT на API-ключ

- **Исполнитель: Кодекс Астра 6.** До изменения: `codex login status` → `Logged in using ChatGPT`; переменные `OPENAI_API_KEY` и `CODEX_ACCESS_TOKEN` в окружении не заданы, переопределения провайдера в `~/.codex/config.toml` нет.
- Защищённый источник `/home/erda/Музыка/.env` имеет режим `600` и содержит `Bearer <OpenAI project API key>`. Через stdin штатной команде передано только значение после удаления префикса `Bearer`; секрет не печатался и не переносился в vault или репозиторий.
- После изменения: `codex login --with-api-key` → `Successfully logged in`; `codex login status` → `Logged in using an API key - sk-proj-***LzVgA`. По официальной документации OpenAI этот режим использует usage-based API billing вместо кредитов плана ChatGPT.
- Код и стенды не менялись; гейты приложения и коммит не применимы. Plane №1033: `Backlog` → `In Progress` → `Review`; дальше самостоятельно не переводится.
- **Закрытие №1033.** Контроль авторизации повторно дал `Logged in using an API key - sk-proj-***LzVgA`; проверка четырёх обновлённых заметок на точное значение секрета — `vault secret scan: clean`. RSS рабочего `next-server` — **2 100 212 КБ**, порог 2 500 000 КБ не превышен. Первый запрос комментария к Plane через `activities/` вернул 405 без создания записи; фактический endpoint установлен через `OPTIONS` как `comments/`, повтор дал `HTTP 201`, activity `ba0ca539-40fd-44e0-9bd9-58754cb91ccb`. Карточка №1033 переведена в `Review`. Штатный `apply_patch` для внешнего vault дважды упал до записи из-за `bwrap: loopback: Failed RTM_NEWADDR`; применено идемпотентное добавление с проверкой уникальных маркеров. Код и стенды не менялись; коммита и пуша нет. Исполнитель: Кодекс Астра 6.
- **Финальная сверка №1033.** Первый read-only GET карточки после закрытия вернул 404 из-за опечатки исполнителя в UUID проверки; данных и состояния это не меняло. Повтор с UUID `9807c8b7-b4f6-45fa-80de-b1db3285612e` подтвердил: `Plane #1033: state=Review`. Одновременно: `codex login status` → `Logged in using an API key - sk-proj-***LzVgA`; уникальные маркеры записей в Backlog, Changelog, Status и Decisions — по одному. Исполнитель: Кодекс Астра 6.
- Документация №1028 дополнительно передана на локальный GitLab (10.115.70.74): ветка `feat/frontend-battle-modules`(40 на GitLab) там разошлась с GitHub независимой историей (свои коммиты Plane №940-№951, наших №880/№895/№921/№1028 там нет) — форс-пуш её бы уничтожил. Сделано без прикосновения к общему рабочему дереву (там незакоммиченные правки другой сессии): отдельный `git worktree`, ветка `docs/wiki-usecases-1028` от текущего кончика `feat/frontend-battle-modules` на GitLab, докс-коммит перенесён cherry-pick поверх (конфликт по `.gitignore` — на GitLab он не отслеживается вовсе, разрешён как есть), запушено новой веткой, worktree удалён. Ссылка на создание merge request: http://gitlab.local/erda05508/smart-josparlau/-/merge_requests/new?merge_request%5Bsource_branch%5D=docs%2Fwiki-usecases-1028

## 08.09.2026 — №1020: plane_task.py больше не молчит на неизвестном --state

- **Взята №1020 (`medium`):** `Предложено Claude` → `In Progress`. Источник: при заведении №1018 команда получила несуществующее после переименования колонки имя «Предложено Codex»; `_create` не нашёл `state_id`, молча исключил `state` из тела запроса, Plane завёл карточку в `Backlog` по умолчанию, а CLI напечатал ложное «заведено [Предложено Codex]». `/home/erda/plane/migration/plane_task.py` лежит ВНЕ репозитория Smart Josparlau — `git status` в `/home/erda/plane` отвечает «не найден git репозиторий», поэтому закрытие карточки идёт без коммита/пуша: гейт — ручная проверка (у скрипта нет тестовой обвязки).
- **Фикс:** `_create` при `state_id is None` теперь падает `SystemExit` с текстом, перечисляющим известные имена состояний, ДО POST-запроса — карточка вообще не заводится (было: заводилась молча не в том состоянии).
- **Проверка (вместо pytest — обвязки нет):** `add … --state "Несуществующее Состояние"` → код возврата 1, сообщение называет все семь известных состояний; список задач подтверждён без спорной карточки (`list` не находит её). Тот же вызов с валидным `--state "Предложено Claude"` по-прежнему заводит карточку как раньше (создана для проверки идемпотентности и сразу удалена через прямой `DELETE /issues/{id}/` — постоянных следов не осталось).
- **Git:** неприменим — путь вне репозитория Smart Josparlau, коммита и пуша нет.
- **Plane №1020 → `Review`.** Комментарий «было/стало» оставлен в карточке; `On test`/`Done` не выставлялись. RSS `next-server` :3106 — измерен как обычно (см. запись по соседней карточке того же дня), фронт этой правкой не тронут.
- **09.09.2026 — Plane №1052, squash опубликованной проходки:** 110 коммитов после `54a1d868` сведены в один **`81b3a0e4`** без изменения итогового tree. Ошибочный soft-reset сначала попал в грязный основной checkout, но был остановлен до коммита/пуша и полностью восстановлен `git reset --mixed ebc61a3e`; исходные modified/untracked файлы сохранились. Фактический squash выполнен в отдельном `/tmp/sj-squash-1052`, затем три remote ref переписаны через `--force-with-lease`. **Исполнитель: Кодекс Астра 6.**
- №1052 после push: `git ls-remote` подтвердил один SHA **`81b3a0e4`** у трёх веток, `git rev-list --count 54a1d868..81b3a0e4` = **1**, `git diff 343e0909 81b3a0e4` = exit 0. RSS живого dev `next-server` — **434060 КБ**; Plane compose пересобран, сервисы Running/Started. **Исполнитель: Кодекс Астра 6.**
## 09.09.2026 — №965: защита RAW-канона

Карточка оказалась частично устаревшей после №974: точное сравнение со всеми шестью актуальными секретами из `~/.config/vaps/` показало по каждому `EXACT_OCCURRENCES 0`, то есть действующих значений в `RAW/README.md` уже нет. Остаточный дефект подтверждён `stat`: файл оставался `664`. Режим изменён на `600`; повторный `stat` показал `MODE=600`, повторная проверка — `SECRET_VALUE_MATCHES []`. Содержимое RAW не переписывалось, секреты в вывод и Plane не копировались. Изменён только режим внешнего vault, поэтому git-коммита нет. Исполнитель: Кодекс Астра 6.
## 09.09.2026 — №825: read-only ревью №1062

Замечаний нет. Независимо сверены ancestry `81b3a0e4 → a942649d → a3303cf3`, одинаковый tree squash `81b3a0e4` и исходного `343e0909`, вхождение №1049 `3040dbb3` и №982 `557ff464`, синхронность main/origin и восстановимость safety refs `3fdaddc5`/`3eb07a82`. План и Changelog содержат согласованные гейты, миграции, remote SHA и удаление worktree. Plane-комментарий ревью: `6224b1d7-0044-482a-821d-9381c5799fe5`; статус №1062 не менялся. Текущие более поздние временные worktree не считаются дефектом исторического завершения. **Исполнитель: Кодекс Астра 6.**
## 09.09.2026 — №825: read-only ревью №1051/№1052

Обе интеграционные карточки прошли без замечаний. Для №1051 подтверждены conflict-free fast-forward до `3eda7d19`, состав требуемого линейного диапазона, гейты exact tip и remote main; комментарий `c95cd096-abee-4781-beb1-df82d989e551`. Для №1052 подтверждены одинаковый tree `81b3a0e4`/`343e0909`, заменённый диапазон 110 коммитов, восстановимость refs, lease/push и соответствующие гейты; комментарий `5cdbce9b-32e1-46ee-8dff-ec23667479c2`. Статусы не менялись, тесты и сервисы в read-only ревью не запускались. **Исполнитель: Кодекс Астра 6.**


## 10.09.2026 — Plane №1107: новая сессия для каждой группы задач

Исполнитель: Кодекс Астра 6.

Прямое поручение заказчика: «для каждой группы задач с плэйн начинай новую сессию». При запуске разрешённой очереди каждая группа задач Plane выполняется в отдельной новой сессии Codex. Перед переходом фиксировать состав группы, выполненное, проверки, коммиты и блокеры в vault; новой сессии передавать номера карточек и ссылки на эти записи. Следующую группу в прежней сессии не начинать. Переход между сессиями не требует повторного разрешения на уже запущенную очередь. Само это поручение очередь разработки не запускает.

Карточка №1107 создана и переведена в In Progress; прочитаны индекс vault, состояние инфраструктуры, известные проблемы и действующее правило групп. Проверка: Plane вернул карточку 63c6d743-aad8-4b83-9ab8-8511e0b0a45a.


10.09.2026 — Plane №1107. Исполнитель: Кодекс Астра 6. Правило добавлено в AGENTS.md, пункт 0 раздела «Старт сессии / модуля». Самопроверка: git diff --check — exit 0; staged diff содержит только AGENTS.md, 1 добавленная строка. Коммит: 7de00c9ac1018f2ecf74accc9b01ff753fb0e51b. Изменения приложения не затрагивались, гейт приложения не требуется. Push отклонён автоматической проверкой: GitHub remote https://github.com/talasbekov/VAPS.git не подтверждён как доверенный для публикации внутренних инструкций. Ветка codex/om-walkthrough-1081-fixes без upstream. До разрешения публикации карточка остаётся In Progress, не Review. RSS стенда не определён: из sandbox процессы стенда не видны. Очередь разработки не запускалась.
## 10.09.2026 — Plane №1107: объединение ветки и чистый перезапуск

Исполнитель: Кодекс Астра 6.

По прямому поручению заказчика шесть коммитов ветки `codex/om-walkthrough-1081-fixes` и завершённые правки проходки №1081 объединены в один коммит поверх `origin/main`. Перед переписыванием создана страховочная ветка `backup/om-walkthrough-before-squash-20260910`; временные снимки и диагностические Playwright-файлы сохранены обратимо в `stash@{0}`. Итоговый коммит: `3736510016daf0f2e7d5fc7494ff072083066e30`.

Проверка итогового состояния: `npm run gate:front` — exit 0, TypeScript и production build прошли; целевой `test_ops_conduct_evaluations.py` после исправления обработки буквенного ID — `20 passed`; полный `pytest organization_management/apps/ops organization_management/apps/operations -q` — `5047 passed, 9 warnings in 535.12s`; локальный и удалённый SHA совпадают, `git rev-list --count origin/main..HEAD` вернул `1`, рабочее дерево чистое. Ветка опубликована в `origin/codex/om-walkthrough-1081-fixes`.

Стенд полностью перезапущен из текущего чистого каталога: Django PID 568105 слушает `0.0.0.0:8100`, `/api/schema/` отвечает 200; Next.js PID 570210 слушает `:3106`, `/security-ops/events/` отвечает 200. RSS после запуска: Django 121072 КБ, Next.js 818352 КБ. Старый `dev-guard` был остановлен по подтверждённой группе процессов; новый поднят через `npm run dev:guard`.
10.09.2026 — Plane №1107 переведена в `Review` после публикации и проверки. Исполнитель: Кодекс Астра 6.


## 10.09.2026 — Plane №1109: запуск постоянного мониторинга

Исполнитель: Кодекс Астра 6.
Прямое поручение заказчика. Карточка 482f01bb-91b1-415c-b7b2-58ca3eb98597 переведена в In Progress. Прочитаны AGENTS.md, индекс vault, Infrastructure/Status.md и Known-Issues.md. Проверка ss: :3106 и :8100 LISTEN; исходный Django PID 568105, RSS 120056 КБ, Next PID 583507, RSS 335160 КБ. Оба cwd в /home/erda/Музыка/Smart Josparlau. Next пишет /tmp/next-dev-3106.log; stdout/stderr Django направлены в /dev/pts/4, уточняется файловый журнал. Сервисы не перезапускались. Наблюдение — единственная выполняемая задача, очередь разработки этим поручением не запущена. Первичная проверка Plane ограничена sandbox; повтор с расширенным доступом успешен.


## 10.09.2026 — Plane №1109: подключены источники и постоянная проверка

Исполнитель: Кодекс Астра 6.
Подтверждён fd 3 Django PID 568105: organization_management/django.log в основном рабочем каталоге. Логирование root/django настроено в файл; stdout терминала не перехватывался. Размер журнала 23 101 706 251 байт, df: 93% занято, около 20 ГБ доступно; заказчик предупреждён, файл не удалён.
Операционный сборщик: /tmp/smart-josparlau-monitor-1109/monitor.py; курсоры и состояние status.json, поток агрегатов stream.jsonl, значимые события events.jsonl. Чтение с конца при первом старте, далее по смещениям; цикл 2 секунды, агрегаты каждые 10 секунд, определение смены inode/усечения и PID. Сырые строки не копируются: сохраняются фиксированные категории и числа. py_compile завершился кодом 0. Сервисы не перезапускались, код проекта не менялся, сборка/pytest неприменимы к подключению чтения журналов.
Heartbeat smart-josparlau-3106-8100 создан через Codex automation_update, ответ ACTIVE; проверка раз в минуту, уведомления только по новым значимым событиям. Наблюдение остаётся In Progress до команды заказчика.


### 10.09.2026 — №1109: фактическая проверка наблюдения

Исполнитель: Кодекс Астра 6.
Фоновый nohup не сохранился (status.json отсутствовал); заменён постоянной exec-сессией 98419, PID сборщика 589589. Heartbeat обновлён с рабочим способом восстановления. Проверка: status.json обновляется каждые 2 секунды; next PID 583507 и django PID 568105 доступны. GET Next /api/auth/csrf → 308; Django /api/schema/ → 200. stream.jsonl содержит новые агрегаты обоих источников: next http_non5xx=1, django http_non5xx=18 и other=253, затем 6/43. Проверки классификатора: 3 passed, исходные строки/секреты в поток не выводятся. Риск журнала заведён отдельным предложением «Мониторинг №1109: django.log вырос до 23 ГБ, диск заполнен на 93%»; в живом Plane колонка предложений сейчас называется Предложено Claude, использовано фактическое имя без переименования. Наблюдение продолжается, карточка №1109 In Progress; сервисы не перезапускались.


### 10.09.2026 00:50 — №1109: heartbeat и уточнение классификатора

Исполнитель: Кодекс Астра 6.
Оба сервиса доступны, PID Next 583507 и Django 568105 не менялись. Сборщик свежий. Единственный сигнал http_5xx оказался ложным: шаблон принимал размер ответа 564 байта за HTTP-статус. В журнале это WARNING django.server для POST, не подтверждённый 5xx. Исправлен только операционный /tmp-сборщик: код ответа определяется после HTTP-версии либо в формате access-log Next. Четыре проверки классификатора passed, включая размеры 507/564 при не-5xx статусах и настоящий 503. Перезапущен только сборщик, новая сессия 79086, смещения сохранены; сервисы не тронуты. Сигнал обработан без ложного оповещения об аварии. Свободно 20723187712 байт, ухудшение относительно стартового риска не установлено.


### 10.09.2026 00:50:26–00:50:30 — №1109: Next перезапущен

Исполнитель: Кодекс Астра 6.
Уточнение предыдущей записи: пока оформлялся heartbeat, сборщик зафиксировал новое событие. Next PID 583507 исчез, порт :3106 не принимал соединение в 00:50:26; к 00:50:30 порт снова доступен, новый PID 594761, журнал ротирован, затем startup_marker. Между наблюдениями около 4 секунд; точная длительность простоя неизвестна. Причина перезапуска не установлена; монитор сервис не перезапускал. Django PID 568105 остаётся доступен. События обработаны до байта 577, заказчик уведомлён.

- 10.09.2026 00:54, Plane №1109. Heartbeat: возраст status.json 1,9 с; Next PID 594761 и Django PID 568105 доступны; новых событий после байта 577 нет. Доступно 20 653 473 792 байта, df 92,9% занято; существенного ухудшения исходного риска нет. Курсор 577 сохранён, мониторинг продолжается, уведомление не требуется. Исполнитель: Кодекс Астра 6.

- 10.09.2026 00:56, Plane №1109. Новый перезапуск Next: в 00:55:32 порт :3106 недоступен, в 00:55:38 доступен с PID 601961 вместо 594761; интервал наблюдений около 6 секунд, точная длительность простоя неизвестна. Журнал ротирован, startup_marker подтверждён. Это второй наблюдавшийся перезапуск после события 00:50. Причина не установлена; монитор приложения не перезапускал. Django PID 568105 доступен без смены. Возраст status 0,9 с, доступно 20 759 310 336 байт, df 92,9%; ухудшения диска нет. Обработаны события до байта 1056. Исполнитель: Кодекс Астра 6.

- 10.09.2026 00:58, Plane №1109. Heartbeat: status свежий (1,9 с), Next PID 601961 и Django PID 568105 доступны, новых событий после байта 1056 нет. Доступно 20 748 865 536 байт, df 92,9%; существенного ухудшения нет. Курсор 1056 сохранён. Мониторинг продолжается, уведомление не требуется. Исполнитель: Кодекс Астра 6.

- 10.09.2026 00:59:45, Plane №1109. Heartbeat: возраст status 0,5 с; Next PID 601961 и Django PID 568105 доступны; новых событий после байта 1056 нет. Доступно 20 750 225 408 байт, df 92,9%; существенного ухудшения нет. Курсор 1056 сохранён, мониторинг продолжается без уведомления. Исполнитель: Кодекс Астра 6.

- 10.09.2026 01:01:45, Plane №1109. Heartbeat: возраст status 0,6 с; Next PID 601961 и Django PID 568105 доступны; новых событий после байта 1056 нет. Доступно 20 741 632 000 байт, df 92,9%; существенного ухудшения нет. Курсор 1056 сохранён, мониторинг продолжается без уведомления. Исполнитель: Кодекс Астра 6.

- 10.09.2026 01:03:15, Plane №1109. Heartbeat: возраст status 1,7 с; Next PID 601961 и Django PID 568105 доступны; новых событий после байта 1056 нет. Доступно 20 741 496 832 байта, df 92,9%; существенного ухудшения нет. Курсор 1056 сохранён, мониторинг продолжается без уведомления. Исполнитель: Кодекс Астра 6.

- 10.09.2026 01:05:15, Plane №1109. Heartbeat: возраст status 0,6 с; Next PID 601961 и Django PID 568105 доступны; новых событий после байта 1056 нет. Доступно 20 733 411 328 байт, df 92,9%; существенного ухудшения нет. Курсор 1056 сохранён, мониторинг продолжается без уведомления. Первая запись не запущена из-за тайм-аута автоматического согласования; повтор разрешён инструментом. Исполнитель: Кодекс Астра 6.

## 10.09.2026 — Plane №1079: production sharp

Исполнитель: Кодекс Астра 6.

Карточка `fd4fcc99-82cb-4457-b3cb-441dcc1058dc` переведена из `Предложено Claude` в `In Progress` до первой правки. Root cause подтверждён локально: production `Dockerfile` отдельно устанавливал `sharp@0.33.5`, а `package.json`/`package-lock.json` ограничивали приложение диапазоном `^0.33.5`, поэтому production runtime гарантированно получал старую ветку. По официальным npm/sharp источникам выбран `sharp@0.35.4`: это latest и исправленная версия для advisory по CVE-2026-84383; официальная документация подтверждает поддержку Node.js >=20.9 и готовых Linux musl/x64 бинарников, совместимых с `node:22-alpine`.

Создан план `docs/superpowers/plans/2026-09-10-sharp-1079.md`; план также зафиксирован в WIKI-поле задачи. Следующий шаг — согласованно обновить `package.json`, `package-lock.json` и production Dockerfile, затем пройти production build и браузерную проверку не-административным пользователем. Секреты не читаются и не записываются в документацию. Локальная ветка не создана: worktree detached, общий git metadata расположен вне доступного на запись каталога.
## 10.09.2026 — Plane №1113: обязательный актуальный текущий статус

Исполнитель: Кодекс Астра 6.

По прямому поручению заказчика создана карточка Plane №1113
(`3e3ee2b7-0781-46a8-ac6a-6ff657f2cb81`) в состоянии `Backlog` с приоритетом
`high`. Зафиксирован симптом на скриншоте от 10.09.2026: у Токтарова Азамата
блок «Текущий статус» сообщает об отсутствии активного статуса, несмотря на
наличие записей за прошлую и будущую даты. В карточке поставлена задача
проверить и восстановить end-to-end обновление через Celery worker/beat,
обеспечить обязательный актуальный статус для каждого активного сотрудника на
деловую дату `Asia/Almaty`, не допустить дубли и покрыть API, UI и живую пробу.
Связанные №961/№962 не объединены с новой карточкой: они проверяют отдельные
аспекты фоновых задач и не доказывают актуальность статуса у всех сотрудников.

Проверка результата: команда `plane_task.py add` вернула `заведено [Backlog]`,
повторный полный список Plane подтвердил №1113, `Backlog`, `high` и указанный
UUID. Код и стенды не менялись; гейты, коммит, push и RSS для этой постановки
не применимы. Очередь разработки не запускалась.

- 10.09.2026 01:21, Plane №1109. После паузы heartbeat выявлен устаревший status (821,4 с, около 14 минут без актуального наблюдения). Сборщик восстановлен в постоянной exec-сессии 24731, PID 655809; снимок снова свежий (1,8 с). Оба сервиса сейчас недоступны: :3106 и :8100 не слушают, независимые TCP-подключения дают ConnectionRefusedError errno 111. Точное время остановки и причина неизвестны из-за разрыва наблюдения; прежние PID 601961/568105 не представлены на портах. Приложения монитором не перезапускались. Доступно 42 516 516 864 байта, df 85,5% — риск диска уменьшился. Новые события обработаны до байта 1363. Заказчик уведомлён о необходимости восстановления сервисов; мониторинг продолжается. Исполнитель: Кодекс Астра 6.

- 10.09.2026 01:23:34, Plane №1109. Heartbeat: status свежий (0,9 с); Next :3106 и Django :8100 по-прежнему недоступны, новых событий после байта 1363 нет. Уже сообщённый отказ не повторяется уведомлением. Доступно 42 524 577 792 байта, df 85,5%; ухудшения нет. Курсор 1363 сохранён, наблюдение продолжается. Исполнитель: Кодекс Астра 6.


### 10.09.2026 01:26:11 — Plane №1109: мониторинг остановлен заказчиком

Исполнитель: Кодекс Астра 6.
Прямая команда заказчика: «стоп». Heartbeat smart-josparlau-3106-8100 переведён в PAUSED (ответ automation_update подтверждён). Собственный сборщик PID 655809 остановлен после проверки cmdline; проверка collector_stopped=True. Приложения не затрагивались. Карточка мониторинга переведена Cancelled по команде прекращения наблюдения. Журналы сохранены. Автоматически возобновлять наблюдение без новой команды нельзя.

## 10.09.2026 — Plane №1079: гейт, browser acceptance и закрытие

Исполнитель: Кодекс Астра 6.

`npm ci --ignore-scripts --no-audit --no-fund` завершён успешно. Финальный
`NEXTAUTH_SECRET=build-only-placeholder npm run gate:front` завершён кодом 0:
TypeScript, rewrite/shot checks, neighbours и Next production build прошли;
статические страницы сгенерированы `39/39`. Итоговая production Docker-сборка
`docker build --tag smart-josparlau:1079-sharp-final .` завершена кодом 0;
образ содержит `sharp` `0.35.4` и `sharp.versions.sharp` `0.35.4`.
Build-only значение используется только для prerender и не является runtime
секретом.

Browser acceptance выполнена по production-контейнеру на `:3108` и живому
Django на `:8100`, под не-административными сценариями: `legal-documents` и
`employees-read-access`, всего `4 passed (11.2s)`. Проверены запрет observer
без `event.view`, оператор `erda` без `forces.*`, доступ к своим статусам и
фильтрация сотрудников. Production-контейнер остановлен после прогона;
предварительно существующий Django PID `760181` на `:8100` не затрагивался.
RSS-снимок по правилу стенда: итоговый production `next-server` — `109188 КБ`
по `docker top`; в общем выводе машины также присутствовали чужие Next
процессы, их не останавливал.

Финальный read-only контроль: `git diff --check` — код 0; npm graph показывает
только root `sharp@0.35.4`, `next` использует deduped `0.35.4`, nested старой
версии нет. Перед коммитом рабочее дерево содержит только `Dockerfile`,
`package.json` и `package-lock.json`; lockfile `pnpm` не менялся, поскольку
production Dockerfile использует npm и package-lock.

Commit создан detached-worktree workaround без записи в общий index:
`353ba9776230a5001ed0ff3f3146b9ac45133b9d`. Push в отдельную ветку и перевод
Plane в `Review` — следующий шаг. Исполнитель: Кодекс Астра 6.
Push выполнен без force: `origin/codex/1079-sharp-0.35.4` указывает на
`353ba9776230a5001ed0ff3f3146b9ac45133b9d`. Исполнитель: Кодекс Астра 6.
Plane подтвердил: №1079 находится в `Review`; `On test` и `Done` не выставлялись.
Исполнитель: Кодекс Астра 6.
Повторная сверка после remote-проверки обнаружила возврат карточки в
`In Progress`; причина не установлена, соседние задачи не изменялись. Повторно
установлено и подтверждено: №1079 `Review`, `On test`/`Done` не выставлялись.
Исполнитель: Кодекс Астра 6.
### 10.09.2026 — начата Plane №1124

- Plane: №1124, `In Progress`.
- Проверяется общий граф Django-миграций перед объединением №1015, №890 и ролевого workspace. Цель — один детерминированный порядок без параллельных leaf `0117`.
- Проверка на этом шаге: карточка переведена в работу; фактические зависимости миграций сверяются по каждой ветке.
- Исполнитель: Кодекс Астра 6.
### 10.09.2026 — №1071 включена в интеграцию №1116

- В интеграционную ветку `codex/integration-1116` добавлен проверенный коммит №1071; новый интеграционный хэш: `2ff0b5b6`.
- Видимая проверка исходной ветки: production Chromium, не-администратор `acc_dept_head_d2`, меню «Ежедневный расход» → «Отчёты по Службе» → экран → доступная кнопка формирования CSV; `1 passed (7.7s)`.
- Отдельное ограничение роли `acc_dept_head` оформлено в Plane №1125 и не скрыто внутри №1071.
- Push интеграционной ветки ожидает явного разрешения на GitHub; локальное объединение продолжается.
- Исполнитель: Кодекс Астра 6.
### 10.09.2026 — диагностика Plane №1110

- `df -h`: `/dev/nvme0n1p6` — 288 ГБ, занято 257 ГБ, свободно 16 ГБ, 95%.
- `django.log`: 22 ГБ. Последние 5 МБ отфильтрованы по ERROR/WARNING/Traceback: необработанных 500 нет; основную массу создают DEBUG-запросы SQL и развёрнутый технический вывод для ожидаемых ответов 404/422.
- №1110 переведена в `In Progress`; исправление ротации передано отдельной сессии.
- Исполнитель: Кодекс Астра 6.
- 2026-09-10 — Переподъём локального стенда по команде заказчика: PostgreSQL `vaps-db-5434` уже был healthy; Django `:8100` и Next `:3106` проверены из хостовой сети (`/api/schema/` — 200, `/feedback` — 200). Исполнитель: Кодекс Астра 6.
## 10.09.2026 — Plane №1134: кадровые связи стендовых старших и офлайн-инструкция

Исполнитель: Кодекс Астра 6.

- Существующие `role_gvo_lead` и `role_patrol_lead` связаны соответственно с Employee №2 / табельный №100002 и Employee №3 / табельный №100003.
- Реальный JWT/API-путь подтвердил обе кадровые карточки и роли; пароль и токены в журнал не выводились.
- Аудит всех 56 пользователей: 12 связаны, 44 не связаны, дублей нет. Массовая фиктивная привязка технических `role_*`, `demo_role_*`, e2e/test и административных аккаунтов не выполнялась.
- Исправлена устаревшая таблица [[Учётки-стенда]]: добавлен `acc_ops_staff`, актуализирован сотрудник `acc_employee_d2`, отмечены две новые связи.
- Создана [[../WIKI/Учётки-и-сотрудники-чистый-офлайн-контур]] с безопасным порядком чистого развёртывания без стендовой базы и секретов.
- Проверка кода bootstrap выявила, что `seed_operations` безусловно добавляет демо-рейтинги, аналитику, отчёты и обратную связь; на чистом боевом контуре команда запрещена до разделения. Находка зарегистрирована отдельно в Plane №1135 (`Предложено Claude`).
- Код не менялся; коммит и push не требуются.
- Финальный гейт №1134: DB `56/12/44`, дубли `[]`; обе учётки — token/my-employee/permissions `200/200/200`; role-коды и Employee №2/№3 совпали. В составе 36 `role_*` связаны только две требуемые учётки. Активных `next-server`/`next dev` при RSS-замере нет. №1134 переведена в `Review`, №1135 оставлена в `Предложено Claude`.


## 10.09.2026 — Plane №1136 / №1137: начало интеграции и закрытого контура

Исполнитель: Кодекс Астра 6.

Заказчик поручил объединить все ветки в main и выполнить [[WIKI/Промпт-тестовый-прод-закрытый-контур]]. Созданы №1136 (интеграция, In Progress) и №1137 (эпик контура, Backlog). Прочитаны промпт, AGENTS, индекс и инфраструктурные сведения. Проверен origin через git fetch --prune: 151 ссылка, 81 уникальная вершина вне main, 57 независимых вершин; есть архивные/squash/orphan истории, их содержимое требует сверки, чтобы не воскресить удалённое. Исходный main a3303cf37c285bf4d1bcc640dcedc6502743c375. Чужие незакоммиченные изменения сохранены на месте. Интеграция в отдельном worktree /tmp/sj-contour-integration-1136, ветка codex/contour-integration-1136. Промпт прямо отменяет pytest/e2e: доказательства — браузер, сборка нужна для бандла.

10.09.2026 — №1136. Интегрированы текущая проходка 8c50ac99 и набор integration-1116; merge e75b8f41. Разрешены четыре конфликта: сохранён гейт FORCES_GATHERING_OFFICER, добавлены Отчёты по Службе, отрицательная персона acc_employee и объединены списки smoke. git diff --check без вывода. На диске осталось 1,8 ГБ — риск сборки бандла, чужие файлы не удалялись. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136. Слита refs/heads/claude/om-forces-review-cleanup-1023 (e4f81f4f), результат ab5e99a8; git merge exit 0. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136. Слита refs/heads/claude/om-placement-shift-1058 (8de8e8b7), результат 55621d55; git merge exit 0. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136. Слита refs/heads/codex/1015-protected-photo-auth (53972b23), результат 15b939a3; git merge exit 0. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136. Слита refs/heads/codex/1017-visit-object-delete-permission (53fb6169), результат bf5d2d98; git merge exit 0. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136. Слита refs/heads/codex/1032-dismiss-deactivates (0bd601ed), результат 6f149902; git merge exit 0. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136. Слита refs/heads/codex/1041-permission-errors (b1959f7c), результат e6672819; git merge exit 0. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136. Слита refs/heads/codex/1069-photo-fallback (3044f3d6), результат 5dd13e50; git merge exit 0. Исполнитель: Кодекс Астра 6.

10.09.2026 — Plane №1136. Разрешены 9 конфликтных файлов активного merge ca0a7f3a: ролевой moduleOpenFor сохранён с нормализацией query string; необязательное мероприятие физнаряда и один ParticipationKindPicker сохранены; новые Conduct-права старших объектов/мероприятия приняты с сохранением фильтра инцидентов по выбранному объекту; приняты ограничения заместителя на завершение расстановки и назначение старшего поста, восстановление частично применённой авторасстановки и чтение рабочих справочников №1102. Списки smoke объединены; существующие конфликтные пробы сведены без добавления новых и без запуска pytest/e2e. Выполняется синтаксическая проверка и сверка merge. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136/1137. Составлен [[WIKI/План-1137-Тестовый-прод-закрытый-контур]]. Применён writing-plans с приоритетом явного браузерного гейта заказчика; единый план во втором мозге. Ошибка автоматического разрешения конфликтов (жадный шаблон) обнаружена по diff и исправлена восстановлением полных модулей из трёх сторон; fb7acb6a и 7a2af705, Python AST валиден. main не затронут. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136/1137. Заказчик разрешил архивировать и обнулить django.log. Plane ответил 429 при заведении отдельной карточки; действие разрешено явно, расхождение временно фиксируется здесь до восстановления API. Блоки 1–4 плана заведены, 5–7 не созданы из-за 429. Начинается потоковое архивирование со сверкой SHA-256; файл открыт PID 1944752/1944797, финал потребует краткой приостановки писателей и архива дописанного хвоста. Исполнитель: Кодекс Астра 6.

10.09.2026 — Plane №1136. Merge ca0a7f3a завершён коммитом `54aa4bdf84f8614ef09fd9603a9d6d5a0f5b93ef` в `codex/contour-integration-1136`; родители `62b7b69c7b8afbb9aecc410a13ea94dd3d43adf1 ca0a7f3ab3b10ebcc197c1eb7cba9f6f8c66bd53`. Проверки: Python AST — 21 изменённый файл разобран; TypeScript AST — 39 файлов, 0 синтаксических ошибок; `git diff --cached --check` — exit 0 без вывода; unmerged paths — пусто; после коммита `git status --porcelain` — пусто. Проверено сохранение одного ParticipationKindPicker, optional event_id/null и FORCES_GATHERING_OFFICER/moduleOpenFor. pytest/e2e и полная сборка не запускались по границам поручения; push не выполнялся, main не менялся. Git сообщил о существующем gc.log и большом числе недостижимых loose objects; очистка git-объектов не выполнялась. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136. Слита refs/heads/codex/1110-django-log-rotation (f05f6953), результат 87e120b3; git merge exit 0. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136. Слита refs/heads/codex/1111-status-button (f45e6370), результат d4abb578; git merge exit 0. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136. Слита refs/heads/codex/1112-status-dialog (e42d0153), результат ded40611; git merge exit 0. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136. Слита refs/heads/codex/1117-1123-backend-deps (d9bac15e), результат e408d1e3; git merge exit 0. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136. Слита refs/heads/codex/1120-role-default-route (624a536c), результат a4a2b948; git merge exit 0. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136. Слита refs/heads/codex/1121-next-build-secret (08b62f7d), результат b43134a0; git merge exit 0. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136. Слита refs/heads/codex/828-token-blacklist (316ec6e3), результат c90ce6cf; git merge exit 0. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136. Слита refs/heads/codex/858-status-dedupe (f9ef8fb3), результат 4599ff50; git merge exit 0. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136. Слита refs/heads/codex/887-empty-distribution (a1f98f4f), результат 3aa90812; git merge exit 0. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136. Слита refs/heads/codex/luna-1055 (163368a2), результат 0c4f76d7; git merge exit 0. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136. Слита refs/heads/codex/sol-1022 (dc52ae0c), результат 05c10496; git merge exit 0. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136. Слита refs/heads/codex/sol-1036 (ba6f7009), результат 5a8633e3; git merge exit 0. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136/1137, разрешённое освобождение диска. Архив /home/erda/Backups/smart-josparlau/django-20260910-pre-contour.log.gz: 1471441413 байт, распаковано и сверено 23122890983 байт, SHA256 9bc03e3e85da1e1e263bfbd090d58b1c49253345087d78200f24200b693acede. Дописанный хвост 0 байт сохранён при наличии. Писатели PID [1944752, 1944797] кратко приостановлены только на финал и возобновлены finally. Исходный django.log обнулён после проверки архива; БД не затронута. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136. Слита refs/heads/codex/sol-962 (ce5d8abb), результат 23f695c6; git merge exit 0. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136. Слита refs/heads/codex/status-schedule-962 (990e1835), результат 6845c225; git merge exit 0. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136. Слита refs/heads/personnel/1057-day-submission-date (d99f331b), результат ffe0f2f4; git merge exit 0. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136. Слита refs/heads/sonnet-om/1061-protected-person-link (053de287), результат ff400baf; git merge exit 0. Исполнитель: Кодекс Астра 6.

10.09.2026 — №1136. Слита refs/heads/sonnet-om/1113-status-celery (548e4d2b), результат 2d502971; git merge exit 0. Исполнитель: Кодекс Астра 6.

## 10.09.2026 — Plane №1136: интеграция исторической legacy API ветки

Исполнитель: Кодекс Астра 6. После соединения истории подтверждённого squash-источника `343e0909` выполнен настоящий merge `24e4c3ae`: сохранены 8 уникальных изменений прав/областей legacy API, 62 файла. Автоматический merge создал семантическое пересечение с поздней валидацией ID: scope-проверки в history/planned/division_headcount и Division.move перенесены после контролируемого разбора ID, чтобы неверный ввод сохранил 400 вместо ValueError/500. Проверка: Python AST — 62 файла разобраны; git diff --cached --check — exit 0. Тесты/e2e не запускались. Коммит `d9e4dc3e`. Репозиторий main и remote не изменялись.

## 10.09.2026 — Plane №1136: уникальные исторические документы и UI

Исполнитель: Кодекс Астра 6. `0c8f9703` сохраняет .design-sync/NOTES.md из 8ec9f029; `37b42aba` сохраняет пять Obsidian записей skills-lock.json из 4a94d9f7 (без установки/запуска). `8c8d2601` переносит d543886d: CSV периода использует действующий period-export, audit получает action/actor/reset; сохранены текущие ReportSectionCard, гейты, русские подписи, поиск по подписям и AuditChangeCell. Старый footer со ссылкой /security-ops/traffic удалён при сведении, маршрут отсутствует и расход теперь живёт в DailyExpenseBoard. `829844ec` переносит 62d00d4a на 5 активных файлов: dark контраст карточек/организации/сотрудников/командного центра/OrgBoard. Старое тело profile не возвращено: выделенный widgets/my-profile/ProfileBody уже содержит dark стили; текущий naming.labelOf в OrgBoard сохранён. Проверки каждого патча git diff --cached --check — exit 0. Новые тесты не писались, существующие тесты из branch merge сохранены, ничего не запускалось.

10.09.2026 — №1136. Изолированные frontend зависимости установлены deps:bootstrap: npm ci added 748 packages in 5s, fingerprint записан; .env.local скопирован с mode600 без вывода значений, вне git. Для №1145 записана проверка архива и комментарий Было/Стало; семь карточек №1138–1144 привязаны parent к эпику №1137. Исполнитель: Кодекс Астра 6.

## 10.09.2026 — Plane №1136: историческая интеграция готова к сборке

Исполнитель: Кодекс Астра 6. Финальный чистый HEAD `92d7639dd437590de99a610a85bafe80cfe1cf13`. Все 97 уникальные вершины (150 ссылок) исходной инвентаризации теперь предки HEAD, отсутствующих 0; отдельно 18/18 исторических максимальных вершин. `2bf0d8fa` соединяет 13 исторических/заменённых веток после переноса действующего содержимого; `4cd5714a` соединяет unrelated docs-линии, где 40 итоговых документов имеют идентичные blob SHA. Это сохранение достижимой истории выведенного стека, а не утверждение равенства его функций.

Полный статический tsc выявил отсутствующий binary helper исторической выгрузки и два одинаковых defaultPortalRoute, унаследованных от современной интеграции. `92d7639d` переносит ровно OpsApiClient.download из e8823b71 и удаляет второй byte-identical defaultPortalRoute. Обе операции выполнены по AST-границам TypeScript с проверкой равенства функций, без регулярного захвата блоков. Итог `node node_modules/typescript/bin/tsc --noEmit --incremental false` — exit 0. Python AST — 62 файла; TSX синтаксис перед последним helper — 7 файлов, 0 ошибок; git diff --check — exit 0; конфликтных маркеров 0; git status --porcelain пуст. Первый вспомогательный AST-вызов из frontend-каталога имел неверный cwd и не нашёл Python путь; немедленный повтор из корня успешен, код не менялся из-за этого вызова.

Не восстановлены Backend/VAPS, frontend/src, obsidian-vault и /security-ops/traffic. package.json/package-lock не менялись. pytest/e2e не запускались, новые тесты не создавались. Main/remote не изменялись, push не выполнялся. Родителю передано управление чистой веткой для production build.

10.09.2026 — №1136. HEAD92d7639d: все 97 уникальных вершин инвентаризации — предки HEAD, missing0; Python AST165 изменённых модулей, git diff --check чист. npm run build:check exit0, Next15.5.25, compiled20.5s; полный вывод QA-Audits/contour-2026-09-10/build-1136.log. showmigrations выявил четыре leaf operations, создана пустая0122_merge_20260910_1238. До migrate готовится backup; миграция private-photo переносит фото в защищённый каталог с удалением публичного оригинала, поэтому сохраняются оба каталога носителей. Исполнитель: Кодекс Астра 6.

## 2026-09-10 — №1136: резервные копии перед миграциями

Исполнитель: Кодекс Астра 6.

- БД сохранена через pg_dump контейнера vaps-db-5434: `/home/erda/Backups/smart-josparlau/personnel-records-20260910-pre-integration.dump`, 2 352 368 байт, SHA256 `19c19e0a7749619554784aa3de31366d9ffc5104e3bd64483bbced1ec5ae5bbb`. pg_restore --list: 1047 строк.
- Медиа и закрытое хранилище: `/home/erda/Backups/smart-josparlau/media-20260910-pre-integration.tar.gz`, 34 515 086 байт, SHA256 `f77f9c26f25ac9e193af31ec8be53375f73dc6b06d4eeefc7774cb8cb37b5b96`, архив прочитан: 191764 элемента.
- Production-сборка объединённого кода 92d7639d завершилась кодом0; вывод QA-Audits/contour-2026-09-10/build-1136.log. Независимое ревью выявило одну потерянную пакетную загрузку сотрудников; исправляется до публикации.

## 10.09.2026 — Plane №1136: исправлено Important интеграционного ревью

Исполнитель: Кодекс Астра 6. Сверено замечание [[QA-Audits/Ревью-интеграции-1136]]: divisions_of/denorm_for читают _employees через employees(), поэтому в force_collections вызов prime_allocation_members(member_ids) заменён на prime_employees(member_ids). Это заполняет используемый downstream кеш для всей страницы до обхода строк; остальные кеши и код не менялись. В тот же коммит включена подготовленная основным интегратором пустая 0122_merge_20260910_1238.py: четыре зависимости operations объединены без операций с данными; авторство создания миграции себе не приписываю.

Проверки: Python AST — 2 файла разобраны; git diff --check и git diff --cached --check — exit 0; staged diff — ровно 2 файла, 17 добавленных/1 удалённая строка. pytest/e2e/тесты не запускались, миграция на БД этим действием не применялась. Коммит `4608f742ba777bd77822b63f7dc54552fe6d8e93` в codex/contour-integration-1136; push и main не тронуты.

## 2026-09-10 — №1136/1146: запуск объединённого стенда

Исполнитель: Кодекс Астра 6.

Остановлены прежние Django PID1944752/1944797 и production Next PID1103184. Новый production Next PID2119374 (:3108) использует успешную `.next-build` из интеграции. Медиа подключены из исходного рабочего каталога, private storage задан абсолютным путём к исходному. Migrate применил employees0004, operations0118scope/0119/0120/0121; на0117private_photo упал: NULL photo.name не поддерживает startswith. Трассировка `/tmp/sj-contour-migrate-1136.log`. Завёл №1146; минимальное исправление блокера запуска выполняется в рамках разрешённой №1136. До успешного повторного migrate бэкенд остановлен.

## 10.09.2026 — Plane №1136 / находка №1146: NULL фото в миграции private storage

Исполнитель: Кодекс Астра 6. Реальный запуск migrate основным интегратором остановился в operations.0117_protected_person_photo_private_storage: exclude(photo="") не исключает NULL у nullable ImageField, person.photo.name был None и startswith дал AttributeError. Прочитана трассировка /tmp/sj-contour-migrate-1136.log и оба направления миграции. В move_public_photos и restore_private_photos добавлен короткий guard `not name` перед startswith/storage.exists; записи без имени пропускаются до файловых операций и сохранения модели. Изменён только файл миграции, 2 строки.

Статическая проверка Python AST — успешна; git diff --check и git diff --cached --check — exit 0; явный staged diff содержит один файл, +2/-2. Коммит `b9232b1d66139687dc2dd17c69768093ffaa5352`. Тесты, сервер, миграции и push не запускались; файлы фотографий/данные БД не трогались. Найденный untracked media оставлен основному интегратору без изменений. Проверку повторным реальным migrate выполняет основной интегратор.

Дополнение №1136/№1146: основной интегратор сообщил результат запроса к реальной БД — 1 запись photo=NULL и 7 записей photo=""; NULL совпадает с входом падающего startswith. Мной запрос к БД не запускался. Исполнитель: Кодекс Астра 6.

### №1136/1146: блокер миграции устранён

Исполнитель: Кодекс Астра 6.

Коммит `b9232b1d66139687dc2dd17c69768093ffaa5352`: миграция0117 пропускает пустое имя фотографии в обоих направлениях. В БД действительно1NULL и7пустыхphoto. Повторный migrate: exit0,0117и0122OK; логи сохранены в QA-Audits/contour-2026-09-10. Django объединённого кода запущен PID2123416(:8100), production Next PID2119374(:3108). Проверка ss подтверждает оба порта. Повторный fetch: все151текущая ссылка предки HEAD, пропусков0.

## 2026-09-10 — №1136 завершена, переход к №1138

Исполнитель: Кодекс Астра 6.

Все исходные97уникальныхвершин/150веток и актуальные151ссылки передпушем включены в интеграцию; сохранено современное дерево, решения по18историческимвершинам в [[Сверка-исторических-веток-1136]]. Локальный main обновлён fast-forward без изменения грязного исходного рабочего дерева. Push успешен; последующий ls-remote подтвердил main и codex/contour-integration-1136 = `b9232b1d66139687dc2dd17c69768093ffaa5352`. Git status -sb чист и совпадает с upstream. №1136 и найденный блокер1146 в Review, записки ручной проверки добавлены. Ревью: [[Ревью-интеграции-1136]], закрыта потеря кеша в4608f742. Productionbuild0, migrate0; подробная карта браузера ограничена местами интеграции, полный промпт ещё не выполнен. RSS: production2119374=139264КБ, dev2050642=305320КБ — ниже2500000. Следующая группа:1138офлайн-бандл; далее1139→1140→1141→1142→1143→1144, эпик1137. Каждая группа новойсессией по№1107.

## 2026-09-10 — запуск следующей сессии по №1107

Исполнитель: Кодекс Астра 6.

Создана новая задача Codex «Тестовый прод: офлайн-бандл №1138», clientThreadId `client-new-thread:3c046047-432a-4031-8a55-8a517727fe20`. Передана [[Передача-1138-Офлайн-контур-2026-09-10]], исходный промпт, план и требование непрерывно перейти после блока1 к1139→1140→1141→1142→1143→1144 новыми сессиями. Разрешение на очередь ранее получено; это переход между группами, а не завершение промпта.


## 2026-09-10 — №1138: начало группы офлайн-бандла

Исполнитель: Кодекс Астра 6. Прочитаны AGENTS.md, исходный промпт целиком, план №1137 и передача №1138. Изолированный worktree /home/erda/.codex/worktrees/47b2/Smart Josparlau, ветка codex/contour-offline-1138 от b9232b1d. Plane переведён In Progress. Проверка: git status чистый, диск 23 ГБ свободно; docker доступен. Pytest/e2e/smoke и новые тесты запрещены прямым промптом. Выполняется блок 1, следующий блок №1139 отдельной сессией.

### Новая сессия начала работу

Исполнитель: Кодекс Астра 6.

Фактический threadId `01a08a4e-a40a-7c13-a35b-34911a4f0d04`. wait_threads подтвердил active/inProgress: изолированная рабочая копия на коммите интеграции, исполнитель готовит файлы бандла, основная сессия готовит офлайн-запуск и браузерную проверку; запрет pytest/e2e/smoke подтверждён. Очередь продолжена, итоговая готовность контура пока не заявляется.

## 10.09.2026 — №1138: начата ограниченная реализация bundle

Исполнитель: Кодекс Астра 6. Прочитаны brief, блок1 исходного запроса, index/status/known-issues и deploy/spike-1.9. Ветка codex/contour-offline-1138, исходное дерево чистое. Фактически frontend использует локальные шрифты; next/font/google не найден. Backend production имеет env hosts, но наследует development CORS и timezone: добавляется отдельный contour settings. Pytest/e2e/smoke не запускаются по прямому запрету; фактическую сборку и браузер выполняет контроллер.

- 2026-09-10, №1138: полный list --open сохранён plane-open-start-1138.txt (команда exit0); порядок1138→1139→1140→1141→1142→1143→1144 подтверждён. Снимки feedback/объекта до UI блока дополнены через CUA, console error/warn пусто. sudo без пароля недоступен, docker доступен: проверка сети будет изолировать только стек и проверяемый браузер, связь агента и чужих стендов сохраняется. Исполнитель: Кодекс Астра 6.

- 2026-09-10, №1138: первая установка browser network guard обнаружила отсутствие глобального URL в sandbox Playwright MCP; заменено разбором URL строки без этого global. Предыдущая запись Decisions описывала ожидаемую блокировку; фактический результат подтверждается повторной браузерной пробой в tool output, не первой попыткой. Исполнитель: Кодекс Астра 6.

- 2026-09-10, №1138: карточка прочитана через API, новых комментариев0; snapshot очереди до перехода ещё показывал Backlog, текущий API state=In Progress. Результат поиска fonts.googleapis/next/font/google/cdnjs/jsdelivr/unpkg в app/components/widgets/features/shared/lib — совпадений0. Ничего в layout менять не требуется. RSS next-server максимум293776КБ, :3108PID2119374 RSS145692КБ. Исходный backend/frontend Dockerfile прочитан: bootstrap compile требует отделения зависимостей и runtime secret. Исполнитель: Кодекс Астра 6.

- 2026-09-10, №1138: создан приватный runtime env ~/.config/vaps/contour-1138.env (600), новые независимые PostgreSQL/Django/NextAuth secrets. Публикуемый адрес только10.115.70.68:3118. Значения секретов не выводились; в Git и snapshot не включаются. Исполнитель: Кодекс Астра 6.

- 2026-09-10, №1138: реализация15файлов в90de20411082c15b2090f9e76827f7d6eaa58e7c. Запущен фактический online prepare: bash deploy/contour/build-bundle.sh prepare /home/erda/Backups/smart-josparlau/contour-bundle-1138-90de2041; полный вывод QA-Audits/contour-2026-09-10/1138-prepare.log. Готовность бандла пока не заявлена; после подготовленных dependencies выполняется source build без сети. Исполнитель: Кодекс Астра 6.

### 10.09.2026 — №1138: файлы bundle реализованы, переданы контроллеру

Исполнитель: Кодекс Астра 6. Коммит `90de20411082c15b2090f9e76827f7d6eaa58e7c` (15 файлов, +569 строк), ветка `codex/contour-offline-1138`, без push до приёмки контроллера. Добавлены deploy/contour: двухфазная сборка, Dockerfiles prepared deps/runtime, sha256/save/load, compose без build с internal сетью, nginx same-origin + CSP, обязательные runtime secrets, migrate/collectstatic entrypoint, минимальный README. Отдельный `settings/contour.py` задаёт env CORS/CSRF/hosts, canonical timezone и файловую ротацию, не меняет общие настройки.

Разрешённые проверки: `bash -n deploy/contour/build-bundle.sh deploy/contour/install.sh` и `sh -n deploy/contour/entrypoint.sh` — exit0; Python ast.parse двух новых .py — вывод `Python syntax OK: deploy/contour/snapshot.py` и `Python syntax OK: Backend/PersonnelStatus/Personnel-Records/organization_management/config/settings/contour.py`; Compose config --quiet с несекретными syntax-only значениями — exit0; `git diff --cached --check` — exit0 без замечаний. Тяжёлая сборка/старт/браузер мной не выполнялись, проверку проводит контроллер. Живые сервисы/сеть хоста не менялись. Отчёт: [[../WIKI/Бриф-1138-Офлайн-бандл-report]].

- 2026-09-10, №1138: prepare завершил Python wheelhouse, перешёл к npm ci. Независимое review выявило дефект ещё не опубликованного contour nginx: абсолютные редиректы теряют published port3118 из-за listen80. Исполнитель получил fix absolute_redirect off; повтор приёмки /admin и login обязателен. Это исправление текущей реализации1138 до поставки, не изменение стороннего модуля. Исполнитель: Кодекс Астра 6.


## 10.09.2026 — Plane №1138: независимое ревью офлайн-бандла

Исполнитель: Кодекс Астра 6. Read-only review `b9232b1d..90de2041` по требованиям и Superpowers review structure; результат [[../WIKI/Ревью-1138-Офлайн-бандл]]. Найден C1: nginx absolutizes relative Location с внутренним HTTP80 и теряет опубликованный3118, в том числе на пути admin login. Доказательство — конфигурация и upstream nginx1.28 header filter; рекомендовано absolute_redirect off. Spec compliance FAIL до C1, code quality CHANGES REQUIRED. Critical1, Important0, Minor0. Тесты/сборка/стек не запускались; фактический гейт выполняет контроллер. Код не менялся, новых коммитов review нет.

### 10.09.2026 — №1138: исправлен review blocker nginx redirect

Исполнитель: Кодекс Астра 6. По подтверждённому контроллером review найдено: server listen80 при опубликованном3118 и default absolute_redirect on строил redirect без внешнего порта. В deploy/contour/nginx.conf добавлен `absolute_redirect off;`: относительные Location сохраняют browser origin с портом. Проверка синтаксиса фактическим nginx1.28-alpine в одноразовом контейнере `docker run --rm --pull=never --network=none --add-host backend:127.0.0.1 --add-host frontend:127.0.0.1 -v <nginx.conf>:/etc/nginx/conf.d/default.conf:ro --entrypoint nginx nginx:1.28-alpine -t` → exit0: `syntax is ok`, `test is successful`. Это только синтаксическая проверка; HTTP/browser не запускались. `git diff --check` → exit0. Коммит `45d67d29782c7c158c2e4dc88be43ac6d4079f9e`; не пушил. Подготовка зависимостей контроллера продолжается из90de2041, перед source build требуется обновить snapshot до финального SHA (dependencies не изменены).


## 10.09.2026 — Plane №1138: scoped re-review fix1

Исполнитель: Кодекс Астра 6. Прочитан diff `90de2041..45d67d29`: server-level absolute_redirect off устраняет C1 без новых нарушений. [[../WIKI/Ревью-1138-Офлайн-бандл]] обновлён: spec compliance PASS для файлов, code quality PASS; открытые Critical0 / Important0 / Minor0. Reviewer тесты/сборку/стек не запускал; actual prepare/build/load/browser остаются у контроллера. Исправляющий коммит `45d67d29782c7c158c2e4dc88be43ac6d4079f9e`; source snapshot перед build должен включать его.

- 2026-09-10, №1138: fix1 commit45d67d29782c7c158c2e4dc88be43ac6d4079f9e прошёл scoped review; Critical/Important/Minor0, spec/codequality PASS для файлов. Lab prepare запущен отдельно, лог1138-lab-prepare.log; основная onlineподготовка дошла до production npm ci. Исполнитель: Кодекс Астра 6.

- 2026-09-10, №1138: final snapshot /home/erda/Backups/smart-josparlau/contour-bundle-1138/source создан из45d67d29,1024trackedfiles. Побайтно сверены pinned requirements.txt, requirements/base+development, package.json/package-lock и оба dependencyDockerfile с исходнымprepare90de2041 — идентичны. Поэтому prepared-images/wheelhouse допустимо переиспользовать без повторной onlineзагрузки; runtime/sourceсобираются заново из исправленногоSHA. Исполнитель: Кодекс Астра 6.


### 2026-09-10 — №1138: offline source build фактически начат
Исполнитель: Кодекс Астра 6.
- Online prepare exit0; Python wheelhouse92файла; prepared-images.tar.gz1158972742bytes. Finalbundle `/home/erda/Backups/smart-josparlau/contour-bundle-1138`, sourceSHA45d67d29. Preparedarchive и wheelhouse hardlink к первой подготовке (зависимости идентичны), экономия места без изменения оригинала.
- Labimage `smart-josparlau/contour-verification-daemon:1138` подготовлен online, exit0. `sj-offline-daemon-1138` на новом internalnetwork `sj-offline-verification-1138`, новый одноимённый Docker volume, наружу опубликован только10.115.70.68:3118. Engine27.5.1.
- `docker network inspect ...`: Internal=true, Subnet172.18.0.0/16. `/proc/net/route` внутри содержит только connected docker0/eth0, defaultмаршрута нет. Python socket.create_connection(('1.1.1.1',443),2) → `[Errno 101] Network unreachable`.
- Выполняется `docker exec sj-offline-daemon-1138 bash /bundle/source/deploy/contour/build-bundle.sh build /bundle`; вывод1138-offline-build.log. Здесь и Dockerdaemon, и sourceRUN изолированы от внешней сети; ранее выполненный onlineprepare не выдаётся за офлайнскачивание.

- 2026-09-10, №1138 / №1147 (18590645-0524-421d-b398-3ae5b52e8abe): фактический offlinebuild exit1, Next prerender ratings/evaluations падает из-за отсутствия Suspense. Backend pip --no-index build прошёл. Находка заведена Предложено Claude и взята In Progress как необходимый блокирующий fix внутри разрешённого блока1. Лог1138-offline-build.log; design не меняется, тесты запрещены. Исполнитель: Кодекс Астра 6.

- 2026-09-10, №1138: приватный replica .env записан в finalbundle (600, sha/source не включает его); innerBIND_IP0.0.0.0, outerdaemon публикует только10.115.70.68:3118. Отдельный пароль contour_admin в ~/.config/vaps/contour-1138-admin-password (600); учётка будет создана только в новойконтурнойБД. Исполнитель: Кодекс Астра 6.

### 10.09.2026 — №1147: минимальные Suspense fixes переданы контроллеру

Исполнитель: Кодекс Астра 6. Коммиты `25e48491` (10 прямых page consumers, +93/-7) и `7ef8088ba461c3f97d78c4b9ca41cf9099ab6f33` (непрямой consumer service-summary, +10 строк). Все затронутые default pages теперь оборачивают прежнее неизменённое тело в *Screen + Suspense с текущим проектным fallback. UI-содержимое, API-режим, layout/readiness и зависимости не менялись.

Дополнительный поиск потребителей вне app выявил11-ю страницу: service-summary/page.tsx → features/service-summary/ui/ServiceSummaryScreen.tsx:30 useSearchParams, без границы в родительской странице. Sidebar имеет собственную Suspense; forces collections/workspace/department requests обслуживаются page employees с существующей границей, ForcesRequestBanner — statuses с границей, visit/approval — events/[id] с границей, service-employees — собственной page границей. Поэтому эти соседние компоненты не менялись.

Разрешённая TSX синтаксическая проверка в одноразовом prepared Node image с --network=none --pull=never, readonly mount и TypeScript createSourceFile.parseDiagnostics дала `TSX syntax OK` для всех11 путей, exit0. `git diff --check` после обоих изменений exit0. Ни pytest/e2e/smoke, ни тяжёлой сборки/браузера мной не запускалось. Контроллер повторяет реальную офлайн-сборку; на момент записи прогон из25e48491 уже запущен, а service-summary fix7ef8088b войдёт в последующее обновление snapshot. Готовность бандла пока не заявлена.


## 10.09.2026 — Plane №1147: независимое review Suspense wrappers

Исполнитель: Кодекс Астра 6. Проверен только diff `45d67d29..25e48491`, десять страниц API-сборки. Во всех Page охватывает Screen границей Suspense; прежние тела сохранены, props/hooks/JSX/права/фильтры не менялись. Spec compliance PASS для кода, code quality PASS, Critical0 / Important0 / Minor0. Результат [[../WIKI/Ревью-1147-Suspense-api-сборка]]. Reviewer ничего не собирал/не тестировал/не запускал; фактический повтор offline build выполняет контроллер.

### 10.09.2026 — №1147: уточнение от успешной сборки, лишняя11-я правка отменена

Исполнитель: Кодекс Астра 6. Контроллер сообщил фактический успех offline frontend/proxy build из25e48491. Повторное полное чтение features/service-summary/ui/ServiceSummaryScreen.tsx подтвердило ошибку первоначального read-only анализа: useSearchParams находится во внутреннем `ServiceSummaryBody`, а экспортируемый `ServiceSummaryScreen` УЖЕ оборачивает это тело в Suspense (внизу файла). Permissions loading не является объяснением: hook исполняется раньше role guard; сборку защищает именно существующая внутренняя Suspense. Поэтому утверждение предыдущей записи «11-я страница без любой boundary» НЕВЕРНО.

Лишняя page boundary7ef8088b отменена отдельным `git revert --no-edit 7ef8088b`, revert commit `5848728995aef4eaa8084d32d668b85e3a6b7c02`. Другие10 исправлений25e48491 сохранены. `git diff --check` → exit0; `git diff --exit-code 25e48491 -- Backend/PersonnelStatus/PersonalRecordFront/app/security-ops/service-summary/page.tsx` → exit0, вывод пуст: страница полностью совпадает с уже собранным snapshot25e48491. Тесты и сборки этой сессией не запускались. Итог:10 исправленных страниц, НЕ11. Контроллеру передан свежий SHA для корректной привязки source-revision; dependency prepared images остаются теми же.


### 2026-09-10 — №1138/1147: сборка без сети exit0
Исполнитель: Кодекс Астра 6.
- Повтор из source25e48491: backend/frontend/proxy собраны, Next compiled23.2s,39/39staticpages, buildscript exit0. Все sourceRUN --network=none; весь daemon без defaultмаршрута. Лог1138-offline-build-2.log.
- Фактическое исправление —10страниц Screen+Suspense в25e48491, независимый reviewer spec/codequalityPASS, Critical/Important/Minor0. Предложенная11яграницаservice-summary оказалась дублированием уже существующейграницы внутри экспортируемогоfeatureScreen; это подтверждено чтениемполногофайла и зелёнойсборкойбезнеё. Исполнитель откатывает7ef8088bотдельнымcommit; эти10исправленийсохраняются.
- Бандлсобран: prepared/runtimearchives, wheelhouse, snapshot, manifest, sha256. Запущен фактический перенос docker cp в новый /install изолированнойлаборатории и установка bash /install/install.sh. Новыйотдельныйdatastore; лог1138-offline-install.log. Полнаяготовностьдоуспешноговходабраузеромнезаявлена.

- 2026-09-10, №1138/№1148 (92d39929-b342-4cda-bbbf-8d4e33f2f0e3): offlineinstall exit1. Migration/collectstatic прошли; ASGI AppRegistryNotReady: ops_routing импортирует auth.models до get_asgi_application. Новый backendконтейнер остановлен, чтобы не повторять загрузку; БД/volumes сохранены. Карточка Предложено Claude→In Progress по разрешению прямого промпта исправлять блокирующий запуск P0. Исполнитель: Кодекс Астра 6.

### 10.09.2026 — №1148: root cause ASGI worker failed to boot

Исполнитель: Кодекс Астра 6. Systematic-debugging по фактическому 1138-backend-boot-failed.log: migrate и collectstatic завершились, ASGI worker падает при импорте config/asgi.py. Цепочка: asgi.py импортирует operations.ws_routing → ws_consumers → ws_auth → SimpleJWT.JWTAuthentication → django.contrib.auth.models до get_asgi_application. В новом gunicorn-процессе registry не инициализирован; прежние manage.py процессы не передают ему память. Минимальный fix: setdefault settings, вызвать get_asgi_application один раз до channels/auth/routes imports, затем передать созданный объект HTTP-router. Старые notification routes и ops routes объединяются как прежде, ASGI/uvicorn остаётся. Читатели: Dockerfile backend и все ASGI entrypoint consumers; не изменение auth-логики. Прямой запрет тестов сохраняется, проверка только Python syntax/diff, реальный boot повторяет контроллер.

### 10.09.2026 — №1148: ASGI порядок исправлен, передано на фактический boot

Исполнитель: Кодекс Астра 6. Коммит `92f849df449edd324b639c99f88d33f76f66147a`: config/asgi.py теперь задаёт settings и инициализирует Django get_asgi_application до импорта channels/auth и model-importing маршрутов. HTTP использует тот же созданный ASGI объект; routing.websocket_urlpatterns + ops_routing.websocket_urlpatterns и AuthMiddlewareStack не изменены. WSGI fallback не добавлялся. Изменён1 файл, +8/-4 строки.

Разрешённые проверки: Python ast.parse → `Python syntax OK: Backend/PersonnelStatus/Personnel-Records/organization_management/config/asgi.py`, exit0; `git diff --check` exit0. Синтаксис не доказывает фактический boot, повторный offline build/install выполняет контроллер. БД/контейнеры/сеть и секреты этой сессией не трогались; тесты не запускались.


## 10.09.2026 — Plane №1148: независимое review ASGI bootstrap

Исполнитель: Кодекс Астра 6. Scoped diff `58487289..92f849df` и фактический старый boot log подтверждают корректность переноса get_asgi_application до импортов model-dependent routes. Contour env не перезаписывается, HTTP использует созданный application, оба WS-маршрута и AuthMiddlewareStack сохранены. [[../WIKI/Ревью-1148-ASGI-bootstrap]]: spec compliance PASS для кода, code quality PASS, Critical0 / Important0 / Minor0. Reviewer ничего не тестировал/не собирал/не запускал; actual rebuild/boot у контроллера. Дополнительно пустой git diff --stat25e48491..58487289 подтверждает финальную границу десяти wrappers №1147.

- 2026-09-10, №1138/1148: backend bootstrap исправлен92f849df449edd324b639c99f88d33f76f66147a. Finalsnapshot92f849df, offlinebuild3exit0 (1138-offline-build-3.log). Передповтором остановленытолько5контейнеровпервоголабораторногопроекта, volumesсохранены. Бандлповторноперенесён docker cp в /install. Запущен bash /install/install.sh с COMPOSE_PROJECT_NAME=smart-josparlau-contour-final — новыйпроект/новаяпустаяБД, чтобыпроверитьфинальнуюверсиюснуля. Лог1138-offline-install-2.log. Исполнитель: Кодекс Астра 6.

### 10.09.2026 — №1138: выделена ingress-сеть для публикации proxy

Исполнитель: Кодекс Астра 6. По фактической проверке контроллера ASGI boot92f849df прошёл и install2 вернул0, но hostIP:3118 отвечал connection refused. На Docker27/29 proxy, подключённый только к internal сети, имел HostConfig.PortBindings80→3118 при NetworkSettings.Ports={}: публикация не включилась. По указанию контроллера nginx подключён к default internal:true и отдельной стандартной bridge-сети ingress. Backend/frontend/db/redis остаются только в default internal.

README уточняет: ingress не ограничивает egress proxy на online-хосте; физическая закрытость LAN обеспечивается хостом/контуром. Приложение не требует внешних сервисов, фактическую приёмку проводят в лаборатории без внешних маршрутов/DNS с доступом из connected LAN. Прежнее описание полной изоляции всех контейнеров internal сетью заменено, его нельзя использовать как обещание no-egress proxy. Лабораторную сеть эта сессия не меняла.

Коммит `c493128915159f7696b40a9a7ad5392f63d6416c`,2 файла,+16/-2. Разрешённая проверка `docker compose -f deploy/contour/docker-compose.yml config --quiet` с несекретными syntax-only placeholders → exit0; `git diff --check` → exit0, оба без вывода. Ни tests, ни build/start/HTTP этой сессией не запускались. Фактическую проверку published-port выполняет контроллер.

- 2026-09-10, №1138/1148: install2exit0,33секундыотсозданиядоздоровогостека; ASGI Application startup complete, freshmigrations/162staticfiles. Отдельный contour_admin создан в новойБД, парольтольковприватномфайле.
- ПроверкаIPвыявила runtimepublicationдефект: Docker27дляproxyтольковinternalnetworkпоказываетHostConfig.PortBindings, ноNetworkSettings.Ports={} иconnectionrefused. Исправленоc4931289: толькоproxyдобавленаingressbridge, остальныесервисынаinternal. Внешняяизоляцияproxyнеобещаетсянаобычномonlineхосте, READMEуточнён.
- Лабораторномуdaemonаналогичнодобавленsj-offline-ingress-1138; егоnamespace defaultмаршрутудалён, resolver127.0.0.1. HostNetworkSettings.Portsтеперьреально10.115.70.68:3118; выводrouteсодержиттольколокальныесети172.17/18/19/20/25. ПовторIPv4TCP1.1.1.1:443→Errno101Networkunreachable; DNSexample.com→Errno-3Tryagain. Сетьхоста/Plane/исходногостенданеменялась.
- Запущенаofflinebuild4изfinalsourcec4931289дляперепаковкиисправленногокомплекта; лог1138-offline-build-4.log. Исполнитель: Кодекс Астра 6.


## 10.09.2026 — Plane №1138: scoped review ingress c4931289

Исполнитель: Кодекс Астра 6. Прочитан только ingress diff compose/README: proxy подключён к default internal и ingress bridge, остальные4 сервиса остаются только internal без published ports. README честно разделяет доступ по LAN и отсутствие egress на online-хосте. [[../WIKI/Ревью-1138-Офлайн-бандл]] обновлён: spec compliance PASS с уточнённой границей, code quality PASS, Critical0 / Important0 / Minor0. Факты external socket/DNS refusal атрибутированы контроллеру; reviewer ничего не запускал/не тестировал и код не менял.

### 2026-09-10 — №1138: build4/install3 и доступ по IP

Исполнитель: Кодекс Астра 6. Исходники c493128915159f7696b40a9a7ad5392f63d6416c: offline build4 exit 0, архив перенесён docker cp в независимый /install; install3 exit 0, proxy публикует 0.0.0.0:3118 внутри лаборатории. Все четыре dependency-сервиса healthy. Внешний daemon публикует только 10.115.70.68:3118. Для ответов браузеру добавлен единственный маршрут 10.115.70.68/32 via 172.25.0.1; default route по-прежнему отсутствует. После этого curl по IP вернул HTTP 200 и same-origin CSP. Это настройка проверочной лаборатории, не изменение сети рабочего хоста или исходного стенда. Браузер открыл реальную форму входа по IP; выполняется вход отдельным contour_admin. Логи QA-Audits/contour-2026-09-10/1138-offline-{build-4,install-3}.log.

### 10.09.2026 — №1138: read-only диагностика Redis WS timeout и логирования query

Исполнитель: Кодекс Астра 6. По поручению контроллера выполнены только чтения через `docker exec sj-offline-daemon-1138 docker exec smart-josparlau-contour-final-backend-1 python -c ...`, чтение nginx.conf и обезличенный подсчёт строк логов. Стек, исходники, данные и секреты не менялись. Назначение отдельных карточек для исправлений ожидается.

**Подтверждённая причина WS reconnect.** Фактически установлены redis8.1.0, channels-redis4.3.0, channels4.3.2, Django5.1.15, uvicorn0.52.4, uvicorn-worker0.4.0. Из inspect.signature shipped redis.asyncio.connection.AbstractConnection.__init__: socket_timeout=5, socket_connect_timeout=5. Из actual runtime get_channel_layer: RedisChannelLayer, brpop_timeout=5, host option keys только host/port, socket_timeout не переопределён. Channels _brpop_with_clean вызывает `await connection.bzpopmin(channel, timeout=timeout)`, receive_single передаёт brpop_timeout5 и пропускает exception наружу. Redis read_response применяет собственный self.socket_timeout и по asyncio.TimeoutError отключает соединение и выбрасывает `TimeoutError: Timeout reading from redis:6379`. В пустом канале серверный BZPOPMIN5с и клиентский socket5с гоняются; клиент рвёт ожидающее чтение. Это ошибка сочетания конфигурации с фактической версией, не отсутствие Redis и не nginx proxy_read_timeout (он3600с). Последние300 строк backend:5 Redis timeout строк,4 accepted WS строки.

**Минимальное предложение для отдельной карточки.** Только в contour CHANNEL_LAYERS.hosts использовать dict с socket_timeout=None и socket_connect_timeout=5; серверный BZPOPMIN по-прежнему завершается через5с и loop продолжает ждать, async receive остаётся отменяемым. Не менять Redis cache, auth, nginx timeouts или transport URL, не откатывать redis package. Фактическую стабильность после изменения подтверждать тем же браузерным соединением и отсутствием Redis timeout.

**Логирование query — отдельная находка, не факт текущей утечки.** Nginx shipped /etc/nginx/nginx.conf имеет log_format main с `$request` и `$http_referer`, inherited access_log main; контур не переопределяет формат. ops/ws_auth.py документирует query token и требование URI без аргументов. При запросе ops JWT endpoint полный request может попасть в access-log. Но текущий frontend lib/ops-ws.ts открывает старый `/ws/notifications/` без token; в последних300 backend и147 proxy строках количество строк с `[?&]token=` равно0. Значения токенов не выводились и в vault не записаны. Нельзя считать потенциальную возможность доказанной текущей утечкой. Минимально nginx access-log должен использовать `$request_method $uri $server_protocol` и исключить request_uri/args/request/referrer.

Дополнительно shipped Uvicorn WebSocketProtocol.asgi_send на accepted/403 пишет `get_path_with_query_string(self.scope)` в logger.info. Поэтому санитарная настройка только nginx не закрывает queryJWT в backendлогах при ops-route. Перед карточкой исправления определить scoped redaction-filter для Uvicorn либо допустимый уровень его событий; без отдельного решения logging не менялся.

### 2026-09-10 — P1 runtime контура

Исполнитель: Кодекс Астра 6. В границах разрешённых P0/P1 исходного промпта созданы и взяты In Progress: 1150 Контур: Redis timeout разрывает канал WebSocket каждые пять секунд; 1151 Контур: исключить query-токены из журналов nginx и ASGI. Причины: реальный разрыв WS по равным timeout Redis и риск query JWT в двух access log слоях. Тесты запрещены; повторяется браузерный клик и наблюдение соединения.

### 10.09.2026 — №1150: устранена гонка Channels BZPOPMIN и Redis socket timeout

Исполнитель: Кодекс Астра 6. Карточка1150 In Progress, исправление разрешено контроллером. После read-only подтверждения redis8.1.0 socket_timeout5 против channels-redis4.3.0 brpop_timeout5 в contour settings CHANNEL_LAYERS переопределён отдельным dict: socket_timeout=None, socket_connect_timeout=5. Только channel layer; cache/auth/transport/front не менялись. Сервер Redis по-прежнему ограничивает BZPOPMIN5секундами, чтение не обрывается конкурирующим5-секундным таймером клиента.

Коммит `66360b3321e7202023ab4277e4fb6fb2178c7e82`,1 файл,+18 строк. Python ast.parse → `Python syntax OK: Backend/PersonnelStatus/Personnel-Records/organization_management/config/settings/contour.py`, exit0; git diff --check exit0. Ни тесты, ни runtime-команды, ни сборка/мутации стека при реализации не выполнялись. Реальную устойчивость idle WebSocket после сборки подтверждает контроллер браузером и логами.

### 2026-09-10 — №1138: фактическая изоляция, время и журналы

Исполнитель: Кодекс Астра 6. Повторная диагностика runtime сохранена в QA-Audits/contour-2026-09-10/1138-{outer-routes,outer-connectivity,container-logging,container-stats,runtime-settings}.txt. Внешний TCP 1.1.1.1:443: OSError101 Network unreachable; внешний DNS: gaierror -3. Единственный маршрут к пользовательскому IP 10.115.70.68/32, default отсутствует. Во всех пяти контейнерах Docker json-file 10m×3. Django RotatingFileHandler 10485760 bytes×6 (текущий +5 архивов). Runtime TIME_ZONE и CELERY_TIMEZONE Asia/Qyzylorda; local_now +05:00 и UTC_now совпадают по моменту. Celery schedule пуст и worker/beat не запущены — фоновые сценарии не подтверждены.

Замер памяти: frontend 91.76MiB/1GiB, backend140.2MiB, db37.15MiB, Redis5.039MiB, proxy14.98MiB. RSS next-server максимум274152КБ, ниже2500000. Свободно7.5ГБ, архивы и исходные стенды не удаляли. git fetch выполнен; origin/main остаётсяb9232b1d. Git напечатал предупреждение старого gc.log/unreachable objects, prune/очистка не выполнялись.

### 10.09.2026 — №1151: query исключён из nginx/Uvicorn access и handshake logs

Исполнитель: Кодекс Астра 6. Карточка1151 In Progress, исправление разрешено контроллером. В deploy/contour/nginx.conf добавлен log_format contour_path с request_method/uri/server_protocol, status/bytes/user-agent; исключены request/request_uri/args/referrer. Server access_log использует этот формат для всех локаций, включая WS.

Shipped UvicornWorker.__init__ прочитан read-only: он назначает handlers uvicorn.error/uvicorn.access до Django startup, создаёт Config с log_config=None. Django contour LOGGING назначает ASGIPathOnlyFilter этим двум логгерам, выводит INFO/error события в прежние bounded console+file handlers без propagation. Фильтр изменяет ТОЛЬКО строковые positional path args, начинающиеся `/`, отсекая `?query`; record.msg, status, level, exception и traceback сохраняются, события не подавляются. uvicorn.error включён намеренно: WebSocket accepted/403 в shipped Uvicorn идут именно туда, фильтр одного access не защищает handshake. Другие логгеры, auth, frontend и протоколы не менялись.

Новый helper `organization_management/config/logging_filters.py` tracked; snapshot.py включает tracked backend/config файлы, поэтому helper попадёт в source/bundle без изменения snapshot allowlist. Коммит `301e3754da273d8af6003ae9457c6db40fd056e1`. Python ast.parse settings/contour.py и logging_filters.py дал2×`Python syntax OK`, exit0. Реальный nginx1.28-alpine `-t` в одноразовом --network=none --pull=never контейнере без published ports дал `syntax is ok`/`test is successful`, exit0. git diff --cached --check exit0. Это только синтаксис, не runtime/filter-тест; тесты, heavy builds и mutations live stack не выполнялись. Runtime redaction и повторный idle browser WS подтверждает контроллер после сборки.

Уточнение предыдущей записи1150: фактический diff66360b33 содержит+17строк (ранее ошибочно написано+18). SHA и содержимое конфигурации прежние.


## 10.09.2026 — Plane №1150: независимое scoped review Redis timeout

Исполнитель: Кодекс Астра 6. Diff `c4931289..66360b33` проверен по actual shipped source через разрешённый read-only nested docker exec: Redis socket_timeout5, Channels brpop_timeout5; create_pool передаёт dict options в ConnectionPool, socket_timeoutNone убирает клиентский timer, cancellation сохраняется. [[../WIKI/Ревью-1150-Redis-WebSocket-timeout]]: spec compliance PASS для кода, code quality PASS, Critical0 / Important0 / Minor0. Reviewer тесты/сборку/сетевые пробы и мутации runtime не запускал; браузерное подтверждение после установки выполняет контроллер.

### 2026-09-10 — №1138/1150/1151: финальная перепаковка

Исполнитель: Кодекс Астра 6. Snapshot301e3754da273d8af6003ae9457c6db40fd056e1 включает1025 tracked app/deploy файлов; новый logging_filters.py включён. №1150 independent review PASS без замечаний. №1151 передан на review. Запущена build5 в изолированном daemon без внешнихмаршрутов/DNS и с Docker build --network=none. Лог1138-offline-build-5.log. Это генерацияартефакта, pytest/e2e/smoke не запускались.


## 10.09.2026 — Plane №1151: независимое scoped review журналов

Исполнитель: Кодекс Астра 6. Diff `66360b33..301e3754` и shipped UvicornWorker/HTTP/WS logging source подтверждают filters/ordering; snapshot включает tracked helper. Найден1Important I1: nginx inherited error_log notice сохраняет полные request_line/upstream/referrer при upstream errors; access format этого не санитизирует. Источник nginx1.28 и фактический nginx.conf прочитаны без провокации ошибок/чтения секретов. [[../WIKI/Ревью-1151-Query-токены-логирование]]: spec/code CHANGES REQUIRED, Critical0/Important1/Minor0. Утечка в текущем браузере не заявлена. Reviewer не тестировал/не собирал/не мутировал runtime.

### 2026-09-10 — №1151: review выявил error-log путь

Исполнитель: Кодекс Астра 6. Build5 из301e3754 завершён exit0. Independent review подтвердил ASGI-фильтры и nginx access format, но выявил Important: nginx error_log включает request_line/upstreamURI/referrer с query при проблеме upstream. Утечка текущего JWT не наблюдалась, путь подтверждён исходником nginx. Карточка1151 остаётся In Progress, в Review не переводим. Исполнитель готовит contour-only очистку error сообщений без потери основной диагностики. Комплект301e3754 сейчас переносится в /install для отдельного браузерного повтора исправления Redis1150; итоговая упаковка будет после error-log fix.

### 2026-09-10 — №1150: браузерный повтор

Исполнитель: Кодекс Астра 6. Install4 (301e3754) exit0. В прежней вкладке http://10.115.70.68:3118/security-ops/profile/ сообщение кнопки изменилось с «Уведомления ОМ (переподключение…)» на «Уведомления ОМ (онлайн)». Лог после нового startup: 1 accepted, 0 Redis TimeoutError, 0 connection closed; наблюдение 2026-09-10T08:48:22.911262+00:00. Скрин1150-profile-after.png и1150-ws-after.log. Старый лог содержит3timeout/3accepted в220строках. Это фактический браузерный повтор, не pytest/e2e.

### 10.09.2026 — №1151: закрыт review residual в nginx error-log

Исполнитель: Кодекс Астра 6. Независимое review подтвердило: безопасный access-log не покрывает error_log notice — nginx добавляет полный request/upstream/referrer при upstream failure. По разрешению контроллера добавлены production nginx-error-filter.awk и proxy-entrypoint.sh без новых зависимостей. BusyBox awk отсекает query-сегмент от `?` до whitespace/quote в каждой строке, оставляя отметку `?[redacted]`, error diagnostic, URI paths и остальные поля. Каждая строка flush сразу. Никакие error-события по уровню не отключаются. Server error_log явно stderr notice, master error.log в shippedimage является symlink /dev/stderr и попадает в тот же поток.

POSIX shell supervisor (PID1) запускает filter-reader FIFO и оригинальный /docker-entrypoint.sh → nginx, передаёт TERM/INT/QUIT/HUP/USR1 главному процессу, повторяет interrupted wait, дожидается завершения nginx и EOF/drain reader, возвращает nginx status (если nginx успешен, но reader упал — reader status). FIFO во временном закрытом каталоге mode600; сырые логи в обычный файл не пишутся. Идея directexec nginxPID1 отвергнута: контейнер мог бы завершиться до drain последних startup/error строк. Nginx пакет/сеть не менялись, CMD daemon off явный. Snapshot explicit allowlist дополнен обоими helperфайлами.

Коммит `5ef686a821273fb413b416c3f0391a54f189706f`,5файлов. Проверки только синтаксические: `sh -n deploy/contour/proxy-entrypoint.sh` exit0; BusyBox awk1.28-alpine `-f /filter.awk /dev/null` (пустойввод, толькоparse) exit0; фактический nginx1.28-alpine `-t` с new config в одноразовом --network=none --pull=never контейнере без published ports → `syntax is ok`/`test is successful`, exit0; Python ast.parse snapshot.py → `Python syntax OK`, exit0; git diff --cached --check exit0. Test scripts не создавались, heavybuild и live-stack mutations отсутствуют.

Контроллер подтвердит actual runtime: свой backend кратко остановить, browser запрос admin с несекретным markerquery вызывает502, затем восстановитьbackend; проверить наличие полезнойошибки и отсутствиеmarker; proxy stop/start дляsignals/drain. Это ещё не выполнено этой сессией и не заявляетсякакрезультат. Предыдущее Uvicornрешение301e3754 review признало корректным, не изменялось. Контроллер также сообщил фактическую устойчивость Redis1150 >43с без reconnect/timeout.

### 2026-09-10 — №1151: error-redaction и build6

Исполнитель: Кодекс Астра 6. 5ef686a821273fb413b416c3f0391a54f189706f добавляет nginx error-log FIFO→BusyBoxawk, очистку query в request/upstream/referrer, передачу сигналов и ожидание drain. Snapshot1027файлов включаетобаhelper, secrets/env исключены. Запущена офлайнbuild6 (лог1138-offline-build-6.log), reviewfix2параллельно. Послеinstallбудетфактическая браузерная проверка harmlessquery при краткойостановке ТОЛЬКОbackend собственного offlineпроекта, немедленныйstart и повторadmin. Это локальная проверка ошибкиupstream без измененияпользовательскихданных и без остановкистенда3108/8100.

### 2026-09-10 — №1151: фактический stop с WebSocket

Исполнитель: Кодекс Астра 6. Build6 из5ef686a8 exit0, но review указал на унаследованныйSIGQUIT без worker_shutdown_timeout. Контроллер остановил только текущий proxy source301e3754 с активным браузернымWS: docker stop --time10, inspect ExitCode137, StopSignalSIGQUIT — принудительное завершение после grace. Немедленныйdockerstartуспешен; серверы3108/8100/БДнетронуты. Доказательство1151-proxy-stop-before.txt. Запрошен минимальный deadline5s в maincontext nginx CMD -g, чтобы новый supervisor успевал дочитатьлоги до Dockergrace. Карточка1151 остаётся InProgress до повтора.


## 10.09.2026 — Plane №1151: review error redaction fix2

Исполнитель: Кодекс Астра 6. Diff5ef686a8 закрывает I1 через FIFO+awk sanitized stderr, snapshot helpers и signal/drain supervisor корректны на нормальном завершении. Обнаружен lifecycle I2: inherited SIGQUIT (image inspect) и отсутствие worker_shutdown_timeout не ограничивают ожидание активного WS до Docker stop deadline. [[../WIKI/Ревью-1151-Query-токены-логирование]]: redaction PASS, суммарный code/spec CHANGES REQUIRED по1Important, Critical0. Контроллер проверяет фактический stop; reviewer не запускал тесты/сборку/сеть/мутации.

### 10.09.2026 — №1151: ограничен graceful shutdown nginx workers

Исполнитель: Кодекс Астра 6. Факт от контроллера: source5ef686a8 успешно собрался в build6, но `docker stop --time10` собственного offline proxy при активном browser WebSocket завершил контейнер ExitCode137, StopSignalSIGQUIT. Контроллер сразу запустил только этот proxy заново. Причина: наследуемый graceful shutdown nginx ждёт активный WS без дедлайна; Docker через10секунд убивает PID1 до гарантированного завершения/drain.

Минимальный fix: в deploy/contour/Dockerfile.proxy CMD добавлена main-context директива `worker_shutdown_timeout 5s;` через `nginx -g`, рядом с daemon off. В conf.d/http-context директива не добавлялась. Shell supervisor, FIFO/filter, frontend и остальные настройки не менялись. Пять секунд ограничивают worker lifecycle и оставляют запас до Docker10s для выхода master и drain stderr.

Коммит `089a38678dbe2f5ef6976ffd057defa7400f53d0`,1 файл,+1/-1. Разрешённая syntax-команда с фактическим nginx1.28-alpine в одноразовом --network=none --pull=never контейнере без ports: `nginx -t -g 'daemon off; worker_shutdown_timeout 5s;'` → `syntax is ok`, `test is successful`, exit0. `git diff --check` exit0. Тесты/build/runtime-stop/start этой сессией не запускались. Контроллер выполнит final build7 и повторит реальную остановку; окончательный lifecycle успех пока не заявляется.

### 2026-09-10 — №1138/1151: build7 из окончательного кода

Исполнитель: Кодекс Астра 6. 089a38678dbe2f5ef6976ffd057defa7400f53d0 ограничиваетgracefulworkershutdown5секундами через nginx -g maincontext. Snapshot1027файлов. Build7 запущена в прежнем изолированномdaemon, reviewоднострочногоfix3запрошен. Финальныйcommitmainпока не обновлён, задача1151 доactualstop/errorlogповтора остаётсяInProgress.


## 10.09.2026 — Plane №1151/1138: финальное scoped review089a3867

Исполнитель: Кодекс Астра 6. Однострочный diff1151-review-fix3 проверен: nginx -g сохраняет daemon off и добавляет worker_shutdown_timeout5s в main context. I2 закрыт по коду, новых findings нет. [[../WIKI/Ревью-1151-Query-токены-логирование]] и [[../WIKI/Ревью-1138-Офлайн-бандл]] обновлены: итог всей проверенной ветки089a38678dbe2f5ef6976ffd057defa7400f53d0 — spec/code PASS, Critical0/Important0/Minor0. Actual build7/install/browser/error-marker/stop продолжаются у контроллера; reviewer их не запускал и не объявляет завершёнными.

### 2026-09-10 — №1151: браузер и фактические безопасные логи

Исполнитель: Кодекс Астра 6. Install5 из089a3867 exit0. Попытка получить502 кратким dockerstop собственного backend не дала502: браузерная навигация ждаласоединение, CUA timeout20s; backendнемедленно восстановлен, вкладкапозднееоткрылаadmin. Этотпуть не считаемдоказательством502. Рабочие3108/8100незатронуты.

Для реальногоnginxerror безостановкислужб браузером открыт /media/contour-missing-1151.png?token=contour-safe-marker-1151. Получен ожидаемый404 отсутствующегофайла; nginx errorlog сохранил open() failed, errno2, путь, client/host/status, но request query стал ?[redacted]. Accesslogпутьбезquery. Полныйбезопасныймаркер отсутствуетвDockerlogs. Это1151-error-log-after.txt и1151-error-page-after.png. После восстановленияbackend adminURIсmarker прошёл вASGIaccessлогбезquery (1151-asgi-access-after.txt). Полезнаядиагностика не отключалась.

### 2026-09-10 — №1138/1151: финальная runtime-приёмка

Исполнитель: Кодекс Астра 6. Финальный source089a38678dbe2f5ef6976ffd057defa7400f53d0, build7 exit0, install5 exit0 с проверкой checksum/load/no-build/no-pull. Новый proxy с активнымWS: stop за5.31s, ExitCode0, SIGQUIT; start exit0. Прежнийstop137 исправлен. Dockerlogs сохранили диагностическуюerrorстроку, query=[redacted]. Browser повтор: портал меню→Выйти→форма→Войти →/security-ops/profile/, УведомленияОМ(онлайн); admin Log out→Log in again→Log in →/admin/, Разделы, contour_admin. Скрины1138-final-portal.png,1138-final-admin.png. Pytest/e2e/smoke/новыетестынезапускались. Source diffcheck exit0, рабочеедеревочисто; independent review PASS Critical0/Important0/Minor0. Комплектbaselineблока1 готов, полныйпромпт№1137 ещё требуетблоков2–7.

### 2026-09-10 — группа1138 опубликована и передана Review

Исполнитель: Кодекс Астра 6. HEAD/main/origin-main089a38678dbe2f5ef6976ffd057defa7400f53d0; branchcodex/contour-offline-1138 опубликована, mainпродвинутfast-forwardотb9232b1d. Исходныйdirtyworktreeнеизменён. Plane1138,1147,1148,1150,1151→Review, комментариибыло/сталосдоказательствамиотправлены; On test/Doneнеставили. Новыхкомментариевзаказчикавтекущихкарточкахпередпереходомнет. Следующаяразрешённаягруппа1139, отдельнаяноваязадачаCodex.

### 2026-09-10 — окончание группы и пересборка очереди

Исполнитель: Кодекс Астра 6. Полный Plane list --open: exit 0, сохранён plane-open-after-1138.txt. Максимальный RSS next-server 273688 КБ при пороге 2500000; диск 7.5 ГБ свободно. Hash HEAD/main/origin-main совпадает: 089a38678dbe2f5ef6976ffd057defa7400f53d0, рабочее дерево чистое. Подготовлена [[../WIKI/Передача-1139-Вход-права-сотрудники-2026-09-10]]; следующая группа создаётся в новой задаче по №1107 без повторного разрешения.

### 2026-09-10 — создана новая задача блока 2

Исполнитель: Кодекс Астра 6. create_thread принял новую задачу «Контур — блок 2: вход, права, пользователи и сотрудники», новый worktree от main. Setup clientThreadId: client-new-thread:5b929933-294a-4fe1-9c87-cac7a1802cad. Переданы №1139, исходный промпт, план, финальные SHA/доказательства/ограничения и обязанность продолжить цепочку до №1144 в новых сессиях. Фактический старт ещё ожидается, создание само по себе не считается началом исполнения. Финальная повторная проверка изоляции дала TCP Network unreachable и DNS Try again (1138-final-isolation.txt).


### 2026-09-10 — старт группы №1139

Исполнитель: Кодекс Астра 6. Прочитаны передача1139, исходный промпт и план1137; продолжается разрешённая очередь. Plane1139 In Progress, отдельная чистая worktree9c83, ветка codex/contour-access-1139 от опубликованного main089a38678dbe2f5ef6976ffd057defa7400f53d0. Порядок: /organization и девять acc_* → refresh/inactive → сайт/admin пользователи и сотрудники → импорт → review/build при изменениях → push/main/Review → новая сессия1140. Гейт только браузер, тесты запрещены. Исходный dirtyworktree, чужие процессы и offlineконтур сохраняются. Статический разбор auth/маршрутов поручен независимому subagent по Superpowers, браузер ведёт основной исполнитель.

### 2026-09-10 — фактический старт следующей группы подтверждён

Исполнитель: Кодекс Астра 6. Новая задача №1139: `01a08a8e-97ad-74d0-b30b-502dde5120df`, worktree `/home/erda/.codex/worktrees/9c83/Smart Josparlau` от main `089a38678dbe2f5ef6976ffd057defa7400f53d0`. После завершения setup сопоставление получено из локального session_index (list_threads временно не показывал новую задачу); повторную задачу не создавали. Официальный wait_threads подтвердил active/inProgress и сообщение исполнителя: передача №1139, исходный промпт и план №1137 прочитаны; применяет Superpowers, начинает с /organization и матрицы acc_*, браузерный гейт с записями vault. Очередь фактически продолжена, блок 2 в этой прежней сессии не выполнялся. Обязанность новых сессий до №1144 передана в начальном поручении.


2026-09-10 — №1139. Исполнитель: Кодекс Астра 6. Через сайт создана контрольная учётка contour_1139_site (id86), выдана EMPLOYEE→Первый департамент, новый вход и /statuses показывают142 сотрудника. В admin учётка найдена, First name изменён Сайт→СайтАдмин, после reload имя отображается на сайте. Через сайт роль снята (Роли0), учётка заблокирована; повторный вход тем же рабочим паролем отвергнут. Генерированный пароль только /home/erda/.config/vaps/contour-1139-site-password600, не в документации/репозитории. Контрольные записи сохранены, чужие данные не менялись. Скрины1139-site-account-role,1139-new-account-statuses,1139-site-inactive,1139-inactive-login-denied. Остальные acc_ops_staff/acc_admin видят4департамента442штатки,440занятых,2вакансии; ошибка/выход/повтор проверены для обоих, настройкиШтабу закрыты.


2026-09-10 — №1139. Исполнитель: Кодекс Астра 6. В admin user86 Active=False подтвердился, Active восстановлен и сохранён. Вход новой учётки вновь работает, /statuses после снятия роли честно Доступ закрыт (1139-revoked-role-denied.png). Через сайт создана отдельная CONTOUR_1139, ей выдано orgstructure.view, роль назначена user86 на Первый департамент631. Admin userrole80 показывает те же данные; область через admin изменена на Второй департамент647 и сразу видна на сайте. Имя роли admin изменено на Контур1139 админ, сайт подтверждает новое имя. Сайт: Снять право→Снять даёт Состав прав0; Отключить→кнопкаВключить. Скрины1139-custom-role-permission/1139-role-disabled. Поиск CONTOUR_1139 в admin UserRole даёт0 при существующей строке80 — записано как зона блока3, причина/карточка ещё уточняются.

2026-09-10 — №1139. Исполнитель: Кодекс Астра 6. Для принудительной browserпроверки refresh собственный integratedDjango2123416 заменён backend9c83 PID2328752; временный accessTTL60s, refresh7суток/rotation/blacklist сохранены. Script/tmp/sj-backend-1139.py, privateenvнепечатался. После проверки вернуть8часов перезапуском без CONTOUR_SHORT_TTL. Новыйfrontend2326324 на3108.

2026-09-10 — №1139. Исполнитель: Кодекс Астра 6. TTL60s оказался равен клиентскому EXPIRY_SKEW_MS60000: вход немедленно запускает несколько ротаций, сервер200затем401, экран Не удалось загрузить права. Это пока не приписано штатномуTTL8h; повторяем сTTL180s (больше запаса), PID2331418. Скрин1139-short-ttl-before.png; источник/tmp/sj-backend-1139.log.

2026-09-10 — №1139. Исполнитель: Кодекс Астра 6. Чистая browserсессия127.0.0.1:3108 acc_dir_head сTTL180s сохранила /statuses спустя243s; кнопкаОбновить дала новую отметку14:30:31, доступ26сотрудников своегоуправления сохранён. СерверPOSTrefresh200 в14:28:34; лог1139-ttl-refresh-log.txt. Скрин1139-ttl180-after-expiry.png. После проверки backendперезапущен со штатнымTTL8h, PID2345975, refresh7сутокrotation+blacklist неизменны. Старую вкладкуlocalhost сterminalloop закрыли послефиксации1154; новаярабочаяосталась.

### 2026-09-10T14:35+05:00 — №1139: синтетический сотрудник и права

Исполнитель: Кодекс Астра 6.

Через браузер Django admin создан синтетический сотрудник №5131 (табельный 911390, Контур1139 Контрольный), привязан к тестовой учётке №86 и новой штатной единице №5559 второго департамента (647), должность Инспектор. На сайте поиск в «Сотрудниках Службы» вернул запись с теми же ФИО, должностью, подразделением и статусом; карточка открылась. Существующие кадровые записи не менялись. Скрин: [[QA-Audits/contour-2026-09-10/1139-employee-admin-to-site.png]].

Созданные роль CONTOUR_1139 и право contour1139.read проверены через сайт, право снято и роль отключена; область назначения №80 менялась в админке с 631 на 647 и отобразилась на сайте. Учётка86 после блокировки не вошла, после восстановления активности без роли получила честный отказ в статусах.

Кликами найдены неработающие Импорт и Экспорт на /statuses: карточки №1155 и №1157. Их исправление передано агенту; №1156 (пункты редактирования/удаления в сборе сил) пока требует подтверждения кликом. Сборка и runtime-проверка исправления входа №1154 ещё впереди; код сохранён в 331b3809.

### 2026-09-10 — №1139: сборка общего артефакта

Исполнитель: Кодекс Астра 6.

При чистом worktree HEAD4ed3427d запущена npm run build:check, лог /tmp/sj-build-1139-final.log. Собственный frontendPID2326324 остановлен для замены .next-build; cwd standalone подтверждён (старый каталог уже удалён сборщиком). Сначала проверка точного cwd отклонила остановку, затем путь уточнён. Админка8100 доступна, посторонние серверы не тронуты. Браузерный гейт предстоит.

### 2026-09-10 14:46 — №1139: общий артефакт и рестарт

Исполнитель: Кодекс Астра 6.

HEAD4ed3427d. npm run build:check exit0, Compiled successfully11.5s,39/39 страниц. Видимый хвост /tmp/sj-build-1139-final.log; повторные тесты не запускались. Прод3108 PID2387623; Django8100 PID2389083 перезапущен из текущего worktree, defaultaccessTTL8h. Возобновлён браузерный гейт.

Через сайт user86 выполнен сброспароля: прежний отклонён, новый вошёл. Через admin/auth/user/86/password выполнена смена: Password changed successfully. Секреты только в закрытом файле; дальнейшая проверка нового пароля предстоит. В админке создан contour_1139_admin, сохранено имя АдминСоздан Контур1139; паритет на сайте предстоит. Новый employee5131 присутствует в матрице, страница2 из5 (DOM1139-new-employee-calendar.txt); календарь читает канонические OpsEmployeeStatus, а кадровая Учёба видна в /statuses — различие источников сохранено для последующих блоков, не объявляется одинаковым статусом.

### 2026-09-10 — №1139/1153: кадровое создание и правка через сайт

Исполнитель: Кодекс Астра 6.

В новой форме подacc_admin создан employee5132, табельный911391, Контур1139Сайт Проверка, синтетический ИИН000000113901, позывнойС1139, второйдепартамент, Инспектор, привязка к созданномувadmin user87 contour_1139_admin. Поискучётки сохранилранее введённыеполя. Сайтвернул1сотрудника; admin/employee/5132 показываеттеже данныеипривязку87. Скрин1139-site-created-employee.png. Черезсайт имяизмененонаПравка; повторнаяформа сразу показываетПравка, админка послеобновления такжепоказываетПравка. Отмена закрылаформу. Смена пароля user86 черезadmin подтвержденапоследующимуспешнымвходомнасайте.

2026-09-10, №1139/1154/1153. Исполнитель: Кодекс Астра 6. Backend перезапущен на HEAD519809ec, PID2402678; временный accessTTL180 для повторного браузерного гейта terminal отказа. Refresh7days/rotation/blacklist не меняются. После проверки вернуть8h. Frontend2387623 остаётся, изменений фронта после его сборки нет.

### 2026-09-10 — №1155/1157/1159: браузерные повторы

Исполнитель: Кодекс Астра 6.

Импорт отсутствует на /statuses. Клик «Экспорт страницы CSV» создал файл413байт в Загрузках; прочитано содержимое: заголовок и ровно две строки фильтраКонтур1139, без чужих строк. Копия1139-export-page.csv в каталоге доказательств.

№1159: employee5132 Встрою→Учёба,10–11сентября, Сохранить: строка сразуУчёба безручногоОбновить. Скрин1139-status-immediate-after.png. №1156: Редактировать в действияхemployee5131 открыло кадровую форму с полями и кнопкойДеактивировать; скрин1139-employee-edit-after.png.

Отдельное наблюдение: возврат5131 Учёба→Встрою обычным диалогом создал201, новыйGET выполнен, но строкаосталасьУчёба. Причина ещё расследуется; это не выдано за успешный возврат. Сейчас проверяется штатная команда Завершить досрочно.

2026-09-10, №1139. Исполнитель: Кодекс Астра 6. Terminal-сессия после блокировки user87 вернулась в форму с сообщением «Сессия истекла — войдите заново»; повторный вход acc_employee_d2 успешен. Скрин1139-terminal-login-after.png. Временный TTL снят: backendPID2417771, HEAD601af907, access8h; никаких параметров JWT в коде проекта не менялось.

### 2026-09-10 — №1139: итог повторов кадрового сценария

Исполнитель: Кодекс Астра 6.

Уточнение предыдущего наблюдения Учёба→Встрою: скрин раскрытого списка показал, что пункт находился ниже видимой области. Предыдущие попытки не изменили combobox, и сохранение честно отправляло Учёбу. После прокрутки списка (End) и клика по видимому «В строю» форма показала выбранное значение, даты скрылись, сохранение сразу обновило строку. Скрин1139-return-in-service.png. Серверный дефект или race этой проверкой не подтверждены, лишняя правка не выполнялась. Штатное «Завершить досрочно» у5131 также перевело в строй.

Расход на10.09.2026: раскрыт второй департамент, обе новые записи видны поимённо (1139-employees-in-daily-expense.txt). Через админку с новым полем Is active подтверждена деактивация5132 с сайта, выполнена активация, сайт снова вернул1запись. Затем обе синтетические записи5131/5132 деактивированы через админку: сайт поКонтур1139 вернул0. Скрин1139-deactivated-employees-hidden.png. Данные и штатные единицы не удалялись.

После меню1158 повторены все9acc_*: недоступные разделы видны отключёнными; восемь неадминских учёток получили честный отказ по /settings/users. Количество отключённых пунктов: employee17,dir_head15,dir_head_d2 11,dept_head12,dept_head_d2 11,forces_officer11,employee_d2 12,ops_staff12; admin0. DOM и PNG1139-acc_*-menu-after в каталоге доказательств.

## 2026-09-10 — №1139: гейт блока2, подготовка Review

Исполнитель: Кодекс Астра 6.

Код HEAD `601af907773091a421cf8803c20a9c40339a2f0b`, 13 коммитов после `089a3867`; 15 файлов. Все изменения прошли независимое статическое ревью, итог P0/P1=0 (заметки Ревью-1152,1153,1154,1155-1157-1159,1156,1158,1160 в WIKI). `git diff --check` exit0; чистый worktree. Фронт собран `npm run build:check` на4ed3427d, exit0,39/39страниц; последующие393dee07,519809ec,601af907 — только backend. Django работает на финальном HEAD, PID2417771, штатный accessTTL8h восстановлен. Прод3108 PID2387623, RSS141880КБ; максимум next-server257524КБ, ниже порога2500000. Пуш и Review — следующий шаг, пока не объявлены выполненными.

Браузерный результат: вход/неверный пароль/выход/повторный вход для9acc_*; короткая живая сессия продлена после243сек приTTL180; terminal отказ после блокировки отдельной учётки вернул форму, новый вход успешен. Меню по правам повторено для9acc_*, закрытые адреса честно запрещены; employee/employee_d2 больше не получают ложную пустую оргструктуру. Проверены создание учётки с сайта и изадминки, назначение/снятие роли и области, выдача/отзыв права, изменение роли/права вадминке с отображением на сайте, смена пароля обоими путями, блокировка. Кадровое создание и редактирование обоими путями, привязки к должности/подразделению/учётке, статусы и деактивация с паритетом проверены. Сотрудники в расходе и сборе сил; новая кадровая запись в календарной матрице. Экспорт страницы CSV скачан и прочитан:413байт,2строки фильтра; пустая кнопкаИмпорт убрана.

Контрольные данные сохранены без удаления: users86/87 заблокированы; employees5131/5132 неактивны; новые штатные позиции оставлены; CONTOUR_1139 и contour1139.read отключены. Секреты только ~/.config/vaps, значений в журнале нет.

Ограничение доказательств: CUA вернул последние100записей консоли, в них0warn/error; DOM адреса8ресурсов — без внешних абсолютныхURL. Это не полныйNetwork/HAR и не заменяет сетевой гейт блока1. MSW пишет Mocking enabled на/settings, но список mock-доменов по умолчанию пуст, реальные мутации подтверждены паритетом Django; документационные URL в консоли сами по себе не сетевые запросы. Полный аудит админки, справочников и канонических статусов продолжается блоками3–6.

2026-09-10. Исполнитель: Кодекс Астра 6. Push ветки и fast-forward origin/main/localmain выполнены до601af907. №1139,1152–1160 переведены Review с подписанными комментариями. Снимок открытойочереди plane-open-after-1139.txt пересобран. Передача следующейгруппы: [[Передача-1140-Админка-bootstrap-2026-09-10]].

2026-09-10. Исполнитель: Кодекс Астра 6. Новая задача №1140 отправлена на создание отдельного worktree: client-new-thread:f5028c31-dd09-4ca5-8591-092b7906dc08. Фактический старт ещё ожидается; до подтверждения переход не объявляется завершённым.

## 2026-09-10 — подтверждён переход №1139 → №1140

Исполнитель: Кодекс Астра 6.

Новая задача Codex `01a08acf-4dba-7270-a54f-78c8fce92453` фактически начала работу в отдельном worktree `/home/erda/.codex/worktrees/fac2/Smart Josparlau`. `wait_threads` вернул active, latestTurn inProgress и сообщение: «№1140 уже в In Progress; старт записан во втором мозге. Worktree fac2 чистый и совпадает с переданным main». Переход выполнен без повторного разрешения; следующую группу в прежней задаче не начинали. В новой задаче сохранена обязанность продолжить цепочку1141–1144 отдельными задачами.

Итог №1139: код и origin/main на601af907, карточки1139/1152–1160 вReview; браузерные доказательства и ревью в vault. Работа над всей очередью продолжается в новой задаче, готовность всего проекта не заявляется.

2026-09-10, №1140. Исполнитель: Кодекс Астра 6. Создана отдельная PostgreSQL БД contour_bootstrap_1140 для чистого bootstrap. Живая personnel_records не очищается. Выполняется migrate, лог /tmp/sj1140-migrate.log.

2026-09-10, №1140. Исполнитель: Кодекс Астра 6. После команды «дальше» обнаружена перезагрузка машины (uptime start17:08:46); /tmp helpers/env исчезли, порты3108/8100 свободны. Код и vault сохранены. Восстановление runtime через persistent ~/.local/state/smart-josparlau/1140; база не очищается.

- 10.09.2026, Plane №1140, после перезагрузки. Исполнитель: Кодекс Астра 6. Изолированная contour_demo_1140 localhost:5434: операционная подготовка migrate, exit 0. Лог: `/home/erda/.local/state/smart-josparlau/1140/demo-migrate.log`. Данные не удалялись; сервер8100 не менялся. Браузерный гейт остаётся родительской сессии, тесты не запускались.

- 10.09.2026, Plane №1140, после перезагрузки. Исполнитель: Кодекс Астра 6. Изолированная contour_demo_1140 localhost:5434: операционная подготовка missing-passwords, exit 1. Лог: `/home/erda/.local/state/smart-josparlau/1140/demo-missing-passwords.log`. Данные не удалялись; сервер8100 не менялся. Браузерный гейт остаётся родительской сессии, тесты не запускались.

- 10.09.2026, Plane №1140, после перезагрузки. Исполнитель: Кодекс Астра 6. Изолированная contour_demo_1140 localhost:5434: операционная подготовка first, exit 0. Лог: `/home/erda/.local/state/smart-josparlau/1140/demo-first.log`. Данные не удалялись; сервер8100 не менялся. Браузерный гейт остаётся родительской сессии, тесты не запускались.

- 10.09.2026, Plane №1140, после перезагрузки. Исполнитель: Кодекс Астра 6. Изолированная contour_demo_1140 localhost:5434: операционная подготовка second, exit 0. Лог: `/home/erda/.local/state/smart-josparlau/1140/demo-second.log`. Данные не удалялись; сервер8100 не менялся. Браузерный гейт остаётся родительской сессии, тесты не запускались.

2026-09-10, №1140/1165. Исполнитель: Кодекс Астра 6. После восстановления повтор bootstrap_contour exit0: должностей создано0/уже9, званий0/уже10, структура0/уже48,17типов статусов. Browser clean DB:1user (отдельный createsuperuser),0сотрудников/0ОМ/0обращений,12должностей/10званий/17статусов/28ролей/7метрик. Учтены3общие должности init_dictionaries плюс9русских. Browser после назначения user1→ADMIN через Django показывает полный доступ к настройкам и1учётку,0сотрудников и пустойреестрОМ. Найденный пропуск рунбука заведён1165 In Progress, инструкция дополнена: Django superuser и OMроль независимы, роль назначается явно. Скрины1140-clean-*.png, DOM1140-clean-bootstrap-ui.json. Повтор bootstrap не создал демо.

2026-09-10, №1140. Исполнитель: Кодекс Астра 6. Demo contour_demo_1140 после двух --demo запусков (0/0): вход acc_admin через портал успешен, видимы426сотрудников и37учёток (9acc_*+28role_*), повтор не размножил учётки. Реестр ОМ пуст: штатный seed_operations не создаёт OpsSecurityEvent, это не выдаётся за демо-мероприятия. Данные демо-набора отделены от clean; обеБД сохранены. Скрины/DOM1140-demo-*. Прод3108PID13530 восстановлен из4ed3427d artifact (frontend не менялся). Возвращаем8100 на personnel_records текущей веткиfac2.

2026-09-10, №1140/1165. Исполнитель: Кодекс Астра 6. Bootstrap/deploy коммит `510c680a54d487260cb291ac4a8f82c99cdda720` создан:8файлов; чистый/demobrowser и повторный запуск описаны выше. Новый offline bundle не собирался — этап1144. Push следующий.

2026-09-10, №1140/1161/1162/1164/1165. Исполнитель: Кодекс Астра 6. Коммиты61920812f33d8173c86c9fae06421fb22d909fb8/510c680a54d487260cb291ac4a8f82c99cdda720 запушены, localmain/originmain/branch совпали510c680a. Пятькарточек переведеныReview сявнойграницейпокрытия. ОчередьPlane пересобрана:1155всего/816открытых. Передача [[WIKI/Передача-1141-Справочники-2026-09-10]], новаязадача ещёнеотправлена.

## 10.09.2026 — №1141: начало отдельной группы

Исполнитель: Кодекс Астра 6.

Передача прочитана; отдельный worktree 36b5, ветка codex/contour-dictionaries-1141, baseline 510c680a. Plane: Backlog → In Progress. Список Plane прочитан с пагинацией (1155 карточек); №342 уже Done, подтверждаем поведение заново без изменения его статуса. Стенды :8100 PID 22081 и :3108 PID 13530 работают. Гейт по прямому решению — реальные клики, без pytest/e2e/smoke и новых тестов; независимое статическое ревью. План №1137, блок 4: инвентарь и bootstrap → сайт/Django → потребители → исправления только P0/P1 → рунбук/review/публикация → новая задача №1142.


### 2026-09-10 17:45 — №1137: оценка ускорения текущей проверки

Исполнитель: Кодекс Астра 6. По вопросу заказчика прочитаны текущая очередь Plane, протокол QA и промпт закрытого контура. Plane: №1138–1140 Review, №1141 In Progress, №1142–1144 Backlog. Снимок процессов не показал выполняющихся pytest, playwright test или next build; это не доказывает отсутствия интерактивной браузерной работы. Протокол №1140 фиксирует 90 списков, 81 add-форму и 143 варианта фильтров. Действующий промпт требует браузерную проверку и запрещает pytest/новые тесты.

Возможности ускорения без изменения охвата: короткие серии известных браузерных действий за один вызов с фиксацией результатов; повтор исправленного сценария и затронутых зависимостей вместо необоснованного повторения всего пройденного блока; использование уже записанных результатов при неизменном коде и окружении. Это рекомендации, изменение процесса в другой задаче не выполнялось. Ускорение в разах не измерено. Код, процессы и статусы не менялись; коммита нет. Основания: [[WIKI/Промпт-тестовый-прод-закрытый-контур]], [[QA-Audits/Прогон-тестовый-прод-2026-09-10]].

## 10.09.2026 — №1141: подтверждён пробел bootstrap

Исполнитель: Кодекс Астра 6.

Django :8100 переключён с проверенного PID22081 на PID72219, cwd worktree36b5, изолированная contour_bootstrap_1140. Live-БД не менялась. В браузере Django поиск PLACEMENT_SECTIONS: 0 results /30 total. Доказательство QA-Audits/1141/bootstrap-sections-empty.txt. Причина: пропущен sync_placement_sections в bootstrap_contour. Исправление — добавить существующую команду с yes в транзакционный reference-блок; деактивация отсутствующих в шаблоне секций сохраняется штатной командой, удаления нет. Демо-нормативка из seed_legal_documents намеренно исключена.

10.09.2026. №1141. Исполнитель: Кодекс Астра 6. Bootstrap fixed exit0, 24 новых секции без удаления; Django показывает24/54 (QA-Audits/1141/bootstrap-sections-after.txt). Остальные counts: статусы17, должности12, звания10, страны14, города42, трассы3. Live personnel_records восстановлена, Django PID93670. RSS Next13530=254760КБ.

10.09.2026. №1141. Исполнитель: Кодекс Астра 6. Таблицы инвентаря перенесены в поставочный deploy/contour/RUNBOOK.md: живые таблицы, роли, начальные counts, редакторы, потребители и фиксированные значения. Фактическая браузерная карта QA-Audits/1141-Карта-кликов.md. Build final exit0 (39/39 страниц), frontend PID109501 / worktree36b5 .next-build; старый PID13530 остановлен после проверки cwd, старый артефакт сохранён.


### 2026-09-10 18:12 — №1137: ответ о сроке оставшейся проверки

Исполнитель: Кодекс Астра 6. Повторный срез Plane: №1138–1140 Review, №1141 In Progress, №1142–1144 Backlog. В доступном списке задач Codex нет активной задачи проверки: «Контур №1140 — админка и чистый bootstrap» idle; новая задача №1141 в списке не обнаружена. Следовательно, активное продолжение №1141 не подтверждено одним статусом Plane. Протокол QA по-прежнему заканчивается итогом №1140. Предварительная оценка оставшегося объёма №1141–1144 — ориентировочно 4–8 часов активной работы при отсутствии крупных новых дефектов; это экспертная оценка по составу работ, не измеренный ETA, при серьёзных дефектах срок увеличится. В объём входят справочники, полный путь ОМ, переделка четырёх экранов и итоговая приёмка. Процессы и задачи не запускались/не изменялись.

2026-09-10, №1141/1168/1169. Исполнитель: Кодекс Астра 6. Контролируемая остановка своего Django :8100 показала видимую ошибку данных без подставленного каталога; восстановление PID117746 и кнопка «Попробовать снова» вернули серверные статусы, включая CONTOUR1141. Изолированный сбой только справочника не проверен: родительский экран показывает общую ошибку. Доказательства server-unavailable и status-retry-after в QA-Audits/1141. После правок1169 начата новая подготовка артефакта в .next-1141-final; работающий .next-build не перезаписывается. Лог ~/.local/state/smart-josparlau/1141/build-1169.log.


### 2026-09-10 18:15 — №1137: остановка по команде заказчика

Исполнитель: Кодекс Астра 6. Заказчик: «давай просто останови»; причина — экономия токенов. Разрешение на дальнейшее исполнение проверки и очереди №1141–1144 приостановлено до новой прямой команды. Задачам «Контур №1140 — админка и чистый bootstrap» и «Мониторинг логов фронта и бэка» отправлено указание остановить проверки и не продолжать разработку. Автоматическое продолжение интеграции smart-josparlau поставлено на паузу. Уже выполненные результаты сохраняются; №1138–1140 в Review, полная приёмка не выполнена. Стенд и данные не выключались и не удалялись.

2026-09-10, №1141/1166–1169. Исполнитель: Кодекс Астра 6. По прямому распоряжению заказчика «давай просто останови» работа и цепочка1142–1144 остановлены. Код сохранён незакоммиченным; итоговый гейт/Review не объявлены. Точка восстановления: [[WIKI/Останов-1141-2026-09-10]].

## 2026-09-10 — повторная сверка всех веток и актуальности main, Plane №1136

Исполнитель: Кодекс Астра 6.

Прямой запрос заказчика: «обьедени все ветки и влей в мэйн ветку, мэйн должна быть самой актуальной». Выполнены git fetch --all --prune и полная проверка refs/heads + refs/remotes через git merge-base --is-ancestor. Обнаружено 160 ссылок (включая origin/HEAD), невлитых веток — 0. main и origin/main указывают на 510c680a54d487260cb291ac4a8f82c99cdda720. Уже выполненная интеграция №1136 и последующие изменения контура содержат все существующие ветки; повторный merge не нужен.

Основной каталог остался на старой codex/om-walkthrough-1081-fixes с четырьмя незакоммиченными файлами frontend и untracked test-results/.last-run.json. Эти локальные изменения отличаются от более нового main, поэтому перед переключением будут отдельно сохранены в именованном stash; перенос старых версий поверх main не выполняется. Код приложения не редактируется, новые коммиты не требуются; проверка этой операции — достижимость всех веток и совпадение локального/удалённого main. Другие задачи разработки этим запросом не запускаются.

### 2026-09-10 — №1136: повторная сверка завершена, рабочая папка на main

Исполнитель: Кодекс Астра 6.

Сохранён именованный stash `Plane-1136-before-main-2026-09-10`, SHA `1c96c0ef11dfe0e399f0568abb97613f1c224ac5`, исходная ветка `codex/om-walkthrough-1081-fixes`. В нём четыре tracked-файла frontend (44 insertions, 183 deletions) и untracked `Backend/PersonnelStatus/Personnel-Records/test-results/.last-run.json`; наличие последнего подтверждено `git ls-tree stash@{0}^3`. Stash автоматически на main не применяется.

Выполнен `git switch main`. `git push origin main` → `Everything up-to-date`; `git status --short --branch` → `## main...origin/main`, рабочее дерево чистое. `git ls-remote origin refs/heads/main` и HEAD совпадают: `510c680a54d487260cb291ac4a8f82c99cdda720`. Проверены 159 ссылок веток (origin/HEAD исключён): `BRANCH_REFS_CHECKED 159 NOT_MERGED 0`, `MISSING []`. Все коммиты всех существующих локальных и remote-tracking веток достижимы из main. Новых merge/code-коммитов нет — повторно вливать нечего. Код main не изменён; pytest/build/smoke в этой проверке Git повторно не запускались. Стенды не перезапускались; RSS next-server: PID 128157 — 142224 КБ, PID 3631 — 117816 КБ.

Plane сверён по API с полной пагинацией, существующая карточка №1136 остаётся Review; другие карточки не переводились, очередь разработки не запускалась.

## 2026-09-10 — №1172: перенос в закрытую сеть 10.15.3.187
Исполнитель: Кодекс Астра 6.
Прямое поручение заказчика: подготовить Docker-комплект, фронт3300, backend8300, PostgreSQL5300. Изучены deploy/contour, актуальные настройки и связанные карточки1137–1144. Существующий блок1 публикует только3118 и отключает Celery; новая схема требует отдельной адаптации. Карточка создана и взята In Progress. Уточняются ОС/архитектура/Docker целевого сервера и перенос данных. До ответа подготовка переносимого runtime и схемы допустима; экспорт персональных данных пока не выполняется. Диск:15ГБ свободно, полная повторная выгрузка зависимостей нецелесообразна; предпочтителен runtime-комплект с уже собранными образами. Код пока не менялся.

2026-09-10, №1172. Исполнитель: Кодекс Астра 6. Реализован отдельный профиль deploy/lan в изолированном worktree. Независимый reviewer выявил порядок restore и риск потери очереди; оба включены в план и установщик. Новая схема PostgreSQL16, nginx3300/8300, DB5300; внутренние Redis/AOF, worker/beat. Созданы генератор закрытого env, runtime сборка, install и backup/restore с отказом от непустой базы. bash -n и Python ast.parse проходят; фактическая сборка/запуск ещё впереди. Существующий deploy/contour и приложения не изменены.

2026-09-10, №1172. Исполнитель: Кодекс Астра 6. Первый commit41216d0f:9файлов deploy/lan, bash/AST/Compose config/git diff проверки exit0. Lockfile подготовленных frontend deps побайтно совпал с текущим551a37c2. Запущена production сборка --network=none, журнал /tmp/sj-lan1172-build.log, результат /home/erda/Backups/smart-josparlau/lan-1172-20260910. [[WIKI/План-1172-Перенос-Docker-в-закрытую-сеть]] содержит архитектуру, задачи и уточнения независимого ревью; готовность runtime ещё не подтверждена.

2026-09-10, №1172. Исполнитель: Кодекс Астра 6. Заказчик уточнил: сохранить все справочники/пользователей, подразделения/сотрудников/ОМ/бюллетени/расходы и прочие рабочие записи очистить; ОС Ubuntu22.10 kinetic, Docker уже установлен, x86_64. Подтверждена совместимая архитектура runtime linux/amd64. Исходная personnel_records в vaps-db-5434 снята pg_dump без изменения источника, восстановлена в новый volume sj-lan1172-test_postgres, БД lan1172_sanitized. Очистка применяется только к копии. Первая транзакция откатилась из-за append-only audit trigger; добавлено временное отключение пользовательских триггеров только очищаемых таблиц с восстановлением состояния в той же транзакции, FK продолжают проверяться. Итог:58/58users сохранены побайтно вместе с паролями;84рабочие таблицы пусты, divisions55→0, employees442→0, events26→0, bulletins34→0, daily submissions55→0.67OpsDictionaryEntry,14OpsVehicle,3OpsRatingGroup и остальные справочники сохранены.19грантов удалённых подразделений сняты (не превращены в глобальные),4owner_division отвязаны. Стартовый dump записан до запуска приложения, media/private пустые. Новые бизнес-данные/медиа не импортируются. Отчёт проверки /tmp/sj-lan1172-sanitization.json. Production Next build50секунд exit0, runtime archive978МБ.

2026-09-10, №1172. Исполнитель: Кодекс Астра 6. Независимый reviewer подтвердил allowlist всех справочников по admin_categories и отсутствие расширения прав после снятия scoped grants. Commit3f4e3ab0 добавляет sanitize-copy и проверку Compose>=2.20. Подняты7сервисов в sj-lan1172-test, рабочие стенды не затронуты. HTTP13300/18300: admin/login и static200, API token и permissions200 для сохранённого acc_admin; NextAuth→backend→PostgreSQL вход успешен. У acc_admin нет Django is_staff, отказ админки ожидаем; admin со старым паролем успешно вошёл в Django с CSRF и redirect302. PostgreSQL16.14 отвечает на15300.4задачи расписания включены, Celery ping pong, реальная statuses.apply_planned_statuses выполнилась success/applied_count0 на пустом кадровом наборе. Backend не может соединиться с1.1.1.1:443 из internal-сети. Браузерная форма входа видна,11CSS/JSссылок относительные, consoleerror/warn0. Первый backup завершён с drain и автоматическим возобновлением сервисов. Вторая проверка backup/restore добавляет только в тестовые volumes по одному public/private файлу; исходный seed-data зафиксирован раньше и их не содержит. Финальная сборка из3f4e3ab0 выполняется отдельно.

2026-09-10, №1172. Исполнитель: Кодекс Астра 6. Roundtrip restore подтверждён:58пользователей, пустые рабочие реестры, public/private контрольные файлы восстановлены побайтно; повторный restore поверх работающего приложения отклонён до изменения БД. Найдена обязательная offline-зависимость API docs: HTML/docs200 тянул4ресурса cdn.jsdelivr.net. По официальной документации drf-spectacular добавлен sidecar2026.9.1 (SHA1e521d0ff78c7ab1a873423fc6e6b82ef6bae863f170762e7410ac63b2c7b72f), только в LAN-image/settings; подготовка assets — отдельная online-команда, Docker install/run остаются без скачиваний. Commit0daf47b0; начата финальная сборка с локальными Swagger/Redoc. Оригинальные backend/frontend/contour файлы не менялись. Логи сохранены QA-Audits/lan-1172-2026-09-10.


## 2026-09-10 — №1172: готовый комплект, проверки и публикация

Исполнитель: Кодекс Астра 6.

Финальный commit835dde7a590c25cb43d91bbc4bd2ae7b2b0d6222 опубликован в origin/codex/offline-lan-1172; совпадение подтверждено git ls-remote. Коммиты0daf47b0/b9734704/835dde7a закрыли CDN API UI, внешний Swagger validator и Google Fonts ReDoc. Независимое ревью Approved. Production build и локальная установка/restore/обновление прошли. После удаления внешних маршрутов только собственных контейнеров HTTP/API-вход и браузерная форма работают. Backup/restore файлов проверен побайтно; повторный restore отклонён. Подробные результаты и логи: [[QA-Audits/lan-1172-2026-09-10/Приёмка-1172]].

Архив /home/erda/Backups/smart-josparlau/smart-josparlau-offline-2026-09-10.tar,1065666560байт; SHA2562ecdc2dae628a7e24b0501480db348700698644cd1db4d5ae6e91dbaa6cda2d3. Все контрольные суммы прошли. Инструкция [[OUTPUT/Перенос-в-закрытую-сеть-10.15.3.187-2026-09-10]], её экспорт INSTALL-RU.md совпал.58 пользователей и справочники сохранены,84 рабочие таблицы пусты; исходная база повторно проверена read-only, исходные количества58/55/442/34/55/26 сохранены. Все собственные тестовые стеки остановлены без удаления томов; main чистый. RSS существующих next-server122988/98828КБ. Комплект готов к переносу; проверка на целевом Ubuntu22.10 и Compose>=2.20 остаётся оператору. Полная бизнес-приёмка не объявлена.


## 2026-09-10 — №1172 передана в Review

Исполнитель: Кодекс Астра 6. Подготовка LAN-комплекта завершена; commit835dde7a590c25cb43d91bbc4bd2ae7b2b0d6222 опубликован в origin/codex/offline-lan-1172. Независимое ревью Approved, проверки сборки/установки/входа/backup/restore/offline UI успешны, доказательства [[QA-Audits/lan-1172-2026-09-10/Приёмка-1172]]. Карточка Plane1172 проверена GET:Review; On test/Done не менялись. [[OUTPUT/Перенос-в-закрытую-сеть-10.15.3.187-2026-09-10|Инструкция и состав комплекта]]. Проверка на целевом10.15.3.187 остаётся после переноса. Старая очередь разработки не возобновлялась.


2026-09-10. Plane №1172. Исполнитель: Кодекс Астра 6. Заказчик сообщил Compose2.17.2. Карточка возвращена In Progress для проверки/адаптации: прежний порог>=2.20 был консервативным, совместимость2.17.2 ещё не доказана. План: официальный бинарник с SHA, воспроизведение version-gate и проверка поддерживаемых CLI-флагов/config, минимальная правка при необходимости, реальный install/restore на изолированной копии, обновление архива/инструкции/контрольных сумм, push и Review. Исходная база и установленный Docker/Compose не меняются.

2026-09-10, №1172. Исполнитель: Кодекс Астра 6. В официальном source Docker Compose v2.17.2 подтверждены StringArray env-file, up --pull never, --no-build, --wait и --wait-timeout. Проверяется гипотеза: ограничение2.20 в install.sh избыточно. Загружается отдельный официальный бинарник с проверкой SHA, системный Compose не заменяется.

2026-09-10, №1172. Исполнитель: Кодекс Астра 6. Официальный Compose2.17.2 SHA895e20812231543eae9f6b98ef9395327f4f21f1f31fa51fc252d21415802dda воспроизвёл отказ прежнего install.sh; config семи сервисов успешен. Минимальная правка c637e826: version gate>=2.17.2, строгий разбор версии. Проверены2.17.2/v2.17.2/suffix/2.20.0/5.3.1 — принимаются;2.17.1/1.29.2/unknown — отклоняются; bash -n и diff --check успешны. Запущены install --restore на отдельном sj-lan1172-compose2172 и сборка нового комплекта; исходные приложения не менялись.

2026-09-10, №1172. Исполнитель: Кодекс Астра 6. Install --restore под официальным Compose2.17.2 завершён exit0:7 сервисов,58 пользователей, сотрудники/подразделения0. Runtime c637e826 собран без сети, коммит опубликован и ls-remote совпал. Новый архив smart-josparlau-offline-2026-09-10-compose2172.tar,1065922560байт, SHA92009e7a9099d7d4194e4c3009d42b4e0dc2e8f6b2c42ba719c029410a57bb82; root/source/outer checksums PASS. Старый архив сохранён как предыдущая версия. Финальная установка/обновление из нового комплекта и backup на2.17.2 проверяются; глобальный Compose5.3.1 не заменялся.


## 2026-09-10 — №1172: Compose 2.17.2 поддержан

Исполнитель: Кодекс Астра 6. По уточнению заказчика снят избыточный порог2.20. Официальным бинарником2.17.2 проверены install --restore, установка обновлённого комплекта,7 сервисов и healthcheck,HTTP3300/8300,backup с возобновлением сервисов. Сохранены58 пользователей, сотрудники/подразделения0. Матрица версий и само-ревью минимального diff успешны. Commitc637e8264c2acaad11a8d3f0320688e4b88f4ded опубликован, origin совпал. Новая поставка /home/erda/Backups/smart-josparlau/smart-josparlau-offline-2026-09-10-compose2172.tar,1065922560байт; SHA25692009e7a9099d7d4194e4c3009d42b4e0dc2e8f6b2c42ba719c029410a57bb82. Все контрольные суммы прошли. Старый архив с порогом2.20 остаётся предыдущей версией; использовать новый. [[OUTPUT/Перенос-в-закрытую-сеть-10.15.3.187-2026-09-10|Инструкция обновлена]], [[QA-Audits/lan-1172-2026-09-10/compose2172/Проверка-Compose-2.17.2|доказательства]]. На целевом сервере развёртывание ещё не выполнялось.

2026-09-10. Plane №1172. Исполнитель: Кодекс Астра 6. Собственный sj-lan1172-compose2172 остановлен через проверяемый Compose2.17.2, запущенных контейнеров проекта0, тома сохранены. Журнал stop.log в QA.

2026-09-10, Plane №1172. Исполнитель: Кодекс Астра 6. По вопросу заказчика «где все логины и пароли?» найдены таблицы учебных учётных записей в OUTPUT/Инструкции-по-учёткам-проходки-ОМ-2026-09-10.md:23 и OUTPUT/Инструкция-для-пользователей-Ежедневный-расход-и-На-дежурстве-2026-09-10.md:21. Они доступны отдельными документами vault, в архив runtime не включались; инструкция переноса ссылается на прежние пароли. Пользователи и пароли не менялись. Заказчику переданы прямые ссылки на разделы; это таблицы для учебных сценариев, не заявленная выгрузка паролей всех58 учётных записей.

- 2026-09-11 — Plane №1179. Исполнитель: Кодекс Астра 6. Проверен старый готовый frontend `smart-josparlau/lan-frontend:1172-c637e8264c2a` (image e8ac1c622a6e, BUILD_ID nkOz3DiHpKqvfi-cMLXs8) без пересборки: изолированный контейнер в internal-сети, все API синтетические. Service profile, employees table/profile/tiles принимают null даты/пол, даты показываются прочерками, известная дата отображается корректно; pageerror=0, runtime exit0. Блокеров совместимости nullable полей на этих экранах нет. Старый frontend git status чист, БД не подключалась, importer/installer не затронуты, общий pytest не запускался; собственные контейнер/сеть удалены. Доказательства: [[QA-Audits/1179-old-frontend-null/Проверка]], runtime.log и 4 синтетических скриншота.

- 2026-09-11 — Plane №1179. Исполнитель: Кодекс Астра 6. Настоящий isolated stack staffing-portable-1179-test (13379/18379): создана отдельная QA superuser/QA1179_NULL_UI только в тестовой БД, реквизиты mode0600 в /tmp/staffing-portable-1179. Настоящие NextAuth и API/core/service detail 2 синтетических сотрудников прошли; старый UI list/profile/table/tiles принимает null даты/пол, pageerror=0. Общий live-script exit1: не скрытый HTTP500 strength-report, причина — отсутствует IN_SERVICE в справочнике ОМ (strength_report.py:127). Nullable совместимость подтверждена; чистый общий UI требует начального справочника, передано родителю. Доказательства [[QA-Audits/1179-old-frontend-null/Живой-overlay]], live-overlay.log; frontend/importer/installer не менялись, общий pytest не запускался. Окно стабильности освобождено.

- 2026-09-11 — Plane №1179. Исполнитель: Кодекс Астра 6. По прямому поручению только в staffing-portable-1179-test добавлен минимальный IN_SERVICE (В строю, priority999, report_column_code IN_SERVICE, legacy_code in_service), full_clean и transaction.atomic; ровно +1 StatusType, полные snapshots сотрудников и прочих типов неизменны. Тот же live-overlay.cjs, assertions не менялись: exit0, Browser pageerrors=[], HTTP failures=[], real login/API/старый UI table/profile/tiles PASS. Прежний RED сохранён live-overlay-red.log и текстом в [[QA-Audits/1179-old-frontend-null/Живой-overlay]], актуальный GREEN live-overlay.log. Глобальных сидов/rebuild/production-правок нет. Стенд освобождён.

- 2026-09-13 — Plane №1264. Исполнитель: Claude Fable 5.1. **Новый комплект обновления закрытой сети 10.15.3.187 из текущего кода.** Поручение заказчика 12.09.2026 (ночь): «давай обновим развернутый проект в закрытой сети». Исходная линия `claude/om-walkthrough-1142-decisions` (содержит `lan-update-1236`, `daily-expense-flow-2026-09-12`, `lan-accounts-overview-menu-2026-09-12`, `offline-lan-1172`); после прошлого комплекта (`672dab95`) — 7 коммитов (№1259, №1258, №1260, №1250, №1247, №1263, откат №1262), новых миграций нет. Правки: `deploy/lan/INSTALL-RU.md` — редакция 13.09 (`60234c26`: комплект `smart-josparlau-offline-2026-09-13`, обновление с любого из двух прошлых комплектов, «что нового», абзац про исправленные дампы №1245/№1257 — накатывать до обновления; `0f64bac2`: раздел «что проверено» с репетицией). Пуш: ветка в ноль с origin. Сборка `build.sh` (все `docker build --network=none`, онлайн-подготовка не требовалась): кандидат `60234c26` 1 мин 31 с, финал `0f64bac2` 20 с (кеш). `seed-data` и `README.txt` добавлены руками как в №1236 (в `sha256sums.txt` они не входят, у `seed-data` свой список — 6/6 целы). Репетиция (стек `sj-lan1264-rehearsal`, 127.0.0.1:13300/18300/15300): комплект 12.09 + `--restore seed-data` 39 с; маркерный пользователь `rehearsal_1264` (58→59); `data.sh backup` 33 с, суммы копии сходятся; кандидат поверх тем же `.env` 34 с — семь `healthy` на `1172-60234c265daf`, `showmigrations` по-прежнему `[X] 0126`, пользователи 59/59, маркер на месте; браузер Playwright/Chromium: вход `admin` 200, `/dashboard`, «Реестр ОМ», `/employees?view=daily`, «Свод по Службе», Django admin login — 200, рукоятка `separator` «Ширина бокового меню» есть, чужих origin 0 (кроме собственного :18300), `requestfailed` 0; финальный архив поверх того же стека — 33 с, `healthy` на `1172-0f64bac2109e`, маркер на месте, 200. Уборка: `down -v`, тома `sj-lan1264-*` 0, каталоги `rehearsal-1264-{old,new,backup}` удалены, образы кандидата `60234c265daf` сняты. Результат: `/home/erda/Backups/smart-josparlau/smart-josparlau-offline-2026-09-13{,.tar,.tar.sha256}`, tar 1 065 953 280 байт, sha256 `a27424b19e97669bb9522d34a4a725f2c2ee8349c097c5a3f876f9f4ed09839c`, `source-revision.txt` = `0f64bac2109ec432cee5c5ea53e755de64751d99`. Диск: 12 ГБ свободно до сборки, 5,9 ГБ в пике, 7,0 ГБ после уборки (98 %) — на машине восемь поколений образов `lan-*` по ~4 ГБ (сняты только образы кандидата); флешка не смонтирована (`/media/erda` пуст) — архив ждёт на диске. Записка заказчику: `OUTPUT/Обновление-закрытой-сети-10.15.3.187-2026-09-13.md`. Не проверено: обновление на настоящих данных сервера; прямой путь с 10.09 в этот раз не повторялся (отрепетирован 12.09). RSS `next-server` :3106 после закрытия — 442 404 КБ (стенд перезапущен сторожем, ниже порога 2 500 000). №1264 → `Review`, комментарий «было/стало» в карточке.
- 2026-09-12 — Plane №1236 (шаги №1237–№1243). Исполнитель: Claude Fable 5.1. **Комплект обновления закрытой сети 10.15.3.187 с сохранением данных.** Ветка `claude/lan-update-1236` от `02f48c67`: merge `origin/codex/offline-lan-1172` (`c36b02d1`, только `deploy/lan/`, 13 файлов), `f71476d7` — `INSTALL-RU.md` в git + раздел «Обновление уже установленной системы» + `build.sh` кладёт её в комплект, `672dab95` — итоги репетиции в разделе «Что проверено». Пуш: `origin/claude/lan-update-1236` в ноль с HEAD `672dab959de22fac4924b6b72431cdd57b1eb641`. Диск: до `docker builder prune -af` свободно 1,4 ГБ (100 %), кеш сборки 22,14 ГБ; после — 18 ГБ; по завершении с архивом — 13 ГБ. Сборка `build.sh` (все `docker build --network=none`, онлайн-подготовка не требовалась — зависимости с 10.09 не менялись): кандидат 1 мин 52 с, финал 1 мин 55 с. Результат: `/home/erda/Backups/smart-josparlau/smart-josparlau-offline-2026-09-12{,.tar,.tar.sha256}`, tar 1 065 912 320 байт, sha256 `948e82467084aeb1c7d5ce6e1ff2eb757285735dcf415c2d7dce2307858b90fe`, образы `smart-josparlau/lan-*:1172-672dab959de2`, `seed-data` из комплекта 10.09 без изменений, `sha256sums.txt` 20/20 OK, `source-sha256sums.txt` и `seed-data/sha256sums.txt` без расхождений. Репетиция (стек `sj-lan1236-rehearsal`, 127.0.0.1:13300/18300/15300): комплект 10.09 + `--restore seed-data` 42 с; заведены 3 сотрудника, 5 кадровых статусов; `data.sh backup` 33 с; кандидат поверх тем же `.env` 34 с — `showmigrations` до `[X] 0126`, лог backend `Проекция кадровых статусов в раздел: created=2`, счётчики до/после `auth_user` 58/58, `employees` 3/3, `employee_statuses` 5/5, `ops_employee_statuses` 0/2 (обе строки `PERSONNEL`); браузер Playwright/Chromium: вход `admin` (пароль репетиционный, seed-пароли ни одному файлу `~/.config/vaps/*password*` не соответствуют), `/dashboard`, `/employees?view=daily`, `?view=department-summary`, `/security-ops/service-summary`, Django admin — 200, чужих origin 0, `requestfailed` 0; откат: `ctl.sh down` → старый комплект `STACK_NAME=sj-lan1236-rollback` `install.sh --restore` 39 с — 58/3/5/0, схема `0122`; обновлённый стек поднят обратно; финальный архив поставлен поверх ещё раз — 33 с, 58/3/5/2, вход 200. Находка: разовый `403` на рукопожатии `/ws/notifications/` в первом проходе после старта, 3 повтора — 0, на старой версии — 0 → №1244 «Предложено Claude». Уборка: оба репетиционных стека `down -v`, тома `sj-lan1236-*` удалены, образы кандидата `1172-f71476d7899b` сняты, каталоги `lan-1236-candidate` и `rehearsal-1236` удалены; доказательства (5 снимков, 3 счётчика, 3 лога установки, лог сборки) — `QA-Audits/1236-lan-update/`. RSS `next-server` :3106 — 1 703 532 КБ (ниже порога 2 500 000). Записка заказчику: `OUTPUT/Обновление-закрытой-сети-10.15.3.187-2026-09-12.md`. Не проверено: обновление на настоящих данных сервера (копии нет) — первый шаг инструкции; Celery-задачи по расписанию после обновления. pytest/e2e не гонялись: код приложения не менялся, правки только в `deploy/lan/` (документ и список файлов сборки).

- 2026-09-13 — прямое поручение заказчика: зеркало кода + vault на внутренний GitLab. Исполнитель: Claude Sonnet 5. Заказчик попросил запушить `http://10.115.70.74/erda05508/smart-josparlau` — «последнюю версию кода этого проекта с папкой smart_josparlau_vault в obsidian_brain». Уточнено вопросами: (1) «последняя версия» = текущая ветка `claude/om-walkthrough-1142-decisions` как есть (main трогать не нужно); (2) vault — внутрь `docs/` того же репозитория. Обнаружено: `main` на этом GitLab (`77a1a967`) и локальный/GitHub `main` (`510c680a`) — независимые истории от общего предка `eecf0323` (прежний прецедент №1052/записи выше уже избегал force-push сюда), поэтому запись сделана НОВОЙ веткой без затрагивания их `main`. Перед пушем — сканирование vault на секреты (паттерны приватных ключей/API-токенов/паролей): ничего настоящего не найдено, только синтетические/тестовые значения (`password='password'`, `NEXTAUTH_SECRET=local-gate-secret`, `DB_PASSWORD=your-db-password` и т.п.). Реализация: отдельный `git worktree` от текущего HEAD (рабочее дерево сессии не трогалось), снимок vault (без `.obsidian`, 1225 файлов) скопирован в `docs/smart-josparlau-vault/`, для этого в `.gitignore` ЭТОЙ ветки добавлено точечное исключение `!docs/smart-josparlau-vault/` с пометкой «только для зеркала, в GitHub не идёт» — рабочее правило «vault вне репозитория» (решение 28.08.2026) не отменяется, это разовый статичный снимок для стороннего зеркала. Коммит запушен как `claude/om-walkthrough-1142-decisions` (SHA `f8907b7f`) на GitLab; `ls-remote` подтвердил: их `main` не сдвинулся (`77a1a967`), новая ветка на месте. Worktree и временная локальная ветка удалены. Задачи Plane нет — разовое инфраструктурное поручение вне очереди, в код приложения и в GitHub-историю изменений не вносилось.


## 2026-09-15 — №1267, запуск ручной проверки MVP
Исполнитель: Кодекс Астра 6. Прямое поручение заказчика принято; план [[WIKI/План-MVP-браузер-2026-09-15]]. Проверки: git status чист, ветка main; Plane прочитан со всеми страницами (917 открытых); CUA видит Chrome и встроенный браузер. Исходный sandbox-доступ к localhost ограничен; escalated чтение успешно. По одной новой сессии на карточку; Luna по умолчанию, повышение по сложности. Начинаем со входа и карты функций. Код ещё не менялся.

2026-09-15. №1267. Исполнитель: Кодекс Астра 6. Импорт плана остановился на 429 после двух карточек; восстановлен идемпотентно, без дублей, одним чтением полного списка. Этапы: 1268, 1269, 1270, 1271, 1272, 1273, 1274. Первая новая сессия отправлена на создание (Luna medium), код не менялся.

2026-09-15. №1267/1268. Исполнитель: Кодекс Астра 6. Сессия «MVP: вход, роли и карта функций» запущена: 01a0a665-60e5-7cf0-a3c2-b9301c4447f0, Luna medium, worktree ebf8. CUA и curl исполнителя: localhost:3106/3108 не слушают. Замеренный процесс next-server RSS 125268 КБ оказался другим проектом; это НЕ замер стенда Smart Josparlau. Инвентаризация обнаружила 47 маршрутов; UI пока BLOCKED. Исполнителю поручено восстановить штатный локальный стенд в рамках подготовки №1268, затем продолжить клики. Новые баги и исправления пока не подтверждены.

2026-09-15. №1267/1268. Исполнитель: Кодекс Астра 6. Первичное заключение исполнителя об отсутствии runtime опровергнуто: основной checkout содержит .venv/bin/python, node_modules/.bin/next, .env.local и обе готовые сборки .next-build/.next-prod. Отсутствие зависимостей только в новом worktree не является внешним блокером. Передан правильный источник запуска; исполнитель начал штатный backend :8100 и prod :3108. Для продолжения восстановления модель повышена до Terra medium в той же карточке. Пока UI не подтверждён.

2026-09-15. №1267/1268. Исполнитель: Кодекс Астра 6. Штатный локальный стенд восстановлен: backend :8100 PID259641, prod :3108 PID260737. Существующая production-сборка датирована 12.09.2026 14:19:12 +0500; её SHA неизвестен, текущий checkout 510c680a не доказывает версию сборки. Матрица QA-Audits/MVP-2026-09-15/01-entry.md содержит 4 PASS по CUA: форма, ошибочный вход, экран/меню предсуществующей сессии Штаба, выход. Авторизованный вход остальными ролями BLOCKED: CUA не имеет документированного канала чтения защищённого файла и ограничивает использование других UI-инструментов без указания пользователя. Задан вопрос о разрешении Playwright только для защищённого служебного входа с последующим ручным тестированием; ответ пока отсутствует, разрешение не подразумевается. Все независимые действия первого блока завершены, зависимые блоки и исправления не заявлены выполненными. №1268 остаётся In Progress. Стенд оставлен работающим. После ответа продолжить существующую сессию 01a0a665-60e5-7cf0-a3c2-b9301c4447f0 (Terra medium), затем каждую карточку №1269–1274 и подтверждённый дефект — в отдельной новой сессии.

2026-09-16. №1267/1268. Исполнитель: Кодекс Астра 6. Пользователь ответил на вопрос об использовании Playwright: «я тебе даю разрешения на все действия в рамках этого проекта». Блокер альтернативного инструмента для входа учебными ролями снят. В существующую сессию 01a0a665-60e5-7cf0-a3c2-b9301c4447f0 передано продолжение №1268 (Terra medium): защищённое чтение секрета без вывода, интерактивная браузерная проверка входа/выхода и ролей, журнал доказательств. Каждая следующая карточка и исправление — новая сессия. Обычные шаги в разрешённом scope повторного согласования не требуют. Результат пока ожидается; новых исправлений не заявлено.

2026-09-16. №1267–1269. Исполнитель: Кодекс Астра 6. Исполнитель №1268 передал результат и поставил Review, URL :3108, SHA510c680a, BUILD_ID1PtXXHzbZa5p35NCaQA8K510c680a, frontend PID276287/RSS147500КБ. Проверены 4 роли; новых дефектов нет. Самопроверка оркестратора обнаружила расхождение счётчика (таблица 13 UI PASS, итог17) — возвращено на точечное уточнение документации в той же сессии, без браузера. Tracked код не менялся, untracked .next-mvp-20260916 — нужная работающая сборка. Следующий №1269 передан на создание новой сессии «MVP: сотрудники и справочники», Terra medium; идентификатор пока client-new-thread:e4b43826-3433-454a-af71-45b2ccdf5824. Единственный активный браузерный исполнитель — №1269. Полные гейты нового запуска остаются обязательными до итоговой приёмки №1274; не заявлены пройденными.

2026-09-16. №1267/1268/1269. Исполнитель: Кодекс Астра 6. Итог №1268 сверён: 13 UI PASS и 2 инфраструктурных PASS; прямым API опубликован уточнённый комментарий Plane (комментариев до записи не было). №1269 работает в новой сессии 01a0a67a-0d83-7742-88da-2965bc4054d5; передан безопасный инструмент mcp__playwright__browser_run_code_unsafe для входа, предыдущий исполнитель готовит короткий handoff без секретов. Повторного разрешения пользователя не требуется.

2026-09-16. №1269, подготовка ролевого входа. Исполнитель: Кодекс Астра 6. Исполнитель сообщил три ограничения инструментов: VM Playwright MCP не имеет require/dynamic import; попытка Function-конструктора отклонена как sandbox escape и прекращена; штатный CLI fill с секретом отклонён из-за попадания секрета в argv. Прежняя процедура не должна использоваться. Передано безопасное решение, устраняющее причину отказа: стандартный локальный Node+Playwright вне VM, чтение существующего секретного файла в память и прямой page.fill без argv/env/stdin/логов секрета. Временный helper создаётся в /tmp, запуск проходит обычный auto-review; результат ещё не подтверждён. Повторного разрешения на обход ограничений не запрашивали и обход не выполняется.

2026-09-16. №1269. Исполнитель: Кодекс Астра 6. Безопасный Node helper успешно вошёл admin, блокер авторизации снят без передачи пароля в argv. Начаты реальные UI-проверки: реестр сотрудников (440), пустой поиск, дерево организации. Предварительный итог не принят как завершение блока; в той же сессии запущено продолжение на Astra medium до исчерпания всего scope №1269. Исправлений пока нет, остальные результаты в матрице02-personnel.md.

2026-09-16. №1267/1269/1276. Исполнитель: Кодекс Астра 6. Для сокращения ожидания запущена отдельная новая сессия исправления №1276 «MVP: запрет редактирования паспорта наблюдателем», Terra medium (client-new-thread:f5aff3cc-7060-48e5-a639-cc0a57e79813). Пока №1269 завершает безопасные пропуски матрицы, №1276 разрешены только исследование/код в изолированном worktree; тяжёлые гейты, общий стенд и браузер ждут освобождения от оркестратора. Это уточнение прежнего последовательного плана: одновременно один браузерный исполнитель, возможно одно независимое исправление в отдельной копии. Ни общей сборки, ни параллельного pytest. После проверки каждый исправленный branch передаётся следующей сессии, чтобы QA-стенд содержал накопленные исправления; main не коммитится.

2026-09-17. №1278, родитель прежней кампании №1267. Исполнитель: Кодекс Астра 6. Новое прямое указание: «просто почини справочники, на вебке, в админке джанго». Общая проходка №1269 и исправление паспорта №1276 приостановлены сообщениями исполнителям. Новая узкая работа — исправление справочников в вебке и Django admin, включая доступность ОЛ и №1275; отдельная новая сессия, одна задача до проверяемого исправления. Дубликаты сообщений про ОЛ в старых задачах Codex прочитаны: код не исправлялся, работа Claude была остановлена отсутствием подписочного доступа. Главный checkout SHA510c680a, tracked правок нет; .next-mvp-20260916 остаётся build-артефактом.

2026-09-17. №1278. Исполнитель: Кодекс Астра 6. Запущена отдельная сессия «Починить справочники в вебке и Django admin» 01a0af0e-50b2-7e20-a401-8c41e5376f5f, Astra medium. Scope ограничен справочниками с обеих сторон (ОЛ, общие, кадровые, связанная валидация №1275), до проверенного исправления/публикации/Review. Полная MVP-очередь и паспорт №1276 приостановлены по новой команде пользователя. Следующая работа вне справочников самостоятельно не начинается. Исполнителю передан существующий способ безопасного browser login, runtime основного checkout и запрет повторять уже завершённый аудит.

2026-09-17. №1278. Исполнитель: Кодекс Астра 6. Оркестратор просмотрел текущий diff и обнаружил риск: eventsOf каталога ОЛ связывал мероприятия по имени, которое теперь редактируется. Передано исполнителю; по его проверке добавленная регрессия красная на исходном сравнении, исправление использует personId и fallback имени только для legacy без id. На момент сообщения: 2 frontend и3backend целевые регрессии зелёные; полный ops+operations+dictionaries pytest идёт под замком, frontend gate ранее прошёл и будет повторён после последних правок. Выполненность задачи не заявлена, ждём окончательные гейты и двустороннюю ручную проверку.


## 2026-09-18 — №1267: общая очередь MVP возобновлена
Исполнитель: Кодекс Астра 6.

Прямой ответ заказчика на уточнение: «Продолжить общую очередь MVP». Пауза общей кампании снята; повторное разрешение на обычные шаги и уже разрешённые карточки не требуется. Продолжение передаётся существующему оркестратору 01a0a661-5be5-79a2-8477-199967b55fbe («Проверить MVP через браузер»), чтобы каждая рабочая группа оставалась в отдельной сессии, как требует №1107.

Срез Plane: №1268 Review; №1269 In Progress; №1276, №434 и №1270–1274 Backlog. №1275 уже исправлена коммитом №1278, не выполнять повторно. Следует восстановить исполнителей №1269 и №1276 с их сохранённым состоянием; затем продолжать утверждённую последовательность до итоговой №1274. №1278 In Progress из-за общего гейта, не менять на Review без прохождения обязательных проверок.

Передача результата: ветка codex/1278-dictionaries, SHA67b5ad4974cc6731e5810c0e7055cb757a114d9a; рабочее дерево чистое. Отчёт QA-Audits/MVP-2026-09-15/fix-1278-dictionaries.md, логи в 1278-evidence/. Frontend gate PASS, 132 целевых backend и 10 browser PASS. Остаточные baseline-блокеры: №1204 (18 проб), №1206 (10 проб), №1207 (код ошибки), №1205/1216 (одна миграционная проба, дубли). Эти карточки пока Предложено Claude; оркестратору сопоставить их с разрешённым scope кампании, не включать всю колонку предложений автоматически. Новых кодовых изменений и запусков гейта в текущем заходе нет; стенд и прежние PID требуется проверить заново перед использованием.

2026-09-18. №1267/1269/1276. Исполнитель: Кодекс Астра 6. Оркестратор принял возобновление общей кампании. Plane перечитан целиком (снимок в /tmp/sj-mvp-queue-20260918.json); №1269 продолжена в существующей сессии Terra medium только для остаточных сценариев. Единственный владелец браузера и runtime — №1269. №1276 возобновлена Terra medium для независимого исследования/кода без браузера, серверов, pytest и тяжёлых сборок до handoff. Старые cwd eda7/3413 отсутствуют: аудит использует worktree99eb, исполнитель1276 восстанавливает отдельную ветку от67b5ad49. Исправление справочников сохраняется накопительно. Повторная реализация1275 запрещена. Очередь: остаток1269 → проверка1276 →434 →1270–1273 → устранение подтверждённых блокеров и итог1274. Переходы не требуют нового разрешения.

2026-09-18. №1267, блокеры1204/1205/1206/1207. Исполнитель: Кодекс Астра 6. После чтения карточек и baseline-доказательств1278 включены ровно четыре подтверждённых блокера обязательного гейта в Backlog с комментарием о разрешении кампании.1204 —18 отказов сбора сил,1205 — необратимый rollback в миграционной пробе (1216 дубль без второй реализации),1206 —10 отсутствующих admin моделей,1207 —реестр ошибки/API контракт. Причина: итоговая проверка MVP требует устранить доказанные поломки гейта; отключать пробы ради зелени запрещено. Остальные предложения автоматически не разрешались. Реализация пока не начата; браузер1269, код1276 без тяжёлых проверок.

2026-09-18. №1267/1269. Исполнитель: Кодекс Астра 6. Получен итог1269:52строки,40PASS/4FAIL/4NOT IMPLEMENTED/1BLOCKED/3NOT TESTED. Synthetic employee create/edit/reload/deactivate подтверждены; обновлены результаты справочников1278; helper закрыт, серверы оставлены на67b5ad49. Новые1279(CSV) и1280(поиск структуры) переведены Backlog с разрешением кампании; исполнитель должен независимо исключить артефакт браузерного инструмента перед кодом. Стенд эксклюзивно у1276. Запущена новая отдельная сессия434, Terra medium, client-new-thread:6c4bdebc-d9e5-4734-87e3-41e5b013f3e4, только исследование/код без общих гейтов до handoff; основа включает67b5ad49. Очередь не остановлена.

2026-09-18. №1267/434/1279. Исполнитель: Кодекс Астра 6. №434 подготовлена в сессии01a0b133-9285-7642-98e6-aad0d004316e, worktree2dff, codex/434-profile-position-display: API self-response добавляет подписи собственной записи; frontend не запрашивает закрытые каталоги для себя. Оркестратор прочитал diff, git diff --check0; live/pytest/gate ещё не выполнены, ждёт1276. На1279 создана новая сессия01a0b13a-dead-7551-930f-e0f0fb910ddd, Luna medium: только независимая диагностика CSV и исключение артефакта helper, без общего runtime. Её возможная связь с1280 проверяется как гипотеза, не факт. Владение браузером/стендом/pytest остаётся у1276. Новые кодовые результаты не объявлены завершёнными.

18.09.2026. №1267/1205. Исполнитель: Кодекс Астра 6. Запущена отдельнаясессия1205 Luna medium, безобщихтестов. Текущаяочередь/сессии/ресурсызафиксированы в QA-Audits/MVP-2026-09-15/orchestrator-state-2026-09-18.md.

18.09.2026. №1267/1205/1206. Исполнитель: Кодекс Астра 6. №1205 подготовлена в worktree3bb0, ветка codex/1205-evaluation-backfill-test, локальный коммит02a91e2d33eee67974de988b6e4e7d761f1362c0. Исполнитель ещё не запускал pytest и не пушил; результат пока не принят. Оркестратор прочитал diff: исторические модели без отката графа, ограничение снимается и восстанавливается только внутри тестовой фикстуры. Требуется фактический прогон. №1206 запущена отдельно, Luna medium, сессия01a0b147-c16c-7b91-861f-3a67411a3324: подготовка регистрации десяти отсутствующих admin моделей, без общего runtime/pytest. Браузер и проверки по-прежнему только у1276: полный frontend smoke620 выполняется; соседние падения пока не доказаны как baseline.

18.09.2026. №1267/1206/1207/1204. Исполнитель: Кодекс Астра 6. №1206 подготовлена, worktree e7c9, codex/admin-1206: 10 моделей добавлены в регистрацию/категории, 7 системных моделей только для чтения. Пока выполнены лишь статические проверки; ждёт pytest и публикацию. №1207 запущена Luna medium, сессия01a0b14d-6c15-7753-be92-cf359b1c1736: подготовка контракта ошибок и проверки API, без runtime. №1204 запущена Astra high для сложного разбора18 отказов сбора сил: сопоставление с актуальными требованиями, без ослабления тестов и без БД до handoff. Браузер/pytest/runtime пока только у1276. Задан необязательный асинхронный вопрос о границе MVP для четырёх отсутствующих разделов; работа над реализованными функциями продолжается, реализация новых разделов без решения не начата.

18.09.2026. №1267: уточнение порядка проверок. Исполнитель: Кодекс Астра 6. Все четыре исправления блокеров бэкенда подготовлены, но ещё не проверены: №1205 (worktree3bb0, локальный02a91e2d), №1206 (e7c9), №1207 (3731), №1204 (сессия01a0b14e-aa23-7632-b223-9ba9da6329d0). В №1204 причиной оказались старые фикстуры: пропущена раскладка квоты, notify возвращает DIRECTORATE_QUOTA_EMPTY, заявка остаётся DRAFT. Меняются только три тестовых файла; бизнес-валидация сохраняется. После завершения полного smoke №1276 планируется короткая последовательная проверка №1205 → №1206 → №1207 → №1204 с единственным владельцем БД. Затем накопленные проверенные коммиты включаются в №434, проверяется профиль и продолжается браузерная очередь. Причина изменения порядка: снять известные блокеры перед повторным общим гейтом, не повторять заведомо красные полные прогоны для каждого локального исправления. Полный обязательный гейт остаётся до итоговой приёмки; ни одна непроверенная карточка не переводится в Review. У №1276 полный smoke достиг449/620, object-passport11/11 прошли; итог общего прогона ещё ожидается.

18.09.2026. №1276/1267. Исполнитель: Кодекс Астра 6. Локальный коммит feb20ae96c74378ecf2ac20007b1ee38b652229b создан; diff содержит запрет редактирования и публикации паспорта без object.manage. Полный браузерный smoke: 520 passed,77 failed,23 skipped из620; object-passport11/11 passed. Причины соседних77падений ещё не установлены.
Push отклонён автоматической проверкой дочерней задачи. Родитель проверил: worktree и основной каталог проекта имеют один .git и одинаковый origin github.com/talasbekov/VAPS.git; ветка1278 ранее опубликована там. Повторная отправка с этим обоснованием также отклонена: проверка требует явного разрешения на конкретную передачу приватного исходного кода в GitHub. Пользователю задан асинхронный вопрос о публикации текущей очереди в ветки codex/* этого репозитория. Ответ обязателен для следующего push; ожидание не трактуется как согласие. Другой remote или обход не используется. Независимые локальные исправления и проверки продолжаются.

18.09.2026. №1205/1206. Исполнитель: Кодекс Астра 6. №1205: целевой тест1passed8.92s, соседние миграционные3passed9.75s; SHA02a91e2d, git show --check0, lock после теста свободен. Доказательства прочитаны в Personnel-Records/Changelog.md. Замечание к процессу: исполнитель задал отдельный PYTEST_LOCK=/tmp/Codex-1000/pytest-lock-1205. Хотя оркестратор обеспечивал отсутствие конкурирующего pytest, такой lock не синхронизирует остальные worktree. №1206 и все дальнейшие прогоны обязаны использовать стандартный путь скрипта /tmp/claude-1000/pytest.lock без override; полная приёмка повторно покроет миграционные тесты под общим замком. Проверка makemigrations с production settings не запускалась из-за отсутствующего DJANGO_SECRET_KEY и не считается дефектом кода. Уточнение: push удерживается автоматической проверкой до ответа заказчика, а не запрещён самим заказчиком. БД/тесты переданы1206; браузерная очередь пока ждёт последовательных проверок.

18.09.2026. №1267/1281. Исполнитель: Кодекс Астра 6. Разбор1281 завершён по сохранённым данным:51падение имеет общий симптом стадии согласования,5 — console404 без сохранённогоURL,6 сопоставлены с существующими карточками,1 department-summary требует повтора,14 остальных — разрозненные гипотезы. Матрица08-smoke-triage.md. Это не доказательство одной причины51падения. Автоматическая проверка отклонила создание отдельной задачи исследования сразу в Backlog, сославшись на AGENTS о новых предложениях. Без обхода создана карточка только в фактическом состоянии «Предложено Claude»; работа по ней не запущена. Пользователю задан асинхронный вопрос о конкретном разборе/исправлении. Ожидание не означает разрешение. Остальные уже разрешённые карточки продолжаются. Отдельно ждём явное разрешение push в github.com/talasbekov/VAPS; вопрос о четырёх отсутствующих разделах пока необязательный, новый функционал не начат.

18.09.2026. №1267/1205/1206. Исполнитель: Кодекс Астра 6. Исправлено ошибочное представление о runtime: host-проверка с escalation обнаружила Django PID38196 на8100 из нашего worktree99eb. Sandbox ps не отражал host-процессы, поэтому прежнее сообщение «runserver остановлен/не запущен» было неверно. Родитель проверил cwd и argv процесса, отправил SIGTERM; process remains=False, host ss показал пустые8100/8101. Frontend3108 PID329118 оставлен. Целевые1+3 теста1205 и тесты1206 фактически исполнялись и результаты сохраняются, но полная приёмка будет заново подтверждена под общим lock при реально остановленном Django. №1206 live:10моделей присутствуют,7системных changelist200/add403; собственная служба8101 погашена. Далее только host-проверка процессов перед pytest, без вывода секретов/окружения.

18.09.2026. №1206/1207/1267. Исполнитель: Кодекс Астра 6. №1206 завершила локальные проверки:490passed, живой Admin показывает10моделей,7системных read-only; SHA2c536828. Родитель прочитал финальныйdiff/stat и git show --check0. Общий окончательный гейт иpush ещё ожидаются, карточкаInProgress. Ресурсы переданы1207: backend8100/8101 реально остановлены родителем наhost, общийdefaultlock обязателен, отдельныеlockзапрещены. После1207 —1204, затем включение всех проверенныхкоммитов и1276 в434 для накопленногоstand и общего backendгейта. Предложение1282 e48f33cd-436a-40ba-a27e-dec1953bfa32 о51workflowпадении остаётся в предложениях до ответа пользователя; это новая работа не запущена. Сессия1281 01a0b160-9d18-7781-8053-a431b24ebfde завершила толькоread-onlyразбор и исправила итог:6падений сопоставлены с карточками,1ещё требуетповтора.

18.09.2026. №1267: четыре блокера проверены, ресурсы переданы №434. Исполнитель: Кодекс Астра 6.
- №1205: 02a91e2d33eee67974de988b6e4e7d761f1362c0; 1 целевой и 3 соседних теста прошли.
- №1206: 2c536828d6aca97790ac0bf830e5f3d80e2dac47; 490 тестов и живой Admin прошли.
- №1207: 518a0cf601d5eb485f2e3bafd59aebadcd55dae3; 176 тестов прошли, дерево чистое.
- №1204: b3d3209c826eb0c7bedb8a6a62b823f37f5c7ab1; 83 теста прошли, дерево чистое. Родитель проверил git show --check.
Все коммиты локальные; push ждёт явного разрешения. №434 (сессия01a0b133-9285-7642-98e6-aad0d004316e, worktree2dff) получила эти четыре коммита плюс паспорт feb20ae96c74378ecf2ac20007b1ee38b652229b для обычного merge с сохранением собственных правок. Теперь только №434 владеет БД/pytest/browser/runtime: RED/GREEN профиля, frontend gate, один общий backend по всем apps на стандартном lock и при реально остановленном Django, затем целевые UI и накопленный стенд3108/8100. Полный620 frontend smoke пока не повторять; его красные причины ещё не устранены, повтор остаётся до итоговой приёмки. №1282 в предложениях, без выполнения до отдельного ответа. Следующая после передачи стенда — №1279.

18.09.2026. №1267/434/1270. Исполнитель: Кодекс Астра 6. №434 доказала RED/GREEN новой регрессии self-response: без правки KeyError rank_label, после правки7passed. Накопленный общий backend pytest по всем apps выполняется под общим замком; до его окончания никакого другого runtime/БД. Отдельно начата только подготовка разрешённого ручного блока №1270: сессия01a0b179-4db9-7151-9836-2689c5f20cdd, Terra medium, без браузера/серверов/pytest до передачи. Порядок дальнейшего UI остаётся434 →1279/1280 →1270. Матрица1270 —03-daily.md. Новые находки этой проверки сохраняются в предложениях, без самостоятельного перевода в Backlog. Разрешения GitHub push и отдельной1282 всё ещё ожидаются.


### 2026-09-18 — №1267: начало интеграции актуального MVP
Исполнитель: Кодекс Астра 6. Подтверждены чистая worktree6190 на510c680a, MVP0f64bac2 и аудит90277694. План: [[WIKI/План-1267-Интеграция-актуального-MVP-2026-09-18]]. До явного handoff родителя общая БД и серверы не изменяются. Push запрещён; карточка остаётся In Progress.


### 2026-09-18 — №1267: merge подготовлен, два конфликта разрешены
Исполнитель: Кодекс Астра 6. В worktree6190 создана codex/mvp-current-integration-1267, выполнен ff до0f64bac2 и merge --no-commit90277694. Конфликт smoke разрешён объединением:142 и134 списка дают144 уникальные спеки, потерянных0. В test_default_api_permissions сохранены обе проверки; устаревшая ручка strength-report заменена актуальной operations, legacy отдельно ожидает404 (смысл №1207). MODULE_ROLE service-summary=DUTY_OFFICER сохранён. Серверы/БД не тронуты, merge ещё не закоммичен, frontend gate следующий.


### 2026-09-18 — №1267: явный handoff получен
Исполнитель: Кодекс Астра 6. Родитель передал исключительное владение QA runtime/БД/pytest после закрытия helper1271; №1270/1273 runtime не используют. Учебный ОМ9848 вRECON, временныйadmin снят; квоты/заявки не создавались. Разрешены read-only migration checks и необходимый backup/forward, один полный gate, восстановление QA. Зависимости frontend скопированы локально после побайтного совпадения обоих manifests; общий node_modules не изменялся.


### 2026-09-18 — №1267: frontend PASS, runtime-гейт остановлен auto-review
Исполнитель: Кодекс Астра 6. npm run gate:front exit0; .next-build/BUILD_ID=Ax2hTp5GGTLJWlSTmIpZG. Read-only showmigrations:0123–0126 уже[X]; migrate --plan:No planned migration operations, exit0. Backup/миграции не нужны и не выполнялись. Auto-review дважды отклонила остановкуQA backend499543 и полныйpytest: не признаёт user-разрешение из родительской задачи достаточным основанием для service interruption/database side effects. Во второй попытке исключены чтение/сохранение environment, явно выбраны test settings и checkout-specific test DB; снова отказ. Ни одна команда не была выполнена, серверы не изменились. Пользователю задан прямой запрос на остановкуQA/pytest/восстановление. Push по-прежнему запрещён.


### 2026-09-18 — №1267: локальный merge 1c3c8050bf124b25dfa1b67723aa5efa123d6314
Исполнитель: Кодекс Астра 6. Merge parents0f64bac2+90277694, веткаcodex/mvp-current-integration-1267, рабочее дерево чистое; push НЕ выполнялся. Front gate exit0, BUILD_ID Ax2hTp5GGTLJWlSTmIpZG. Независимыйreview: новых merge-регрессий нет;108MVP-only+38audit-only файлов совпадают с родителями, четыре автоматических и два ручных пересечения сохраняют оба смысла. Списокsmoke639тестов/144файла; Python AST63изменённыхфайлаPASS. Дополнительные безБД-пробы:service-summary-access1PASS;smoke-preserve-data3FAIL на Uncontrolled teardown dependency:./purge-python; эти3файла идентичны обоимродителям, причина не создана merge. Отказы не исправляются; родитель оформляет отдельное предложение (не1282). Backend gate/UI актуальнойсборки ещёне выполнены — ожидается прямое user-подтверждение после2auto-review отказов.


### 2026-09-18 — №1267: безопасная альтернатива — дополнительный QA
Исполнитель: Кодекс Астра 6. Auto-review разрешила добавочный backend8110 без остановки старыхPID и безpytest/миграций. PID775703, отдельныйhostGET schemaHTTP200. Frontend отдельно собирается .next-qa1267 с BACKEND_URL=http://127.0.0.1:8110; прежняя .next-build/8100 для новогоUI не используется. ОбщуюБД не меняли, старые3108/8100 работают. Полныйbackendgate остаётсяBLOCKED до прямогоответа; UI на новойбазе станет доступен через3110 после проверкиmanifest.


### 2026-09-18 — №1267: дополнительный актуальный QA передан
Исполнитель: Кодекс Астра 6. Merge1c3c8050, фронтgatePASS, дополнительный3110/8110(BUILD_ID EWYHGoZzODbHNp8II8cHY,PID780290/775703),21rewrite→8110,10targetedPASS,поиск1247/adminREADPASS. ПолныйbackendgateBLOCKED auto-review, пользовательскийвопросожидается;старыеPIDнетронуты,pushнет. Полныефакты/проверки/ограничения: [[QA-Audits/MVP-2026-09-15/integration-1267-current-mvp]].


2026-09-18. №1285/1267. Исполнитель: Кодекс Астра 6. Заказчик остановил очередь MVP и поручил только поднять фронт и бэк. Команды остановки отправлены оркестратору и №1269. Порты3108/8100 свободны; PostgreSQL vaps-db-5434 работает. В worktree отсутствуют прежние runtime-ссылки и сборка: восстанавливается запуск без изменений кода.


Исполнитель: Кодекс Астра 6. 18.09.2026. №1285: очередь MVP остановлена по команде заказчика. Поднята актуальная интегрированная версия 1c3c8050bf124b25dfa1b67723aa5efa123d6314 в worktree6190; BUILD_ID EWYHGoZzODbHNp8II8cHY. Frontend http://localhost:3110/ PID45378, backend http://localhost:8110/admin/ PID45289. HTTP: frontend200, NextAuth providers200, Django login200; API через frontend и напрямую возвращает ожидаемый401 без авторизации; PostgreSQL SELECT1 успешен; статические ресурсы200. Промежуточные сервисы старой версии3108/8100 остановлены мной. Код и данные не менялись; запуск без нового полного гейта, не заявляется полная функциональная приёмка MVP. RSS КБ: 45289 116292 python;   45378 123376 next-server (v

18.09.2026. №1285, повторная ошибка запуска. Исполнитель: Кодекс Астра 6. Пользовательская вкладка localhost:3110 показывает Internal Server Error. Воспроизведено: HTTP без Cookie200, qa_probe=1 cookie500. Журнал next: MODULE_NOT_FOUND next/dist/compiled/cookie. cwd frontend45378 и backend45289 отмечены (deleted), worktree6190 отсутствует. Причина — удалённые runtime-файлы при ещё живых процессах. План: восстановить тот же1c3c8050 в постоянной папке, собрать frontend для8110 и заменить только эти два сервиса; проверить cookies/browser/admin/proxy. Код приложения, данные и миграции не менять, аудит не возобновлять.


### 18.09.2026 — №1285: исправлен HTTP500 после удаления временного worktree

Исполнитель: Кодекс Астра 6.

Причина: cwd старых frontend45378/backend45289 были удалены вместе с worktree6190. Запрос без Cookie возвращал200, с `qa_probe=1` —500; журнал показывал MODULE_NOT_FOUND next/dist/compiled/cookie. Это объясняет, почему прежняя поверхностная HTTP-проверка не обнаружила отказ в пользовательской вкладке.

Та же версия `1c3c8050bf124b25dfa1b67723aa5efa123d6314` восстановлена в постоянном `/home/erda/.local/share/vaps/stands/smart-josparlau-1c3c8050` вне каталога сессий Codex. Worktree locked с пояснением, исходники приложения не изменены. Frontend зависимости скопированы после побайтного совпадения package.json/package-lock.json; локальная конфигурация сохранена без вывода секретов. Production build exit0, BUILD_ID `Ud7084QHO1A-ckR6A0i4T`, DIST=.next-stand, BACKEND_URL=http://127.0.0.1:8110. Автоматическую правку tsconfig сборки откатили только в новой рабочей копии, git diff пуст.

Остановлены только два подтверждённых процесса с удалённым cwd. Новые frontend3110 PID215150 и backend8110 PID215077 запущены независимо от терминала. Бэкенд использует стабильный venv основного проекта; media/private_storage/staticfiles связаны с существующими каталогами основного проекта. БД/миграции не менялись. Логи: /tmp/next-prod-3110.log и /tmp/sj-1285-backend-stable.log; сборка /tmp/sj-1285-rebuild.log, exit-файл0.

Проверено свежим выводом: SELECT1=1; frontend с Cookie200; Django login200; JS200/CSS200; auth providers200 JSON; API my-employee прямо и через proxy401 JSON без входа (ожидаемо). Во вкладке пользователя после reload видна форма входа Smart Жоспарлау вместо Internal Server Error. Оба cwd существуют, без (deleted). RSS frontend127988КБ/backend118340КБ.

Текущие адреса: http://localhost:3110/ и http://localhost:8110/admin/. Старый путь6190 больше не использовать для запуска. Коммита и push нет: восстанавливались runtime-файлы, не код. Полный MVP-аудит и очередь остаются остановленными. №1285 передана в Review как проверенное восстановление доступности.


19.09.2026. Новое поручение заказчика после остановленной кампании1267; связи с1278/1206/1137 уточняются в новой сессии. Исполнитель: Кодекс Астра 6. Заказчик поручил проверить все справочники, обеспечить их работу как минимум в Django Admin, показать браузерные проверки, проверить регрессию и подготовить развёртывание в закрытой локальной сети. По прямой просьбе открыта отдельная сессия01a0b672-9346-7201-b217-77e81ba904d2, «Проверить справочники и подготовить закрытый контур», Astra high. Ей переданы правильная база1c3c8050, постоянный стенд, ошибка удалённогоworktree и обязательность видимой браузерной проверки. Она должна завести/связать Plane-карточки до правок, уточнить целевую платформу и выполнить работу в новом объёме; старая общая очередь не возобновлялась. Новая сессия приняла запуск, дальнейшее исполнение и документы ведёт там.


## 2026-09-19 — №1141/1278/1144: начало полного аудита справочников и подготовки LAN
Исполнитель: Кодекс Астра 6.
Новое поручение 19.09: все справочники Django Admin, видимые браузерные проверки, регрессия, подготовка автономного Linux x86_64/Docker (платформа подтверждена заказчиком). Старая очередь MVP не возобновляется. Рабочий checkout828b переведён с устаревшего510c680a на ветку codex/dictionaries-audit-20260919 от1c3c8050; дерево чистое. Постоянный checkout ~/.local/share/vaps/stands/smart-josparlau-1c3c8050 имеет SHA1c3c8050 и только runtime untracked .next-stand/private_storage. Защиту worktree оставили.
Проверка CUA: существующая Chrome вкладка localhost3110 сохранена; новая видимая вкладка Django8110 получила ERR_CONNECTION_REFUSED. ps/ss подтверждают отсутствие3110/8110, PostgreSQL5434 слушает; предыдущие PID после перезапуска машины устарели. Планируется запуск того же runtime без миграций и изменения данных. Plane полностью прочитан CLI с пагинацией; №1141/1278/1275/1206 уже In Progress, №1144 Backlog. №1143 — навигация, не задача offline runtime; расширять её scope не нужно. Исторические результаты тестов не считаются свежей приёмкой.


## 2026-09-19 — Plane №1141/1278: изоляция браузерного гейта
Исполнитель: Кодекс Астра 6. Создана новая локальная PostgreSQL-база sj_qa1909_smoke в существующем vaps-db-5434: перед созданием проверено отсутствие имени, затем consistent pg_dump personnel_records → pg_restore, exit 0. Рабочая база не изменена, дамп не записан во внешний файл и никуда не отправлялся. Цель — изолировать мутации smoke от рабочих учёток и ролей. Отдельная production-сборка .next-qa1909 запущена с BACKEND_URL=127.0.0.1:8112; будущий frontend3112. Эта копия не входит в offline-комплект.

2026-09-19 — Plane №1141/1278. Исполнитель: Кодекс Астра 6. Постоянный locked worktree обновлён на `7ca7315a7a34c2d01eab3363a46e07b36aae14b7` без изменения .next-stand и private_storage; backend8110 PID130401, DB=personnel_records, --noreload. Браузерные действия возобновляются после150passed; pytest завершён и замок освобождён.

2026-09-19 — Plane №1141/1278. Исполнитель: Кодекс Астра 6. Постоянный locked worktree обновлён на `7ca7315a7a34c2d01eab3363a46e07b36aae14b7` без изменения .next-stand и private_storage; backend8112 PID130402, DB=sj_qa1909_smoke, --noreload. Браузерные действия возобновляются после150passed; pytest завершён и замок освобождён.


2026-09-19 — Plane №1141/1278: инфраструктурный отказ smoke. Исполнитель: Кодекс Астра 6. Discovery639tests/144files. Первый запуск остановлен SIGINT только собственного PID142142 после повторяющихся0ms отказов: Playwright1.56 требует отсутствующий chromium_headless_shell-1194, установлен только полный chromium1194 и более новые shell. Это не дефекты приложения. Лог smoke-full.log/exit130 сохранён,61passed — только успевшие статические проверки, не приёмка. Запущена штатная установка `npx playwright install chromium --only-shell`; рабочие сервисы и БД не останавливались.

2026-09-19 — Plane №1144/1107. Исполнитель: Кодекс Астра 6. Подготовлена передача отдельной группе LAN: [[../WIKI/Handoff-LAN-2026-09-19]]. Состав/коммиты/проверки/блокеры записаны до перехода. Родительская задача продолжает639smoke; новая группа изолирует Docker-контур и не трогает работающие3110/8110/3112/8112.

## 19.09.2026 — №1144: старт автономной LAN-поставки

Исполнитель: Кодекс Астра 6.

Отдельная сессия для группы №1144 начата по Plane №1107 и передаче [[../WIKI/Handoff-LAN-2026-09-19]]. Plane-карточка `bb68e670-9a0e-497f-b79f-f8301ff8b3c9` переведена `Backlog → In Progress`; старая MVP-очередь не запускалась. После чистой detached-папки создана ветка `codex/lan-offline-20260919` ровно от актуального `7ca7315a7a34c2d01eab3363a46e07b36aae14b7` (не старого `main`).

Граница приёмки: только собственный Docker Compose project и свободные loopback-порты; рабочие `3110/8110`, QA `3112/8112`, базы `personnel_records`/`sj_qa1909_smoke`, locked runtime и чужие контейнеры не трогаются. Проверены доступные локальные базовые образы PostgreSQL 16, Redis 7 alpine, nginx 1.28 alpine и contour dependency images; свободно около 35 ГБ. GitHub push не выполняется: прежний automatic approval review не дал отдельного нового разрешения.

План [[../WIKI/План-Справочники-LAN-2026-09-19]] и `deploy/lan` прочитаны. Обнаружено требующее исправления несоответствие прямому условию №1144: шаблон и `configure.py` всё ещё по умолчанию содержат исторический IP `10.15.3.187`, хотя IP целевого сервера сейчас неизвестен. Будет добавлена проверка и заменён небезопасный default на обязательный явный параметр; затем — сборка и изолированная offline-приёмка, restart и backup/restore в новый контур.

## 19.09.2026 — №1144: готов переносимый LAN-архив

Исполнитель: Кодекс Астра 6. Готов архив `/home/erda/Backups/smart-josparlau/smart-josparlau-offline-2026-09-19-1144.tar`, `1016M`, SHA-256 `3d1a90bee77d5d454a9efbab32a4c79a427f19713d5f65151b7dbf3d3c1940e6`, `linux/amd64`, source `c41c79a`. Его и все 20 файлов комплекта проверили `sha256sum -c`; tar не содержит `.env`, БД, media/private uploads или учётных записей. Русский runbook находится внутри `INSTALL-RU.md`; IP обязательным параметром `configure.py --ip <IP_СЕРВЕРА>`, исторический IP не подставляется.

Изолированная приёмка чистого запуска, restart, backup/drain и restore в новый пустой проект подтверждена в [[../QA-Audits/LAN-2026-09-19/Приёмка-1144]]. Сборка офлайн (`--network=none --pull=false`), запуск `--pull never --no-build`; portal/Admin/docs/schema дали 200, маркер сохранился после restart и restore. Полный smoke продукта не зелёный: исходно 537 passed/79 failed/23 skipped из 639, exit1; после узкого повтора остаются 73 неснятых отказа. Это не дефект LAN-инсталлятора и не заявлено как продуктовый PASS. Коммиты `865a3e7a`, `759f5a60`, `c86e4164`, `5b5f2459`, `c41c79a` локальные; push не выполнялся из-за отсутствия нового разрешения. №1144 остаётся In Progress.

После приёмки остановлены только собственные проекты `sj-lan1144-primary`, `sj-lan1144-restore`, `sj-lan1144-release` командой `ctl.sh down` без `-v`: контейнеры/сети сняты, учебные тома сохранены для разбора. Контроль `ss` подтвердил, что защищённые `3110/8110/3112/8112` продолжают слушать.

Сырой видимый вывод checksum, config tests, health/HTTP, restart-marker, backup/drain/restore и границы network proof сохранён в [[../QA-Audits/LAN-2026-09-19/raw-command-output]]; значения секретов в него не записывались.


2026-09-19 — Plane №1144, родительское ревью LAN-поставки. Исполнитель: Кодекс Астра 6. При чтении runbook в 759f5a60 найдены противоречия новой чистой поставке: обещана встроенная стартовая БД и сохранённые admin/acc_admin, хотя данные и учётки в комплект не входят. В отдельную LAN-сессию передано требование исправить сценарий чистой установки и выделить restore внешнего backup. Также запрошено прямое доказательство запрета исходящего интернета, поскольку одного отсутствия внешних URL в /docs недостаточно. Итоговый архив до устранения этих замечаний не принимается.


2026-09-19 — Plane №1144, родительская проверка поставки. Исполнитель: Кодекс Астра 6. Архив smart-josparlau-offline-2026-09-19-1144.tar: 1065226240 bytes, SHA256 3d1a90bee77d5d454a9efbab32a4c79a427f19713d5f65151b7dbf3d3c1940e6; хэш независимо пересчитан и совпал. source-revision c41c79a22af9cb7c8c8141e6d3a5490b395366a6, linux/amd64. Проверка списка tar: нет .env/.env.local/database.dump/media.tar.gz/private.tar.gz. Русская инструкция из фактического архива сохранена в [[../OUTPUT/Автономный-комплект-Linux-Docker-2026-09-19]]. Это чистая установка/restore внешней копии; старый upgrade отмечен историческим. Общий функциональный гейт красный.


2026-09-19 — Plane №1144, окончательная передача. Исполнитель: Кодекс Астра 6. Прочитан raw-command-output.md с health/HTTP, restart и restore marker, backup drain и checksum. Отдельно повторён только контракт конфигурации финальной ветки c41c79a: 2 tests, 0.132s, OK; worktree чистый. Название test_all_runtime_networks_are_internal историческое: его фактические assertions требуют internal только default и доступную обычную ingress, как указано в инструкции. Отдельная LAN-сессия завершена; тестовые Docker-контуры остановлены без удаления томов. Локальные результаты передаются заказчику, GitHub push ожидает явного разрешения на передачу приватного кода в две ветки codex/dictionaries-audit-20260919 и codex/lan-offline-20260919 репозитория talasbekov/VAPS. Общий продуктовый гейт не принят.


2026-09-19 — Plane №1144. По просьбе заказчика инструкция сокращена до четырёх шагов: распаковка, адрес сервера и запуск, создание администратора, вход. Команды сверены с INSTALL-RU.md и ctl.sh фактического комплекта; отмечена граница новой установки без прежних данных. Краткая инструкция: vault OUTPUT/Автономный-комплект-Linux-Docker-2026-09-19.md. Сам архив не менялся; техническая инструкция сохранена внутри него. Исполнитель: Кодекс Астра 6. Проверка: файл краткой инструкции записан и перечитан; все четыре команды соответствуют имеющимся скриптам, установки на чужом сервере не выполнялось. Коммита нет: изменён только внешний vault.


## 24.10.2026 — Plane №1291: обновление из GitHub

Исполнитель: Кодекс Астра 6. По поручению заказчика выполнены status и fetch origin. Ветка main отстаёт от origin/main на 12 коммитов, собственных опережающих коммитов нет (0/12). Отслеживаемые файлы без локальных правок; неотслеживаемый Backend/PersonnelStatus/PersonalRecordFront/.next-mvp-20260916/ сохраняется. Следующий шаг: fast-forward до 68bdbe57 с проверкой равенства HEAD и origin/main. Очередь разработки не запускалась.


24.10.2026 — Plane №1291, результат. Исполнитель: Кодекс Астра 6. git merge --ff-only origin/main завершён успешно: 510c680a → 68bdbe57c97631a1876886104ffc6254bc28cf27, получено 12 коммитов. Проверка rev-parse: HEAD и origin/main равны; rev-list: 0/0. Неотслеживаемый каталог сборки сохранён. После checkout Git показывает 26 изменённых файлов из-за окончаний строк CRLF/LF: git diff --ignore-space-at-eol --stat пустой; обычный diff — 4634 insertions/4634 deletions. Нормализация и изменение настроек Git не выполнялись. Сборка, тесты, миграции и перезапуск сервисов не выполнялись: поручение ограничено получением кода. Собственный коммит и push не требуются, локальных кодовых правок не вносилось. Карточка передана в Review; очередь разработки не запускалась.
