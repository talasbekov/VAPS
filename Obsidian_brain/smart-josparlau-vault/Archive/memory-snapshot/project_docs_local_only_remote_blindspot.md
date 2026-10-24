---
name: docs-local-only-remote-blindspot
description: docs/* и _bmad/ намеренно untracked с точечными исключениями — внешние агенты по tarball несут устаревшие представления о репо
metadata: 
  node_type: memory
  type: project
  originSessionId: ab84fe4c-2978-4a83-b0ce-ffb7380d31e4
  modified: 2026-07-27T08:11:17.312Z
---

`docs/*` в .gitignore (коммит 462a80c, «donor material / PII stays local»), исключения-негейты: `!docs/registries/`, `!docs/contracts/`, `!docs/frontend/`. RECONCILIATION.md, ПланРасстановка, VAPS_7.8.2 живут ТОЛЬКО локально; clone/tarball с remote их не содержит.

То же и с `_bmad/` (.gitignore:245) — папка игнорируется целиком, но ~72 файла трекаются force-add'ом. Санкционированная зона для своих файлов — `_bmad/custom/` (остальное управляется инсталлятором BMAD 6.8.0, `_bmad/_config/files-manifest.csv` хеширует 1669 файлов, обновление затрёт чужое). Новый файл там нужно класть через `git add -f`, иначе он невидим в клоне — так положены `_bmad/custom/config.toml` и `decomposition-rules.md` (правила декомпозиции стори, вынесены из CLAUDE.md 2026-07-27, коммит 57d5b17).

Следствие: внешний агент-пайплайн Бratan'а (Jules и др.), работающий по tarball с remote, несёт устаревшие/неполные представления о репо. Подтверждённые примеры (2026-07-27): «нулевые миграции во всех ветках» (на деле 17 файлов в core на E3-ветке, 18 на main, closed давно) и до-v2 иерархия документов «V78 §44–81 > PR» (RECONCILIATION v2 от 2026-06-10 по решению заказчика сделал PR master; правило 44–81>v7.5–7.7 — внутреннее для V7.8.2, не междокументное).

**Как применять:** претензию внешнего агента о состоянии репо сверять с локальным git, а не принимать на веру; не «чинить» отсутствие docs/ на remote коммитом их содержимого. Связано с [[two-machines-vaps]].
