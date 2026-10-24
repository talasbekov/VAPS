---
name: reference-memory-dir-location
description: "Каталог памяти физически живёт в /home/erda/Музыка/VAPS/.claude/memory (свой git-репо), харнесс-путь — симлинк на него; в историю VAPS память НЕ входит"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 2ea2c5e9-60e0-4c3f-8917-ede558ab9736
---

Перенесено 11.08.2026 по решению Bratan («перенеси память внутрь репо VAPS»):

- **Реальные файлы**: `/home/erda/Музыка/VAPS/.claude/memory/` — внутри дерева
  VAPS, но путь `.claude/` в `.gitignore` (строка 247), поэтому в историю VAPS
  память не попадает и `git status` её не видит.
- **Харнесс-путь** `/home/erda/.claude/projects/-home-erda--------VAPS/memory` —
  теперь СИМЛИНК на каталог выше. Писать можно по любому из путей.
- **Версионирование** — отдельный git-репозиторий прямо в каталоге памяти,
  первый коммит `ed5d714` (снимок 78 файлов). Коммитить правки памяти там же:
  `cd /home/erda/Музыка/VAPS/.claude/memory && git add -A && git commit`.

Почему не `docs/memory/` в истории VAPS: основной чекаут
`/home/erda/Музыка/VAPS` сидит на ветке `e3-catchup-clock-concurrency`, а работа
идёт из воркtree на `main` — коммит в main оставил бы симлинк битым до мержа, и
память ломалась бы от каждого переключения ветки. Текущая схема от веток и от
сноса воркtree независима (см. [[feedback-bmad-worktree-divergence]]).
