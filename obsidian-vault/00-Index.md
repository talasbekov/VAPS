# VAPS — Второй мозг (Obsidian Vault)

Единственный источник правды по документации, знаниям, задачам и истории проекта VAPS
(Personnel Records, VisitX, Accreditation). Заменяет `.claude/memory` (auto-memory) и
`docs/api-gaps.md` для VAPS-специфичного контента — см. правила в корневом `CLAUDE.md`,
раздел «Obsidian vault». Начинай поиск контекста с этого файла.

## Структура

- `RAW/` — сырые, необработанные материалы: статьи, транскрипты встреч, черновики,
  клипы из веба. Ничего не удалять — только ссылаться после обработки.
- `WIKI/` — структурированные, связанные заметки по темам (продукт, предметная
  область, фичи, архитектура, исследования). Одна заметка — одна тема, с
  `[[wiki-ссылками]]` на связанные.
- `OUTPUT/` — готовые результаты: отчёты, планы, презентации, документы для
  внешнего использования.
- Папки модулей (оперативное состояние разработки, по 4 файла в каждой:
  Status / Changelog / Decisions / Known-Issues) — см. ниже.
- `Archive/` — снапшоты старых источников (заморожены на 2026-08-19).
- `LOG.md` — журнал: что и когда обработано в vault.
- `../Прототип/` — экспорт прототипа интерфейса, лежит в корне проекта вне
  хранилища (не трогать вручную, это выгрузка из дизайн-инструмента).

## Модули

- [[Personnel-Records/Status|Personnel Records]] — [[Personnel-Records/Changelog|Changelog]] · [[Personnel-Records/Decisions|Decisions]] · [[Personnel-Records/Known-Issues|Known Issues]]
- [[VisitX/Status|VisitX]] — [[VisitX/Changelog|Changelog]] · [[VisitX/Decisions|Decisions]] · [[VisitX/Known-Issues|Known Issues]]
- [[Accreditation/Status|Accreditation]] — [[Accreditation/Changelog|Changelog]] · [[Accreditation/Decisions|Decisions]] · [[Accreditation/Known-Issues|Known Issues]]
- [[Frontend/Status|Frontend]] — [[Frontend/Changelog|Changelog]] · [[Frontend/Decisions|Decisions]] · [[Frontend/Known-Issues|Known Issues]]
- [[Infrastructure/Status|Infrastructure]] — [[Infrastructure/Changelog|Changelog]] · [[Infrastructure/Decisions|Decisions]] · [[Infrastructure/Known-Issues|Known Issues]]
- [[BMAD-Process/Status|BMAD Process]] — [[BMAD-Process/Changelog|Changelog]] · [[BMAD-Process/Decisions|Decisions]] · [[BMAD-Process/Known-Issues|Known Issues]]

## Карта знаний (WIKI)

_Пока пусто — по мере появления заметок в `WIKI/` добавляй сюда ссылки по темам,
чтобы поиск контекста не требовал сканировать всё хранилище._

## Архив

- [[Archive/README|О снапшоте]] — копии старых источников на 2026-08-19.

## Правила для ИИ

1. Перед началом работы прочитай этот файл — это карта знаний, экономит токены.
   Перед работой над модулем — дополнительно `Status.md` + `Known-Issues.md` модуля.
2. Новый сырой материал в `RAW/` → прочитать → выделить ключевые мысли → создать/
   обновить связанные заметки в `WIKI/` → обновить карту знаний в этом файле →
   добавить запись в `LOG.md`.
3. Имена файлов: человекочитаемые заголовки без спецсимволов, на языке контента
   (обычно русский). Один файл — одна тема/сущность.
4. Связывай заметки через `[[Название заметки]]`. Избегай сирот: у каждой новой
   заметки минимум одна входящая или исходящая ссылка.
5. Не переписывай `RAW/` — это архив источников. Обработка создаёт новые файлы
   в `WIKI/`, а не изменяет сырьё.
6. После каждой значимой сессии работы с vault — короткая запись в `LOG.md`:
   `- [YYYY-MM-DD HH:MM] <что сделано, какие файлы затронуты>`.
7. Планы, эпики и техдокументацию по разработке оформляй в `WIKI/` (подпапки
   `WIKI/plans/`, `WIKI/epics/` при накоплении объёма) — не создавай параллельных
   хранилищ вне vault. Оперативное состояние разработки — только в папках модулей.
