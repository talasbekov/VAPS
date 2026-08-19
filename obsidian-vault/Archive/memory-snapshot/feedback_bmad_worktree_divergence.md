---
name: feedback_bmad_worktree_divergence
description: "Перед созданием BMAD-стори проверь, какой worktree/ветка реально несёт предшественников эпика — sprint-status расходится между worktree"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 0ea57482-7ddd-4274-a8f1-c42504b08555
---

VAPS ведётся в НЕСКОЛЬКИХ git worktree одновременно (`git worktree list`), и они сильно расходятся: один может стоять на E3, другой (куда story-automator пишет мейнлайн) — уже на E4/E5/E6/E8. У каждого свой `_bmad-output/implementation-artifacts/sprint-status.yaml` и свои story-файлы — они НЕ синхронизированы.

**Why:** В сессии 2026-07-09 меня попросили `/bmad-create-story 6.9` в worktree `reverent-dhawan` (E3-база, где E6-кода нет вообще). Реальная E6-линия (6.1–6.8 done) жила в соседнем worktree `exciting-vaughan`. Создание спеки на E3-базе дало бы стори, оторванную от несуществующего на той ветке фундамента.

**How to apply:** До написания стори — `git worktree list` + проверь, где лежат файлы стори-предшественников (`ls .../implementation-artifacts/<epic>-*.md`) и код эпика (нужные apps). Если текущий worktree отстаёт — спроси Bratan, где создавать (он выбрал писать в тот worktree, что несёт предшественников). Baseline-SHA бери из ТОГО worktree; учти, что реализация предыдущей стори может быть в рабочем дереве ещё НЕ закоммичена (её надо закоммитить перед dev-story и проставить SHA). Связано с [[project_two_machines]], [[project_bmad_story_cycle_flow]].

**Проверка одной командой** (эпик уже сделан на другой ветке?):
`for b in $(git branch --format='%(refname:short)'); do echo "$b: $(git show $b:_bmad-output/implementation-artifacts/sprint-status.yaml 2>/dev/null | grep -c '^  <epic>-.*: done')"; done`

**Повтор инцидента 2026-07-10:** story-automator запустил orchestration Epic 4 в worktree `trusting-borg-65b650` (ветка `claude/awesome-jemison-1319e0`, база = хвост E3). Но E4 (4.1–4.7 + ретро), E5 и E8 уже закрыты на `e3-catchup-clock-concurrency` — ветке ГЛАВНОЙ рабочей копии `/home/erda/Музыка/VAPS`. Автоматор строит очередь из `sprint-status.yaml` СВОЕЙ ветки и поэтому не видит чужую работу — он молча переписал бы закрытый эпик. Стори 4.1 не была пересоздана: вместо этого артефакт портирован из `4bdea8e` со СТОП-шапкой, `sprint-status` намеренно НЕ тронут (флип в `ready-for-dev` = спусковой крючок для dev-агента).

**Повтор инцидента 2026-07-20 — ЭПИК НАПИСАН ДВАЖДЫ:** Epic 10 (10.2–10.10) реализован полностью и НЕЗАВИСИМО на двух ветках: `claude/hungry-leavitt-78b450` (15–17 июля, запушена на origin, + 10.1b prefill-GET) и `claude/vigilant-sutherland-fddc31` (19–20 июля, + весь Epic 11 + ретро E10/E11). Сессия в третьем worktree чуть не начала create-story 10.2 в ТРЕТИЙ раз — sprint-status её ветки показывал 10.2 backlog. Разрешение: vigilant = канон (свежее, полнее, память ссылается на его инциденты), срез-ветка `claude/e10-e11-mainline` → PR #15 в main; hungry-leavitt = superseded, НЕ мержить (но её prefill-GET — референс для будущей 10-1b). Урок: перед create-story проверять не только предшественников СВОЕЙ ветки, но и `git log --all -- '*implementation-artifacts/<эпик>-*'` — не написан ли эпик уже где-то целиком. PR со среза-ветки (branch на SHA), а не с живой ветки: в её worktree другая сессия уже копила незакоммиченный E12.

**Повтор инцидента 2026-07-28 — РАБОТА ПОВЕРХ УСТАРЕВШЕГО main:** сессия в worktree `busy-almeida-b520b8` (ветка от `main`) построила «Этап 8» Smart Josparlau (календарь смен + назначение с 409-обходом) и закоммитила `c11a52e`, НЕ проверив, что `claude/gifted-hertz-ebe729` ушла на 51 коммит вперёд `main` и уже несёт `CreateDutyShiftForm` с ConflictDialog, `MonthlyDutyPlanSection` («сотрудник × день»), `app/CalendarPage.tsx` (§25) и свои A44–A46 (номера решений столкнулись!). PR #16 создавал ложное впечатление, что ветка влита целиком — влит был только её ранний срез. Разрешение: Bratan выбрал сначала влить живую ветку в `main` (`4339962`, merge чистый, без конфликтов), `c11a52e` признан superseded. Урок: `main` в VAPS — НЕ актуальная база; перед первой строкой кода `git branch -a` + `git rev-list --count main..<каждая живая ветка>` и грепнуть целевую фичу по веткам (`git ls-tree -r --name-only <ветка> -- <путь фичи>`), а не только по своему рабочему дереву.

**Два следствия, которые повторятся:**
- Коммиты E4 бандловые: `4bdea8e` содержит стори 4.1+4.2+4.3+4.4 сразу — изолированного «коммита одной стори» нет, cherry-pick одной стори невозможен.
- `docs/PersonnelStatus/VAPS_7.8.2.md` (авторитетный DDL, на который ссылаются References стори) НЕ закоммичен в git → в любом worktree, кроме главного, он физически отсутствует и ссылки в стори не разыменовываются. См. [[project_two_machines]].
