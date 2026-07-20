---
baseline_commit: ff5ca06 (HEAD, `feat(story-12.1)`). Рабочее дерево чисто относительно `Backend/**`, `deploy/**`, `frontend/**`; вне скоупа — modified `.claude/settings.json` и untracked `_bmad-output/story-automator/**` (чужие, не трогать).
baseline_tests: `cd Backend/VAPS && make gate` → **2491 passed, 56 deselected, «No changes detected»** (замер финального прогона 12.1 на этом же состоянии кода). Стори НЕ трогает Python/фронт-код вовсе — счёт обязан остаться 2491/56.
prerequisite: 12.1 (`done`, ff5ca06) — прод-образы `Backend/VAPS/Dockerfile` + `deploy/nginx/Dockerfile`, компоуз с `VAPS_IMAGE_TAG`, корневой `.dockerignore`-allowlist. Всё в HEAD.
scope_note: Скоуп = epic-AC 12.2 (bundle.sh + manifest + sha256sums + repro) и НИЧЕГО из соседей: install.sh/smoke.sh — 12.3, CHECKLIST — 12.5, beat — 12.6. Подпись/pinned-hash доставки — сторона install (deferred-work.md:90/103), НЕ сюда; бандл-сторона обязана закрыть только СВОЙ deferred-хвост :115 (усечённый tar).
context:
  - _bmad-output/planning-artifacts/epics.md#L1286-1292 (Story 12.2 AC: «vaps-<дата>-<sha>.tar: docker save + manifest.json (sha, digests, список миграций, мин. версия апгрейда) + sha256sums; фронт того же sha»; «повторная сборка того же sha даёт тот же состав»)
  - _bmad-output/planning-artifacts/architecture.md#L560-561 (дерево: `bundle.sh → vaps-<дата>-<gitsha>.tar + manifest.json (sha, digests, список миграций, мин. версия) + sha256sums`), #L567 (секреты доставляются ОТДЕЛЬНО от бандла), #L56 (air-gap канон)
  - `frontend/scripts/build-constants.ts:5-24,90-91` — 🔴 ПРЯМОЙ КОНТРАКТ НА ЭТУ СТОРИ: «👉 СЮДА СМОТРИТ СТОРИ 12.2 … 12.2 обязана экспортировать в окружение сборки фронта РОВНО те значения, которые запишет в manifest.json» (`VAPS_APP_VERSION` → `__APP_VERSION__`, `VAPS_BUILD_SHA` → `__BUILD_SHA__`); тогда epic-AC «фронт того же sha» выполняется БЕЗ правки фронта
  - `deploy/spike-1.9/build-bundle.sh` — прото-механика (build → save → sha256sum), сама отказывается делать manifest («это E12»); конвенции: set -euo pipefail, cd "$(dirname "$0")", фиксированный тег
  - `_bmad-output/implementation-artifacts/deferred-work.md:115` — 🔴 БАНДЛ-хвост спайка: «docker save на заполненном диске даёт усечённый .tar, чей sha посчитается зелёным по факту записи → в контуре sha-чек ПРОЙДЁТ, а docker load упадёт после изменений. E12-bundle.sh должен верифицировать … docker load в dry-режиме помимо sha»; `:90`/`:103` (pinned hash, image-identity) — сторона install.sh 12.3, НЕ бандла
  - `deploy/docker-compose.yml` (12.1) — потребитель тега: `image: vaps-app:${VAPS_IMAGE_TAG:-dev}`, `.env.example`: «12.2 будет ставить сюда версию релиза»
  - `Backend/VAPS/config/settings.py` — БД-фолбэк sqlite при отсутствии VAPS_DB ⇒ `showmigrations` внутри образа работает БЕЗ БД (важно для манифеста)
  - `_bmad-output/implementation-artifacts/12-1-прод-compose.md` — ревью-уроки: build-context'ы двух образов РАЗНЫЕ (app = Backend/VAPS, nginx = корень репо), корневой `.dockerignore` — allowlist, nginx-конфиг теперь ШАБЛОН
---

# Story 12.2: bundle.sh и manifest

Status: done

## Story

As a **разработчик, готовящий перенос релиза в закрытый контур носителем**,
I want **один скрипт `deploy/scripts/bundle.sh`, который из ЧИСТОГО git-дерева собирает фронт и оба прод-образа под релизным тегом `<дата>-<shortsha>`, упаковывает оба образа одним `docker save`-архивом `vaps-<дата>-<shortsha>.tar`, кладёт рядом `manifest.json` (git sha, версия, образы+digests, список миграций из СОБРАННОГО образа, мин. версия апгрейда) и `sha256sums.txt`, и проверяет собственный продукт (`docker load` из архива + сверка манифеста при повторной сборке)**,
so that **релиз — один проверяемый артефакт (epic-AC), install.sh 12.3 получает вход, а футер SPA в контуре показывает реальную версию релиза (шов 10.9 закрывается без правки фронта)**.

## Acceptance Criteria

Источник: epics.md#L1286-1292; architecture.md#L560-561/#L567; build-constants.ts:5-24; deferred-work.md:115; уроки ревью 12.1.

**AC-0 · ГРАНИЦА (читать первым).**
НЕ строим: `install.sh`/`smoke.sh` (12.3), `CHECKLIST.md` (12.5), beat-регистрацию (12.6), подпись/pinned-hash доставки и image-identity-verify на стороне контура (это install-сторона, deferred-work.md:90/103 — остаются там), офлайн-зеркала npm/pip (сборка идёт на online dev-машине — канон 12.1). **`frontend/**` и `Backend/VAPS/**` НЕ правятся ни строкой** — bundle.sh только ВЫЗЫВАЕТ существующие сборки. Секреты в бандл НЕ попадают (architecture.md#L567): архив содержит образы+манифест+суммы, `.env` — отдельная процедура. Если по ходу нужна правка фронта/бэка — СТОП и эскалация.

1. **AC-1 · `deploy/scripts/bundle.sh` (NEW): чистое дерево по артефакт-путям — обратный гейт.**
   Given незакоммиченные изменения в путях, ВХОДЯЩИХ в артефакт (`git status --porcelain -- Backend frontend deploy .dockerignore .gitignore` непуст), When запущен `bundle.sh`, Then скрипт отказывается ДО каких-либо сборок с внятным сообщением — иначе sha в имени/манифесте лжёт о содержимом образов. Пути перечислены СПИСКОМ в скрипте с комментарием-инвариантом: «новый корневой путь, попадающий в build-context любого образа, обязан быть добавлен сюда тем же PR». Грязь ВНЕ этих путей (доки `_bmad-output/**`, локальные `.claude/**`) сборку НЕ блокирует — оба build-context'а её исключают (.dockerignore-allowlist корня + контекст app = Backend/VAPS), т.е. на груз она не влияет физически. Байпаса артефакт-грязи нет (никакого `--allow-dirty`).
2. **AC-2 · Релизный тег и версия.**
   `RELEASE_SHA=$(git rev-parse --short HEAD)`, `RELEASE_TAG=$(date -u +%Y%m%d)-${RELEASE_SHA}` (дата — UTC, зеркало build-bundle.sh спайка). Оба образа собираются как `vaps-app:${RELEASE_TAG}` и `vaps-nginx:${RELEASE_TAG}` — тег совпадает с `VAPS_IMAGE_TAG`, который оператор ставит в `.env` контура (контракт `deploy/docker-compose.yml` 12.1). Команды сборки — ДОСЛОВНО из комментариев Dockerfile'ов 12.1 (context app = `Backend/VAPS`, context nginx = корень репо; фронт собирается ДО nginx-образа).
3. **AC-3 · Шов версии 10.9 закрыт: фронт собирается с env релиза.**
   When bundle.sh запускает `npm run build`, Then в окружении сборки экспортированы `VAPS_APP_VERSION=${RELEASE_TAG}` и `VAPS_BUILD_SHA=$(git rev-parse HEAD)` (полный sha) — РОВНО те значения, что уходят в manifest.json (контракт build-constants.ts:16-24 дословно). Проверка: `grep -c "${RELEASE_TAG}" frontend/dist/assets/*.js` ≥ 1 (версия реально в бандле).
4. **AC-4 · Один архив, оба образа.**
   `docker save vaps-app:${RELEASE_TAG} vaps-nginx:${RELEASE_TAG} -o vaps-${RELEASE_TAG}.tar` — ОДИН .tar (epic: «релиз — один проверяемый артефакт»); вывод в `deploy/bundles/` (создаётся скриптом, в `.gitignore`).
5. **AC-5 · `manifest.json` рядом с архивом.**
   Поля (jq-читаемый плоский JSON): `schema_version` (1), `release_tag`, `git_sha` (полный), `build_date` (UTC ISO), `bundle_file`, `bundle_sha256`, `bundle_size_bytes`, `images[]` (по каждому: `name:tag`, `image_id` (`docker image inspect --format {{.Id}}`)), `migrations[]` — 🔴 из СОБРАННОГО app-образа: `docker run --rm vaps-app:${RELEASE_TAG} python manage.py showmigrations --plan` (без VAPS_DB-env: sqlite-фолбэк settings, живая БД НЕ нужна; манифест описывает то, что реально едет в образе, а не состояние дев-дерева), `min_upgrade_from` — статичное поле скрипта (первый релиз: `null`; правится осознанно при breaking-релизах; потребитель — install.sh 12.3).
6. **AC-6 · `sha256sums.txt` покрывает И архив, И манифест.**
   `sha256sum vaps-<tag>.tar manifest-<tag>.json > sha256sums-<tag>.txt` — сверка на стороне контура ловит порчу ОБОИХ (спайк проверял только .tar). Имена файлов манифеста/сумм несут тег (`manifest-<tag>.json`), чтобы несколько релизов жили в одном каталоге носителя не затирая друг друга.
7. **AC-7 · Самопроверка продукта — закрытие deferred-work.md:115.**
   After save, When bundle.sh продолжает, Then он (а) сверяет `bundle_size_bytes` > 0 и (б) прогоняет **контрольный `docker load -i` собранного архива** (образы уже резидентны — load идемпотентен и дёшев; усечённый недописанный tar на нём упадёт ЗДЕСЬ, на dev-машине, а не в контуре после изменений). Провал load = провал скрипта, артефакты помечаются битыми (удаляются с сообщением).
8. **AC-8 · Воспроизводимость: «повторная сборка того же sha даёт тот же состав».**
   `bundle.sh --verify-repro` (или второй прогон): пересборка на том же sha и сравнение манифестов ПО ДЕТЕРМИНИРОВАННЫМ полям — `git_sha`, `release_tag` (при том же UTC-дне), `images[].name`, `migrations[]`, `min_upgrade_from`, `schema_version`. `build_date`/`bundle_sha256`/`bundle_size_bytes` в сравнение НЕ входят (см. Решение №4: docker save недетерминирован побайтово). `images[].image_id` сравниваются с ПРЕДУПРЕЖДЕНИЕМ (не фейлом) при расхождении — холодный docker-кэш легитимно меняет ID при том же составе. Расхождение детерминированных полей = fail.
9. **AC-9 · Гейт зелёный, регресс нулевой.**
   `bash -n deploy/scripts/bundle.sh` чист; `cd Backend/VAPS && make gate` → 2491/56, «No changes detected»; `git status` подтверждает: `frontend/**`, `Backend/VAPS/**` не тронуты (кроме — ничего).

## Tasks / Subtasks

- [x] Task 1 — каркас скрипта (AC: #1, #2)
  - [x] `deploy/scripts/bundle.sh`: `set -euo pipefail`, cd в корень репо, гейт чистого дерева по артефакт-путям (красная проба: грязный `deploy/.env.example` → ОТКАЗ до сборок), RELEASE_TAG/SHA
- [x] Task 2 — сборки (AC: #2, #3)
  - [x] фронт: `VAPS_APP_VERSION`/`VAPS_BUILD_SHA` в env → `npm run build`; grep-гейт версии в dist (внутри скрипта, fail при фолбэке)
  - [x] оба образа под `${RELEASE_TAG}` + `--provenance=false` (находка живого прогона — см. Completion Notes №1)
- [x] Task 3 — упаковка (AC: #4, #5, #6)
  - [x] `docker save` обоих образов одним архивом в `deploy/bundles/` (110MB — containerd-store пишет блобы сжатыми)
  - [x] `manifest-<tag>.json` — все поля AC-5; 64 миграции из ОБРАЗА (sqlite-фолбэк, БД не поднималась)
  - [x] `sha256sums-<tag>.txt` (архив + манифест; `sha256sum -c` → оба «ЦЕЛ»)
- [x] Task 4 — самопроверка (AC: #7)
  - [x] size-чек + контрольный `docker load`; на провале — артефакты удаляются, exit 1
- [x] Task 5 — repro-режим (AC: #8)
  - [x] `--verify-repro`: после provenance-фикса — «OK: повторная сборка того же sha дала тот же состав», image_id СОВПАЛИ (warning-ветка осталась для холодного кэша)
- [x] Task 6 — гигиена и прогоны (AC: #9)
  - [x] `.gitignore`: `deploy/bundles/`
  - [x] живой прогон ПОЛНОГО пути: bundle → json.tool-валидация → `--verify-repro` OK → БОНУС: rmi обоих образов → `sha256sum -c` → `docker load` → compose up на релизном теге → SPA/admin 200 → **релизный тег найден в отдаваемом JS-бандле** (шов 10.9 end-to-end) → down -v
  - [x] `make gate` 2491/56 «No changes detected»; `bash -n` чист
- [x] Task 7 — sprint-status: `12-2 → review` (после ревью — done)

### Review Findings

Ревью 2026-07-20 (bmad-code-review, 3 слоя субагентами Fable 5; ⚠️ same-model к спеке+dev этой сессии). Итог: **8 patch (все применены, коммит b0ee7bc, каждый верифицирован живым прогоном), 2 defer, 6 dismiss.**

- [x] [Review][Patch] **HIGH (Edge):** `--verify-repro` перетегивал резидентные `vaps-*:<тег>` на пересобранный образ и выходил 0 — тег на машине переставал совпадать с содержимым tar при зелёном статусе. Фикс: после сравнения (любой исход) `docker load -i` бандла восстанавливает теги; вердикт снимается без set -e. Проверено: резидентный image_id == манифестному после verify [deploy/scripts/bundle.sh]
- [x] [Review][Patch] Пайп манифеста дописывал правдоподобный JSON до pipefail-аборта (обрыв docker run → «migrations: []» на диске, sums нет) + упавший `docker save` оставлял усечённый tar. Фикс: ERR-trap в do_build подчищает тройку текущего тега; манифест — tmp+атомарный mv; `set -E` для наследования trap [deploy/scripts/bundle.sh]
- [x] [Review][Patch] Репро через границу UTC-суток был невозможен (тег содержит дату → «нет манифеста, сначала сборка» уводил в ПЕРЕсборку нового бандла). Фикс: `--verify-repro [тег]` + сверка `git_sha` манифеста с HEAD (репро чужого коммита — ОТКАЗ с точным сообщением). Оба пути проверены живьём [deploy/scripts/bundle.sh]
- [x] [Review][Patch] Шов версии грепался только по тегу — потеря `VAPS_BUILD_SHA` уходила в молчаливый фолбэк build-constants (короткий sha ≠ манифестному) при зелёном гейте (Auditor; класс «вакуумный фолбэк-ассерт»). Фикс: grep по ОБОИМ + явный чек наличия .js-ассетов (незаэкспанденный глоб давал ложный диагноз «шов не сработал») [deploy/scripts/bundle.sh]
- [x] [Review][Patch] `npm run build >/dev/null` глотал tsc-диагностику (ошибки компиляции — в stdout). Вывод больше не глушится [deploy/scripts/bundle.sh]
- [x] [Review][Patch] Конкурентные прогоны рвали общие детерминированные имена артефактов. flock на `bundles/.lock`, проба: второй экземпляр — ОТКАЗ [deploy/scripts/bundle.sh]
- [x] [Review][Patch] WARNING утверждал «состав при этом идентичен» — незнаемое скрипту (без лок-файлов холодный кэш легитимно тянет другие версии). Текст переписан честно + указывает на restore [deploy/scripts/bundle.sh]
- [x] [Review][Patch] Epic-слово «digests» реализовано полем image_id (.Id) без декларации. Задекларировано комментарием у `image_id()` (для локально собранных образов RepoDigests не существует; .Id — content-addressable sha256, при containerd-store совпадает с digest) [deploy/scripts/bundle.sh]
- [x] [Review][Defer] Нет лок-файлов: pip range-пины + `npm run build` (не ci) → холодная пересборка легитимно меняет версии зависимостей, репро-сверке это не видно — deferred, отдельная hardening-тема (deferred-work.md)
- [x] [Review][Defer] Гейт чистоты не видит gitignored-файлы, попадающие в build-context (случайный локальный файл в Backend/VAPS уедет в образ мимо sha-честности; .dockerignore кроет известные классы) — deferred, аудит контекста (deferred-work.md)

Dismissed (6): «verify-repro — неисполняемый заглушечный python» (артефакт сокращённого диффа в промпте Blind — реальный файл дважды исполнен живьём); «showmigrations требует БД» (sqlite-фолбэк, Edge подтвердил прогоном); «nginx-контекст шире гейта» (корневой allowlist кроет — только deploy/nginx+frontend/dist); «stale dist зеленит grep» (vite emptyOutDir чистит dist каждый build — Edge проверил); «--provenance падает на classic builder» (скрипт живёт только на dev-машине, docker 29 проверен); `-q` не «дословно из Dockerfile-комментариев» (нит).

### Senior Developer Review (AI)

- Итог: **APPROVE после патчей** (2026-07-20, коммит b0ee7bc). Верификация патчей — живая: flock-проба, полный бандл нового sha, verify-repro без аргумента И с тегом, sha-гейт чужого тега, restore-инвариант (резидентный id == манифестному). Гейт 2491/56, «No changes detected».
- Сильнейшая находка (Edge, HIGH) — побочный эффект verify-repro: инструмент проверки сам портил состояние машины (тег ≠ tar). Класс — «ревизор мутирует проверяемое»; закрыт restore-инвариантом из эталона (бандла).
- Action Items: нет открытых.

## Dev Agent Record

### Agent Model Used

claude-fable-5 — спека и dev одной сессией (⚠️ same-model; спека 12.1 была Sonnet 5).

### Debug Log References

- Красная проба AC-1: `echo "# probe" >> deploy/.env.example` → «ОТКАЗ: незакоммиченные изменения в артефакт-путях» до единой сборки; probe снят `git checkout`.
- Живой прогон №1 (тег 20260720-9f52f22): бандл собран, но `--verify-repro` дал WARNING по ОБОИМ image_id при тёплом кэше → диагноз: дефолтные BuildKit provenance-аттестации (таймстамп в манифесте образа) → фикс `--provenance=false` → amend.
- Живой прогон №2 (тег 20260720-579b514, итоговый): [1/4]→[4/4] без сюрпризов; манифест: 64 миграции (core.0001_initial … sessions.0001_initial), оба image_id; `--verify-repro` → «OK … тот же состав», предупреждений НОЛЬ.
- Самодостаточность: `docker rmi` обоих → `sha256sum -c` «ЦЕЛ»×2 → `docker load` восстановил оба → `compose up` с `VAPS_IMAGE_TAG=20260720-579b514` → `/` 200, `/admin/login/` 200, тег найден в JS-ассете (1 вхождение) → `down -v`.
- Гейт: 2491 passed / 56 deselected / «No changes detected» (env очищен от VAPS_JWT_KEY — урок 459-инцидента 12.1).

### Completion Notes List

1. **Находка живого прогона: BuildKit provenance ломал repro-сигнал.** Дефолтные аттестации (`--provenance` unset) кладут в образ метаданные с таймстампом сборки → image_id разный на КАЖДОМ прогоне даже при 100% кэш-хите; сверка id была бы вечным ложным WARNING. `--provenance=false` в обеих сборках; после него повторная сборка даёт побайтово тот же image_id. Warning-ветка сохранена — она осталась нужной для легитимного холодного кэша (другая машина).
2. **AC-1 уточнён на этапе спеки (до кода): чистота по артефакт-путям**, не по всему дереву — `_bmad-output/**` (стори-доки) и `.claude/**` не входят ни в один build-context физически; полный porcelain-гейт блокировал бы каждый прогон вечно-грязными чужими файлами. Список путей — в скрипте с комментарием-инвариантом.
3. **Двухкоммитная стори**: реализация закоммичена ДО живого прогона (579b514, amend после provenance-фикса) — гейт чистоты AC-1 физически требует чистых артефакт-путей для честного прогона. Прецеденты: 5.1, 6.9.
4. Манифест пишется python3 stdlib (не jq — не гарантирован в системе); jq-читаемость проверена `python3 -m json.tool`.
5. 110MB на оба образа: docker 29 + containerd image store экспортирует сжатые блобы — это норма, `docker load` симметричен.

### File List

- `deploy/scripts/bundle.sh` (NEW — сборка/манифест/суммы/self-check/verify-repro)
- `.gitignore` (M — `deploy/bundles/`)
- `_bmad-output/implementation-artifacts/12-2-bundle-sh-и-manifest.md` (M — этот файл)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (M — 12-2 → review)

### Change Log

- 2026-07-20: полный dev-проход; двухкоммитная схема (feat 579b514 = скрипт+gitignore; доки — с ревью-коммитом). Живой прогон полного пути включая restore-цикл. Статус → review.

## Dev Notes

### Решения (Bratan-overridable)

- **Решение №1:** оба образа — ОДИН `docker save`-архив (epic: «один проверяемый артефакт»); manifest и суммы — рядом, не внутри (менять манифест без переупаковки 26-гигового tar).
- **Решение №2:** список миграций — из ОБРАЗА (`docker run … showmigrations --plan`, sqlite-фолбэк), не из дев-дерева: манифест описывает груз, а не верстак.
- **Решение №3:** `min_upgrade_from` — данные скрипта (константа), не вычисление: первый релиз `null`, breaking-релизы правят руками. Потребитель — 12.3.
- **Решение №4:** воспроизводимость = детерминированные поля манифеста, НЕ байты архива: `docker save` несёт таймстампы/порядок слоёв, побайтовый детерминизм недостижим без обвязки уровня buildkit-репро; честный чек — состав (образы, миграции, версии) + warning на image_id.
- **Решение №5:** `--verify-repro` — режим того же скрипта, не второй скрипт: переиспользует те же функции сборки, расхождение логики build/verify исключено конструктивно.

### Ловушки (из 12.1 и спайка)

- Контексты сборки РАЗНЫЕ: app = `Backend/VAPS` (свой .dockerignore), nginx = корень (allowlist-.dockerignore, `frontend/dist` должен существовать ДО).
- nginx-конфиг — ШАБЛОН (`vaps.conf.template` → /etc/nginx/templates/), Dockerfile 12.1 уже прав — bundle.sh это не трогает.
- `showmigrations` внутри образа: НЕ передавать VAPS_DB-env вовсе (sqlite-фолбэк); `--plan` даёт линейный список.
- Кириллический путь репо: в bash-скрипте кавычить ВСЕ пути (прецедент build-constants.ts «ловушка 7»).
- `docker save` на полном диске → усечённый tar с «зелёным» sha (deferred :115) — потому контрольный load ОБЯЗАТЕЛЕН до объявления успеха.

### Testing

- Automated: `bash -n` (синтаксис); `make gate` (регресс, бэк не тронут).
- Manual (обязателен, вывод в Dev Agent Record): полный прогон bundle.sh → jq-валидация манифеста → `--verify-repro` → контрольный `docker load`. Прогон «архив самодостаточен» (rmi → load → compose up c `VAPS_IMAGE_TAG=<tag>` → curl) — желателен, время позволяет.
- Integration: нет — потребитель манифеста (install.sh) появится в 12.3.
