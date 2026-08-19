---
name: bmad-customization-surface
description: "Как врезать проектное правило в BMAD-воркфлоу, не правя скилл — _bmad/custom/<skill>.toml"
metadata: 
  node_type: memory
  type: project
  originSessionId: c3c37f8d-4dbb-409d-8dd2-febdc622077a
---

Скиллы BMAD в `.claude/skills/bmad-*/` — install-контент (манифест 6.8.0, `_bmad/_config/files-manifest.csv` хеширует 1669 файлов); их `customize.toml` начинается с «DO NOT EDIT -- overwritten on every update». Править SKILL.md / checklist.md / steps/*.md бесполезно — обновление затрёт.

Санкционированная точка врезки — `_bmad/custom/<skill-name>.toml` (team, коммитится) и `<skill-name>.user.toml` (личный, gitignored). Резолвер `_bmad/scripts/resolve_customization.py` мержит три слоя; **массивы append**, скаляры override, удалить дефолт нельзя. Ключи в `[workflow]`:

- `persistent_facts` — грузятся в контекст на активации; запись вида `file:{project-root}/путь.md` подгружает содержимое файла как факты. Так правило попадает в контекст безусловно, а не по решению агента.
- `activation_steps_append` — инструкции, исполняемые до начала воркфлоу; сюда кладётся сам гейт.
- `on_complete` — скаляр, выполняется ПОСЛЕ сохранения (для блокировки поздно).

Проверять врезку так: `python3 _bmad/scripts/resolve_customization.py --skill "$PWD/.claude/skills/<skill>" --key workflow.persistent_facts --key workflow.activation_steps_append` — запись должна появиться в merged-выводе; плюс грепнуть SKILL.md целевого скилла, что он вообще исполняет эти ключи на активации (create-story и create-epics-and-stories — исполняют).

**Как применять:** гейт вешать на существующий чекпойнт воркфлоу, до необратимого шага (create-story Step 6 — до сохранения файла и правки sprint-status.yaml; create-epics Step 4 — до меню `[C] Complete`), и требовать построчного PASS/FAIL с подтверждением, иначе получится нудж — см. [[action-item-trigger-gate]] и [[dev-checkbox-drift]]. Живой пример: правила декомпозиции стори, коммит 980c878. Файлы в `_bmad/custom/` добавлять через `git add -f` — см. [[docs-local-only-remote-blindspot]].

**Проверено в бою 2026-07-27 (ветка claude/goofy-cartwright-e40826):** гейт декомпозиции сработал на первом же живом прогоне create-story и РЕАЛЬНО заблокировал сохранение — стори `10-1b-get-статусов-на-дату-и-справочник` завалена по трём критериям (два эндпоинта в одной стори; 9 файлов при потолке 5), разрезана на 4 ключа (10.1b/10.1d бэк + 10.1e/10.1f фронт). То есть конструкция даёт именно блокировку, а не нудж. Два условия, без которых это не сработало бы: (1) требование построчного PASS/FAIL с подтверждением фактом (число файлов, перечень эндпоинтов), (2) пункт «пустая секция Files To Create/Modify = FAIL, а не N/A» — без него проверка «не более 5 файлов» вакуумна. Побочно всплыло ограничение автодискавери: create-story берёт первую backlog-стори сверху вниз, поэтому заблокированный эпик приходится физически выносить вниз файла (коммит 73ea5ac), статуса `blocked` в закрытом списке bmad-sprint-status нет.
