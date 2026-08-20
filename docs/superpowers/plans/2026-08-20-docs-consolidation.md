# План исполнения: консолидация документации VAPS → Obsidian vault

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** привести документацию VAPS к единой актуальной версии по утверждённой структуре Этапа 2 и выгрузить в `obsidian-vault/` с frontmatter, тегами и wiki-ссылками.

**Architecture:** vault остаётся хранилищем истины; добавляются разделы `Продукт/` (описание системы 1:1 по прототипу и коду) и `Требования/` (карта канона); пакет `docs/frontend/` сливается в `Frontend/`; устаревшее переезжает в `Archive/`; мусор удаляется. Источник контента: `Прототип/*.dc.html` (экраны/флоу) + сайдбар и маршруты `Backend/PersonnelStatus/PersonalRecordFront` (термины) + Django-apps `Personnel-Records` (данные/API).

**Tech Stack:** markdown + Obsidian wiki-links, git, bash.

## Global Constraints

- Язык — русский; заголовки — «Предложение с большой буквы».
- Терминология модулей — строго из сайдбара PersonalRecordFront; экраны/флоу — из прототипа; при расхождении: имя кода + пометка «в прототипе: …».
- 4 модуля («Обзор», «Структура организации», «Статусы сотрудников», «Отчеты») НЕ переименовывать; в каждом пометка «в прототипе объединены как „Сотрудники и штат“».
- Ничего не выдумывать: чего нет ни в прототипе, ни в коде → строка в `Продукт/_backlog-unverified.md`.
- Frontmatter каждого нового/правленого файла vault:
  ```yaml
  ---
  title: <название>
  module: product | security-ops | personnel-records | frontend | infrastructure | bmad | requirements | archive
  updated: 2026-08-20
  tags: [<module|live-backend|mock-backend|process|canon|archive>]
  ---
  ```
- Канон (`docs/PersonnelStatus/*`, `docs/RECONCILIATION.md`, `docs/api-gaps.md`, `docs/registries/`) не редактировать.
- Коммит после каждой задачи; сообщения `docs(vault): …`.

## Шаблон модульного дока (задачи 2–3)

```markdown
---
title: <Модуль>
module: <product|security-ops>
updated: 2026-08-20
tags: [module, <live-backend|mock-backend>]
---

# <Модуль>

> В прототипе: «<имя>» (если отличается) / В прототипе объединены как «Сотрудники и штат» (для четвёрки).

## Назначение
1–3 предложения: зачем модуль, кому.

## Маршрут и доступ
`/путь` из кода; ресурс/право из сайдбара или use-ops-permissions.

## Экраны и флоу
Из прототипа (вкладки, этапы, действия, состояния) — только то, что есть в прототипе или коде.

## Данные и API
Django-app + ключевые эндпоинты (или «мок MSW, бэка нет — осознанно»).

## Ограничения и расхождения
Известные ограничения (поля без хранилища и т.п.) со ссылкой на [[_backlog-unverified]].

## Связи
[[Карта-модулей]], соседние модули, [[../Personnel-Records/Known-Issues|Known-Issues]] при наличии дефектов.
```

---

### Task 1: Каркас раздела «Продукт» (3 файла)

**Files:**
- Create: `obsidian-vault/Продукт/Обзор-продукта.md`, `obsidian-vault/Продукт/Карта-модулей.md`, `obsidian-vault/Продукт/_backlog-unverified.md`

**Interfaces:** Produces: имена файлов, на которые ссылаются задачи 2–3 и 00-Index.

- [ ] **Step 1:** `Обзор-продукта.md` — что такое система (портал «Проект Расход» + раздел «Охранные мероприятия», закрытый контур), стек (Next.js :3106 + Django :8100), роли; источники: README.md, эталон, master prompt (только конспект).
- [ ] **Step 2:** `Карта-модулей.md` — таблица: модуль кода → маршрут → имя в прототипе → статус бэка; отдельный блок «Сотрудники и штат = 4 модуля»; блок «удалено из продукта» (SPA /ops/*, «План дежурств» 13.08.2026).
- [ ] **Step 3:** `_backlog-unverified.md` — стартовые записи: экран «План дежурств» из прототипа; поля без хранилища (охраняемые лица в карточке ОМ, старший ГВО, численность/кол-во охраняемых); семантика «сдано, но разошлось»; амендмент-флоу ретро-правок без UI-сценария.
- [ ] **Step 4:** Проверка: у всех трёх файлов есть frontmatter (`grep -L '^---' obsidian-vault/Продукт/*.md` пуст).
- [ ] **Step 5:** Commit `docs(vault): раздел Продукт — обзор, карта модулей, backlog-unverified`.

### Task 2: Продукт/Портал — 6 модульных доков

**Files:**
- Create: `obsidian-vault/Продукт/Портал/{Обзор,Структура-организации,Статусы-сотрудников,Отчеты,Управление-персоналом,Настройки}.md`

**Interfaces:** Consumes: шаблон и Карта-модулей из Task 1. Produces: доки, на которые ссылается 00-Index.

- [ ] **Step 1:** Написать 6 файлов по шаблону; источники: маршруты `app/{dashboard,organization,statuses,reports,employees,settings}`, бэк-apps (statuses→statuses/secondments, organization→divisions/staff_unit, reports→reports, employees→employees/documents). У четвёрки — обязательная пометка про «Сотрудники и штат».
- [ ] **Step 2:** Проверка: `grep -l "Сотрудники и штат" Продукт/Портал/*.md` даёт ровно 4 файла (Обзор, Структура-организации, Статусы-сотрудников, Отчеты); frontmatter везде.
- [ ] **Step 3:** Commit `docs(vault): Продукт/Портал — 6 модульных доков`.

### Task 3: Продукт/Охранные-мероприятия — 13 модульных доков

**Files:**
- Create: `obsidian-vault/Продукт/Охранные-мероприятия/{Командный-центр,Реестр-ОМ,Реестр-ГВО,Сбор-сил-на-ОМ,Охраняемые-лица,Объекты-и-паспорта,Законы-об-ОМ,Календарь-смен,Боевые-группы,Расход-дня-ОМ,Оперативный-рейтинг,Аналитика-и-отчёты-службы,Администрирование.md}`

**Interfaces:** Consumes: шаблон, Карта-модулей. Produces: доки для 00-Index.

- [ ] **Step 1:** Написать 13 файлов по шаблону. Флоу — из прототипа (`VAPS Prototype.dc.html`: жизненный цикл ОМ 8 этапов, запросы направлениям/брокеры, конфликты, контрольный час 17:00; `Объекты.dc.html`: паспорт, посты/секторы, контрольные вопросы, проверка; `КалендарьСмен.dc.html`: проекция статусов, конфликты, причина обхода 409; `Дежурства.dc.html` — только замены на посту, живущие в Календаре-смен). Термины и статус бэка — из кода. Теги: mock-backend у ГВО/Охраняемых-лиц/Законов; переименования: Сбор-сил (Потребность), Расход-дня-ОМ (Расход и светофор).
- [ ] **Step 2:** Проверка: 13 файлов, frontmatter везде, `grep -l "mock" …` покрывает три моковых.
- [ ] **Step 3:** Commit `docs(vault): Продукт/Охранные-мероприятия — 13 модульных доков`.

### Task 4: Требования/Канон.md

**Files:**
- Create: `obsidian-vault/Требования/Канон.md`

- [ ] **Step 1:** Карта канона: таблица «документ → статус → что устарело» для ПланРасстановка(+Дополнение), VAPS_7.8.2, USE_CASES, RECONCILIATION (пометить G1/R6 как «описывает выведенный Backend/VAPS»), api-gaps (заморожен), registries (донор-фантомы — сверять с raise-сайтами). Ссылки на файлы `docs/…` обычными markdown-ссылками (вне vault), wiki-ссылки — на [[../Продукт/Карта-модулей|Карту модулей]].
- [ ] **Step 2:** Commit `docs(vault): Требования/Канон — карта канона требований`.

### Task 5: Слияние docs/frontend/ → Frontend/

**Files:**
- Create: `obsidian-vault/Frontend/{Архитектура,Тестирование,Дизайн-и-скин}.md`
- Modify: `obsidian-vault/Frontend/{Decisions,Known-Issues}.md` (дописать разделы)
- Delete: `docs/frontend/` (13 файлов, после слияния)

- [ ] **Step 1:** `Архитектура.md` ← конспект FRONTEND_SOURCE_INDEX + FRONTEND_ROUTE_MAP + FRONTEND_TRACEABILITY_MATRIX (структура app/, features/, entities/, маршруты, прослеживаемость).
- [ ] **Step 2:** `Тестирование.md` ← FRONTEND_TEST_MATRIX + хвост FRONTEND_PROGRESS (что покрыто, чем гоняется, известные ямы прогонов).
- [ ] **Step 3:** `Дизайн-и-скин.md` ← 2026-08-19-prototype-skin-{design,plan,report} + skin-baseline + дизайн-часть FRONTEND_DECISIONS + конспект handoff'ов Smart Josparlau (с пометкой, что handoff описывает и удалённый «План дежурств»).
- [ ] **Step 4:** В `Frontend/Decisions.md` дописать раздел «Из FRONTEND_DECISIONS» (не-дизайн решения) и «Мок-контракт /api/ops/*» (из FRONTEND_MOCK_API_CONTRACT: истина — mocks/ops/ кода). В `Frontend/Known-Issues.md` — «Права ops.*: формат кодов фронта и сидов расходится (открытый вопрос)» из FRONTEND_ROLE_MATRIX.
- [ ] **Step 5:** `git rm -r docs/frontend/` (содержимое слито).
- [ ] **Step 6:** Проверка: `ls docs/frontend` — нет; три новых файла с frontmatter.
- [ ] **Step 7:** Commit `docs(vault): слияние docs/frontend в Frontend/ и удаление исходников`.

### Task 6: Archive-переезды

**Files:**
- Move: `_bmad-output/{planning-artifacts,implementation-artifacts}` → `obsidian-vault/Archive/bmad/`
- Move: `docs/PersonnelStatus/{ТЗ VAPS,PersonnelStatus,VisitX,brainstorming-session-2026-05-25-2256,PROJECT_DOCUMENTATION}.md`, `docs/TECHNICAL_AUDIT.md` → `obsidian-vault/Archive/docs-concepts/`
- Move: `docs/ops-backend-plan.md` → `obsidian-vault/Archive/ops-backend-plan.md`
- Move: `docs/superpowers/plans/2026-06-*.md` → `obsidian-vault/Archive/superpowers-plans/`
- Delete: `_bmad-output/story-automator/`, затем пустой `_bmad-output/`
- Modify: `obsidian-vault/Archive/README.md`

- [ ] **Step 1:** Перед архивированием ops-backend-plan: дописать в `Personnel-Records/Decisions.md` конспект «Карта групп /api/ops (A–N)» (какие группы, что закрыто срезами, открытые вопросы прав и ID-конвенции).
- [ ] **Step 2:** `git mv` все переезды; `git rm -r _bmad-output/story-automator`; убрать пустую папку.
- [ ] **Step 3:** Обновить `Archive/README.md`: разделы bmad/ (PRD от 10.06 целится в выведенный стек, стори-логи — история), docs-concepts/, ops-backend-plan, superpowers-plans; дата 2026-08-20.
- [ ] **Step 4:** Проверка: `git status` без потерянных файлов; `ls _bmad-output` — нет.
- [ ] **Step 5:** Commit `docs(vault): Archive — переезд BMAD, концептов, ops-плана`.

### Task 7: Удаления

**Files:**
- Delete: `docs.zip`, `_bmad-output.zip`, `graphify-out.zip`, `Smart Josparlau.zip`, `_COMMUNITY_Community 81.md`, `.ds-sync/storybook/SKILL.md`, `obsidian-vault/{VisitX,Accreditation}/`

- [ ] **Step 1:** Удалить zip'ы и пустышки (`rm` для untracked, `git rm` для tracked).
- [ ] **Step 2:** Проверка: файлов нет; git status чист от неожиданных удалений.
- [ ] **Step 3:** Commit `docs: чистка — zip-копии, пустышки, placeholder-разделы vault`.

### Task 8: Frontmatter существующего vault + 00-Index

**Files:**
- Modify: все `obsidian-vault/{Personnel-Records,Frontend,BMAD-Process,Infrastructure}/*.md`, `obsidian-vault/Archive/README.md`, `obsidian-vault/00-Index.md`

- [ ] **Step 1:** Скриптом добавить frontmatter (title = первая H1, module по папке, updated = дата последнего коммита файла, tags по типу) каждому md активных разделов, НЕ трогая содержимое; Archive/memory-snapshot не трогать.
- [ ] **Step 2:** Переписать `00-Index.md`: полная карта vault (Продукт с 19+3 доками, Требования, 4 активных раздела, Archive), строка «VisitX и Accreditation не начаты — разделы будут созданы при старте», wiki-ссылки на всё.
- [ ] **Step 3:** Проверка: `grep -rL '^---' obsidian-vault --include='*.md'` пуст вне Archive/memory-snapshot; каждая wiki-ссылка 00-Index указывает на существующий файл (python-проверка).
- [ ] **Step 4:** Commit `docs(vault): frontmatter повсюду + новый 00-Index`.

### Task 9: Верификация, леджер, финальный отчёт

- [ ] **Step 1:** Скрипт-проверка всех wiki-ссылок vault (python: собрать `[[target]]`, сверить с именами файлов; допущения — ссылки с `#` и `|`).
- [ ] **Step 2:** Обновить `Personnel-Records/Changelog.md` и `BMAD-Process/Changelog.md` (строка о консолидации, хэши), `CLAUDE.md` — убрать упоминание `_bmad-output` если есть, README — ссылка на vault.
- [ ] **Step 3:** Красная проба структуры: временно убрать один файл из Продукт/ → проверка ссылок должна покраснеть; вернуть.
- [ ] **Step 4:** Финальный коммит `docs(vault): консолидация документации — финал`; вывести пользователю отчёт: удалено / слито / переписано / дерево vault.
