# Obsidian Vault Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `obsidian-vault/` as the single source of truth for VAPS documentation/history, populated from the full git log, `.claude/memory` (auto-memory, 120 files at `/home/erda/.claude/projects/-home-erda--------VAPS/memory/`), and `docs/api-gaps.md`; then rewire root `CLAUDE.md` so future sessions read/write only through the vault.

**Architecture:** A scripted extraction turns `git log` into per-module `Changelog.md` files (mechanical, no prose per commit). Separately, the 120 memory files and the 976-line `docs/api-gaps.md` ledger are read and distributed by hand/subagent into per-module `Status.md` / `Decisions.md` / `Known-Issues.md`, converting `[[slug]]` references into real Obsidian wikilinks. Old sources are archived, not deleted.

**Tech Stack:** Bash (git log parsing script), Markdown (Obsidian-flavored, `[[wikilinks]]`).

## Global Constraints

- Vault lives at `docs/superpowers/specs/2026-08-19-obsidian-vault-design.md`'s approved location: `obsidian-vault/` at repo root (per spec).
- Module folders are exactly: `Personnel-Records`, `VisitX`, `Accreditation`, `Frontend`, `Infrastructure`, `BMAD-Process` (per spec) plus `Archive/`.
- Do not delete `.claude/memory/*.md` (actually at `/home/erda/.claude/projects/-home-erda--------VAPS/memory/`) or `docs/api-gaps.md` — copy into `Archive/`, leave originals in place.
- No note per individual commit — history goes into `Changelog.md` as one line per commit (date, short hash, subject).
- `obsidian-vault/` is a normal git-tracked folder (not under the `docs/` gitignore rule) — verify it is NOT ignored before committing (the repo ignores `docs/superpowers` and other `docs/` subpaths per project convention; `obsidian-vault/` is a top-level sibling, not under `docs/`).

---

### Task 1: Scaffold vault skeleton

**Files:**
- Create: `obsidian-vault/00-Index.md`
- Create: `obsidian-vault/Personnel-Records/Status.md`
- Create: `obsidian-vault/Personnel-Records/Changelog.md`
- Create: `obsidian-vault/Personnel-Records/Decisions.md`
- Create: `obsidian-vault/Personnel-Records/Known-Issues.md`
- Create: `obsidian-vault/VisitX/Status.md`
- Create: `obsidian-vault/VisitX/Changelog.md`
- Create: `obsidian-vault/VisitX/Decisions.md`
- Create: `obsidian-vault/VisitX/Known-Issues.md`
- Create: `obsidian-vault/Accreditation/Status.md`
- Create: `obsidian-vault/Accreditation/Changelog.md`
- Create: `obsidian-vault/Accreditation/Decisions.md`
- Create: `obsidian-vault/Accreditation/Known-Issues.md`
- Create: `obsidian-vault/Frontend/Status.md`
- Create: `obsidian-vault/Frontend/Changelog.md`
- Create: `obsidian-vault/Frontend/Decisions.md`
- Create: `obsidian-vault/Frontend/Known-Issues.md`
- Create: `obsidian-vault/Infrastructure/Status.md`
- Create: `obsidian-vault/Infrastructure/Changelog.md`
- Create: `obsidian-vault/Infrastructure/Decisions.md`
- Create: `obsidian-vault/Infrastructure/Known-Issues.md`
- Create: `obsidian-vault/BMAD-Process/Status.md`
- Create: `obsidian-vault/BMAD-Process/Changelog.md`
- Create: `obsidian-vault/BMAD-Process/Decisions.md`
- Create: `obsidian-vault/BMAD-Process/Known-Issues.md`
- Create: `obsidian-vault/Archive/.gitkeep`

**Interfaces:**
- Produces: the exact file set every later task writes into. Every `Changelog.md`/`Status.md`/`Decisions.md`/`Known-Issues.md` below starts with the header template shown in Step 1 — later tasks append below the header, they do not replace it.

- [ ] **Step 1: Create each module file with a standard header**

For each of the 6 modules (`Personnel-Records`, `VisitX`, `Accreditation`, `Frontend`, `Infrastructure`, `BMAD-Process`), create 4 files with this content pattern (example for `Personnel-Records/Status.md`):

```markdown
# Personnel-Records — Status

_Обновляется по ходу работы. См. также [[Changelog]], [[Decisions]], [[Known-Issues]]._

(наполняется в задаче миграции)
```

```markdown
# Personnel-Records — Changelog

_Одна строка на коммит: дата, короткий хэш, сообщение. Сгенерировано скриптом из git log, дополняется вручную по ходу будущей работы._

(наполняется скриптом в Задаче 2)
```

```markdown
# Personnel-Records — Decisions

_Архитектурные решения и уроки (перенесено из auto-memory)._

(наполняется в задаче миграции памяти)
```

```markdown
# Personnel-Records — Known Issues

_Открытые дефекты (перенесено из docs/api-gaps.md)._

(наполняется в задаче миграции леджера)
```

Repeat verbatim (swapping the module name in the H1 and prose) for `VisitX`, `Accreditation`, `Frontend`, `Infrastructure`, `BMAD-Process`.

- [ ] **Step 2: Create the archive placeholder**

```bash
mkdir -p obsidian-vault/Archive/memory-snapshot
touch obsidian-vault/Archive/.gitkeep
```

- [ ] **Step 3: Verify structure**

Run: `find obsidian-vault -type f | sort`
Expected: 25 files (24 module files + `00-Index.md`; `Archive/.gitkeep` makes 26) — count and confirm every module has exactly 4 files plus the top-level index.

- [ ] **Step 4: Commit**

```bash
git add obsidian-vault/
git commit -m "chore(obsidian): scaffold vault skeleton for VAPS documentation"
```

---

### Task 2: Generate per-module Changelog from git log

**Files:**
- Create: `scripts/obsidian/generate_changelog.sh`
- Modify: `obsidian-vault/Personnel-Records/Changelog.md`
- Modify: `obsidian-vault/VisitX/Changelog.md`
- Modify: `obsidian-vault/Accreditation/Changelog.md`
- Modify: `obsidian-vault/Frontend/Changelog.md`
- Modify: `obsidian-vault/Infrastructure/Changelog.md`
- Modify: `obsidian-vault/BMAD-Process/Changelog.md`

**Interfaces:**
- Consumes: `obsidian-vault/<Module>/Changelog.md` headers from Task 1 (script appends after existing content, does not overwrite the header).
- Produces: fully populated Changelog files that Task 9 (index) and future sessions link to and append to.

- [ ] **Step 1: Write the classification script**

```bash
#!/usr/bin/env bash
# scripts/obsidian/generate_changelog.sh
# Classifies every commit in git log by top-level path touched, appends
# one line per commit to the matching module's obsidian-vault Changelog.md.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

declare -A SEEN  # "<hash>|<module>" -> 1, avoids duplicate lines if git log repeats a hash

classify_path() {
  case "$1" in
    Backend/PersonnelStatus*|Backend/VAPS*) echo "Personnel-Records" ;;
    frontend*|"Smart Josparlau"*|"Прототип"*|ds-bundle*) echo "Frontend" ;;
    _bmad*|_bmad-output*) echo "BMAD-Process" ;;
    *) echo "Infrastructure" ;;
  esac
}

# tmp buffers, one per module, so we can sort/write once at the end
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
for m in Personnel-Records VisitX Accreditation Frontend Infrastructure BMAD-Process; do
  : > "$TMP_DIR/$m.txt"
done

git log --reverse --pretty=format:'%H|%ad|%s' --date=short | while IFS='|' read -r hash date subject; do
  short="${hash:0:8}"
  modules_for_commit=""
  while IFS= read -r path; do
    [ -z "$path" ] && continue
    top="${path%%/*}"
    mod=$(classify_path "$top/")
    key="$hash|$mod"
    if [ -z "${SEEN[$key]:-}" ]; then
      SEEN[$key]=1
      echo "- $date \`$short\` $subject" >> "$TMP_DIR/$mod.txt"
    fi
  done < <(git show --name-only --pretty=format: "$hash")
done

for m in Personnel-Records VisitX Accreditation Frontend Infrastructure BMAD-Process; do
  target="obsidian-vault/$m/Changelog.md"
  if [ -s "$TMP_DIR/$m.txt" ]; then
    {
      echo ""
      echo "## История (git log)"
      echo ""
      cat "$TMP_DIR/$m.txt"
    } >> "$target"
  else
    {
      echo ""
      echo "## История (git log)"
      echo ""
      echo "_Коммитов, задевающих этот модуль, пока не найдено._"
    } >> "$target"
  fi
done

echo "Done. Line counts:"
for m in Personnel-Records VisitX Accreditation Frontend Infrastructure BMAD-Process; do
  echo "  $m: $(wc -l < "obsidian-vault/$m/Changelog.md")"
done
```

> Note: the `while ... | while read` subshell with an associative array (`SEEN`) works because bash 4+ associative arrays are process-local but the outer `while read` here is NOT itself in a pipeline subshell (the `git log | while read` IS a pipe, which puts `SEEN` updates in a subshell — verify in Step 3 below that dedup still behaves acceptably; a fully commit-unique file→module attribution is not required by the spec, only "no note per commit" and "history preserved", so cross-module duplication if `SEEN` doesn't persist is harmless, just slightly redundant).

- [ ] **Step 2: Make it executable and run it**

```bash
chmod +x scripts/obsidian/generate_changelog.sh
./scripts/obsidian/generate_changelog.sh
```

Expected output: a line count per module, all 6 modules present, `Personnel-Records` and `Infrastructure` should have the largest counts (matches the top-level dir tally: `Backend` 1216 file-touches, catch-all `Infrastructure` covering `.claude`/`.agents`/`graphify-out`/`_bmad-output`/`docs`/`spikes`/etc.).

- [ ] **Step 3: Spot-check output**

```bash
head -20 obsidian-vault/Personnel-Records/Changelog.md
head -20 obsidian-vault/Frontend/Changelog.md
grep -c '^- ' obsidian-vault/BMAD-Process/Changelog.md
```

Expected: each file has real commit lines (date, hash, subject) below the header, not empty placeholders. `BMAD-Process` count should be > 0 (there are `_bmad`/`_bmad-output` commits in history).

- [ ] **Step 4: Commit**

```bash
git add -f scripts/obsidian/generate_changelog.sh obsidian-vault/*/Changelog.md
git commit -m "feat(obsidian): generate per-module changelogs from full git log"
```

---

### Task 3: Migrate auto-memory → Personnel-Records

**Files:**
- Read: all files under `/home/erda/.claude/projects/-home-erda--------VAPS/memory/` whose content concerns Personnel-Records/statuses/employees/e2e for that module (use `MEMORY.md` index in that directory to identify candidates — e.g. entries mentioning `one_active_status_invariant`, `pr_status_save_calls_full_clean`, `employee_default_status_invariant`, `frozen_clock`, `label_substring`, `date_guard`, `narrow_projection`, `order_assert`, `permission_needs_a_persona`, `redact_derived_fields`, `stage_fixture_accumulates`, `namespace_pkg_breaks_pytest`, `vaultx_vacuous_optional_chain_assert` if PR-specific, etc. — read `MEMORY.md` first and judge by description, not by guessing from this list alone).
- Modify: `obsidian-vault/Personnel-Records/Decisions.md`
- Modify: `obsidian-vault/Personnel-Records/Known-Issues.md`
- Modify: `obsidian-vault/Personnel-Records/Status.md`

**Interfaces:**
- Consumes: header templates from Task 1.
- Produces: `[[Decisions#<anchor>]]`-style headings other modules' notes can link to later (Task 9 index links to these files by path, not by anchor, so exact anchor text is not load-bearing for other tasks).

- [ ] **Step 1: Read the memory index**

```bash
cat /home/erda/.claude/projects/-home-erda--------VAPS/memory/MEMORY.md
```

Identify every entry whose `description` concerns Personnel Records backend/frontend (statuses, employees, staff units, e2e for PersonalRecordFront, DB constraints, org structure). Skip entries about VAPS-wide process (BMAD, worktrees, ruff, memory location itself) — those go in Task 5/6.

- [ ] **Step 2: Read each identified file and transcribe**

For each candidate file (e.g. `project_one_active_status_invariant.md`), `Read` it in full. Append to `Decisions.md` under a `## <Title from frontmatter description>` heading, preserving the **Why:**/**How to apply:** structure verbatim. If the memory type is `feedback` about a defect/gap that's still open, put it in `Known-Issues.md` instead; if it describes current module state (e.g. "раздел живой по умолчанию"), summarize it into `Status.md`.

Convert every `[[slug]]` reference found in the body to `[[Decisions#<matching heading title>]]` if the target was migrated into this same file, or to `[[../<OtherModule>/Decisions#...]]` if the referenced memory was classified into a different module in a later task — leave a plain-text `TODO-LINK: <slug>` inline comment for any reference whose target module isn't decided yet, and resolve those in Task 9.

- [ ] **Step 3: Verify no content lost**

```bash
grep -c '^## ' obsidian-vault/Personnel-Records/Decisions.md
grep -c '^## ' obsidian-vault/Personnel-Records/Known-Issues.md
```

Expected: combined heading count roughly matches the number of memory files you identified as Personnel-Records-relevant in Step 1 (spot-check by listing which slugs you migrated vs. your Step 1 list).

- [ ] **Step 4: Commit**

```bash
git add -f obsidian-vault/Personnel-Records/
git commit -m "docs(obsidian): migrate Personnel-Records memory into vault"
```

---

### Task 4: Migrate auto-memory → Frontend

**Files:**
- Read: memory files concerning `frontend/`, `PersonalRecordFront`, Smart Josparlau prototype, WS testing, MSW, Playwright/e2e UI behavior (e.g. `msw_pattern_needs_wildcard_origin`, `msw_path_collision_silent`, `blank_tab_loses_credential`, `next_dev_shared_build_cache`, `next_build_poisons_dev_cache`, `sr_only_skiplink_swallows_corner_click`, `click_before_hydration_is_browser_nav`, `rhf_error_order_is_not_schema_order`, `tab_layout_unmounts_draft`, `remount_key_on_data_version`, `dead_control_needs_owner_component`, `role_status_breaks_page_asserts`, `frontend_audit_2026_08_17`, `smart_josparlau_frontend_state`, `prototype_source_of_truth`, `prototype_walkthrough_progress`, `ugly_ui_may_be_missing_data`).
- Modify: `obsidian-vault/Frontend/Decisions.md`
- Modify: `obsidian-vault/Frontend/Known-Issues.md`
- Modify: `obsidian-vault/Frontend/Status.md`

**Interfaces:**
- Same conventions as Task 3 (heading-per-memory, Why/How to apply preserved, `[[wikilink]]` conversion, `TODO-LINK:` for cross-module refs not yet resolved).

- [ ] **Step 1: Read the memory index and select Frontend-relevant entries** (same method as Task 3 Step 1, scoped to frontend concerns)

- [ ] **Step 2: Transcribe each into Decisions/Known-Issues/Status** (same method as Task 3 Step 2)

- [ ] **Step 3: Verify no content lost** (same method as Task 3 Step 3, applied to Frontend files)

- [ ] **Step 4: Commit**

```bash
git add -f obsidian-vault/Frontend/
git commit -m "docs(obsidian): migrate Frontend memory into vault"
```

---

### Task 5: Migrate auto-memory → BMAD-Process

**Files:**
- Read: memory files about BMAD story cycle, epics, worktree divergence, story file editing, sprint/checkbox drift, story-automator, customization surface (e.g. `bmad_story_cycle_flow`, `bmad_worktree_divergence`, `story_file_edit_safety`, `dev_checkbox_drift`, `bmad_customization_surface`, `action_item_trigger_gate`, `parallel_story_commit_sweep`).
- Modify: `obsidian-vault/BMAD-Process/Decisions.md`
- Modify: `obsidian-vault/BMAD-Process/Known-Issues.md`
- Modify: `obsidian-vault/BMAD-Process/Status.md`

**Interfaces:**
- Same conventions as Task 3.

- [ ] **Step 1: Read the memory index and select BMAD-Process-relevant entries**

- [ ] **Step 2: Transcribe each into Decisions/Known-Issues/Status**

- [ ] **Step 3: Verify no content lost** (heading count check, as in Task 3 Step 3)

- [ ] **Step 4: Commit**

```bash
git add -f obsidian-vault/BMAD-Process/
git commit -m "docs(obsidian): migrate BMAD-Process memory into vault"
```

---

### Task 6: Migrate remaining auto-memory → Infrastructure, VisitX, Accreditation

**Files:**
- Read: every memory file NOT already migrated in Tasks 3–5 (two-machine setup, docker port collisions, Postgres connection exhaustion, test DB collisions, graphify graph state, skills install gotchas, solo-developer/challenge-premises/pace-over-ceremony user & feedback memories, reference memories about where things live, GVO registry module, `/ops` wiring, native port progress, core port progress, full review 2026-08-08, stand raise gotchas, etc.).
- Modify: `obsidian-vault/Infrastructure/Decisions.md`
- Modify: `obsidian-vault/Infrastructure/Known-Issues.md`
- Modify: `obsidian-vault/Infrastructure/Status.md`
- Modify: `obsidian-vault/VisitX/Status.md`
- Modify: `obsidian-vault/Accreditation/Status.md`

**Interfaces:**
- Same conventions as Task 3.
- `VisitX`/`Accreditation` likely receive no memory content (no VisitX/Accreditation-specific work has happened yet per `project_gvo_registry_module` and `project_reports_expense_aggregator`) — if so, write one line into each `Status.md`: `_Модуль не начат: код и память отсутствуют по состоянию на 2026-08-19._` — this is a real status statement, not a placeholder.

- [ ] **Step 1: Read the memory index; everything not yet claimed by Tasks 3–5 goes here by default**

Cross-check: list every memory filename from `MEMORY.md`, mark off the ones already handled in Task 3 and Task 4 and Task 5, the remainder is this task's input list.

- [ ] **Step 2: Transcribe user/feedback/project/reference memories into Infrastructure's three files** — `user`-type entries (e.g. "solo developer on VAPS") go into `Decisions.md` under a `## Как работает разработчик` heading since they shape how future sessions should collaborate, not a defect or a status fact.

- [ ] **Step 3: Write VisitX/Accreditation Status.md** per the fallback line above, or with real content if any memory turned out to be VisitX/Accreditation-specific.

- [ ] **Step 4: Verify total migrated count matches memory file count**

```bash
total=$(grep -c '^## ' obsidian-vault/*/Decisions.md obsidian-vault/*/Known-Issues.md | awk -F: '{s+=$2} END{print s}')
echo "$total"
```

Expected: `total` should be close to 120 (the full memory file count) — some memory entries may have been folded into a `Status.md` prose paragraph instead of a `## ` heading, so an exact match isn't required, but a number far below 100 means entries were skipped; go back and account for the gap.

- [ ] **Step 5: Commit**

```bash
git add -f obsidian-vault/Infrastructure/ obsidian-vault/VisitX/ obsidian-vault/Accreditation/
git commit -m "docs(obsidian): migrate remaining memory into Infrastructure/VisitX/Accreditation"
```

---

### Task 7: Migrate docs/api-gaps.md into Known-Issues

**Files:**
- Read: `docs/api-gaps.md` (976 lines)
- Modify: `obsidian-vault/Personnel-Records/Known-Issues.md`
- Modify: `obsidian-vault/Frontend/Known-Issues.md`
- Modify: `obsidian-vault/Infrastructure/Known-Issues.md`
- Modify: `obsidian-vault/BMAD-Process/Known-Issues.md`

**Interfaces:**
- Consumes: same file convention as Tasks 3–6 (append under `## ` headings).

- [ ] **Step 1: Read `docs/api-gaps.md` in full and identify each distinct defect/gap entry** (the ledger is organized by date/section per `reference_vaps_docs_ledger_location` memory — read that memory file too if unclear on the ledger's internal structure).

- [ ] **Step 2: For each entry, append it under the matching module's `Known-Issues.md`** using the same heading convention as Task 3 (`## <short title>`, then the entry's own date/description/status verbatim).

- [ ] **Step 3: Verify entry count preserved**

```bash
grep -c '^##' docs/api-gaps.md
grep -c '^## ' obsidian-vault/*/Known-Issues.md
```

Compare the ledger's own heading count against the sum added across the four `Known-Issues.md` files (subtract the counts already present after Tasks 3–6, i.e. record the "before" count first, then diff).

- [ ] **Step 4: Commit**

```bash
git add -f obsidian-vault/*/Known-Issues.md
git commit -m "docs(obsidian): migrate docs/api-gaps.md ledger into vault Known-Issues"
```

---

### Task 8: Archive old sources

**Files:**
- Create: `obsidian-vault/Archive/memory-snapshot/` (copies of all 120 files)
- Create: `obsidian-vault/Archive/api-gaps-snapshot.md`
- Create: `obsidian-vault/Archive/README.md`

**Interfaces:**
- Produces: a frozen record referenced by `00-Index.md` in Task 9.

- [ ] **Step 1: Copy memory files**

```bash
cp /home/erda/.claude/projects/-home-erda--------VAPS/memory/*.md obsidian-vault/Archive/memory-snapshot/
```

- [ ] **Step 2: Copy the ledger**

```bash
cp docs/api-gaps.md obsidian-vault/Archive/api-gaps-snapshot.md
```

- [ ] **Step 3: Write the archive README**

```markdown
# Archive

Снапшот старых источников документации на момент миграции в Obsidian vault (2026-08-19).

- `memory-snapshot/` — копия `/home/erda/.claude/projects/-home-erda--------VAPS/memory/*.md` (120 файлов) на дату миграции. Оригиналы НЕ удалены и харнесс может продолжать писать в них общие (не VAPS-специфичные) записи — см. корневой `CLAUDE.md`.
- `api-gaps-snapshot.md` — копия `docs/api-gaps.md` (976 строк) на дату миграции. Оригинал НЕ удалён, но новые записи в него больше не добавляются — см. соответствующие `Known-Issues.md` по модулям.

Это архив, не источник правды. Актуальное состояние — в `Status.md`/`Decisions.md`/`Known-Issues.md` каждого модуля.
```

- [ ] **Step 4: Verify**

```bash
ls obsidian-vault/Archive/memory-snapshot/*.md | wc -l
```

Expected: `120`.

- [ ] **Step 5: Commit**

```bash
git add -f obsidian-vault/Archive/
git commit -m "docs(obsidian): archive frozen snapshot of memory and api-gaps ledger"
```

---

### Task 9: Write the top-level index and resolve cross-module TODO-LINKs

**Files:**
- Modify: `obsidian-vault/00-Index.md`
- Modify: any file containing a `TODO-LINK:` marker left by Tasks 3–6

**Interfaces:**
- Consumes: final file layout from Tasks 1–8.

- [ ] **Step 1: Find remaining TODO-LINK markers**

```bash
grep -rn 'TODO-LINK:' obsidian-vault/
```

For each, determine which module the referenced slug ended up in (search `obsidian-vault/*/Decisions.md obsidian-vault/*/Known-Issues.md` for a matching `## ` heading) and replace the marker with a real `[[../<Module>/Decisions#<heading>]]` or `[[../<Module>/Known-Issues#<heading>]]` link.

- [ ] **Step 2: Write `00-Index.md`**

```markdown
# VAPS — Obsidian Vault Index

Единственный источник правды по документации, задачам и истории проекта VAPS. Заменяет `.claude/memory` (auto-memory) и `docs/api-gaps.md` для VAPS-специфичного контента — см. правила в корневом `CLAUDE.md`, раздел «Obsidian vault».

## Модули

- [[Personnel-Records/Status|Personnel Records]] — [[Personnel-Records/Changelog|Changelog]] · [[Personnel-Records/Decisions|Decisions]] · [[Personnel-Records/Known-Issues|Known Issues]]
- [[VisitX/Status|VisitX]] — [[VisitX/Changelog|Changelog]] · [[VisitX/Decisions|Decisions]] · [[VisitX/Known-Issues|Known Issues]]
- [[Accreditation/Status|Accreditation]] — [[Accreditation/Changelog|Changelog]] · [[Accreditation/Decisions|Decisions]] · [[Accreditation/Known-Issues|Known Issues]]
- [[Frontend/Status|Frontend]] — [[Frontend/Changelog|Changelog]] · [[Frontend/Decisions|Decisions]] · [[Frontend/Known-Issues|Known Issues]]
- [[Infrastructure/Status|Infrastructure]] — [[Infrastructure/Changelog|Changelog]] · [[Infrastructure/Decisions|Decisions]] · [[Infrastructure/Known-Issues|Known Issues]]
- [[BMAD-Process/Status|BMAD Process]] — [[BMAD-Process/Changelog|Changelog]] · [[BMAD-Process/Decisions|Decisions]] · [[BMAD-Process/Known-Issues|Known Issues]]

## Архив

- [[Archive/README|О снапшоте]] — копии старых источников на 2026-08-19.

## Как пользоваться (для Claude Code)

См. корневой `CLAUDE.md`, раздел «Obsidian vault»: перед началом работы читать `Status.md`+`Known-Issues.md` модуля, после — обновлять `Status.md`/`Changelog.md`/`Decisions.md`/`Known-Issues.md`.
```

- [ ] **Step 3: Verify all wikilinks resolve to real files**

```bash
grep -oE '\[\[[^]]+\]\]' obsidian-vault/00-Index.md | sed -E 's/\[\[([^|]+).*/\1/' | while read -r target; do
  f="obsidian-vault/${target}.md"
  [ -f "$f" ] || echo "BROKEN: $target"
done
```

Expected: no `BROKEN:` lines printed.

- [ ] **Step 4: Commit**

```bash
git add -f obsidian-vault/
git commit -m "docs(obsidian): write vault index, resolve cross-module links"
```

---

### Task 10: Update root CLAUDE.md with the vault-first algorithm

**Files:**
- Modify: `CLAUDE.md` (repo root)

**Interfaces:**
- Consumes: `obsidian-vault/` layout as finalized by Task 9 — this section names exact paths, so it must be written last.

- [ ] **Step 1: Add a new top-level section to `CLAUDE.md`**

Insert (near the top, after the `## Project` section, so it's seen early) — read the current file first to place it without breaking existing structure, then add:

```markdown
## Obsidian vault — единственный источник правды

Вся документация, статус, история и открытые дефекты проекта VAPS ведутся в `obsidian-vault/` (открывается как обычный Obsidian vault — папка markdown-файлов, без live-коннектора). Точка входа: `obsidian-vault/00-Index.md`.

Правила для Claude Code:

- **Перед началом работы** над модулем (Personnel-Records / VisitX / Accreditation / Frontend / Infrastructure / BMAD-Process) — прочитать `obsidian-vault/<Модуль>/Status.md` и `obsidian-vault/<Модуль>/Known-Issues.md`.
- **После завершения работы** — обновить `Status.md` (если сменилось состояние модуля), добавить строку в `Changelog.md` (дата, что сделано, короткий хэш коммита), и `Decisions.md`/`Known-Issues.md` при необходимости.
- **Не заводить** новые записи в `.claude/memory` (auto-memory) или `docs/api-gaps.md` для VAPS-специфичного контента — только в vault. Auto-memory может продолжать накапливать записи только НЕ специфичные для VAPS (например, про личность/стиль работы разработчика в целом), если харнесс сам их предлагает.
- `docs/api-gaps.md` и старая `.claude/memory` заморожены на 2026-08-19 — актуальные версии их содержимого перенесены в `obsidian-vault/*/Known-Issues.md` и `obsidian-vault/*/Decisions.md`; снапшот на дату заморозки лежит в `obsidian-vault/Archive/`.
```

- [ ] **Step 2: Verify the section reads correctly in context**

```bash
grep -n "Obsidian vault" CLAUDE.md
```

Expected: one match, section present.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): route future work through obsidian-vault as source of truth"
```

---

### Task 11: Final verification pass

**Files:**
- Read: all of `obsidian-vault/`

**Interfaces:**
- Consumes: everything from Tasks 1–10. Final gate before calling the migration done.

- [ ] **Step 1: Confirm no stray TODO-LINK or placeholder text remains**

```bash
grep -rn 'TODO-LINK:\|наполняется в задаче\|наполняется скриптом' obsidian-vault/
```

Expected: no output (every placeholder from Task 1 headers has been overwritten by real content in Tasks 2–9).

- [ ] **Step 2: Confirm every module has non-trivial content**

```bash
for f in obsidian-vault/*/Status.md obsidian-vault/*/Changelog.md obsidian-vault/*/Decisions.md obsidian-vault/*/Known-Issues.md; do
  echo "$f: $(wc -l < "$f") lines"
done
```

Expected: `VisitX`/`Accreditation` `Decisions.md`/`Known-Issues.md` may legitimately be near-empty (module not started); every other file should have real content.

- [ ] **Step 3: Confirm `git status` is clean and the vault is tracked**

```bash
git status --short
git ls-files obsidian-vault/ | wc -l
```

Expected: clean working tree, `obsidian-vault/` file count matches what was created across Tasks 1–9 (26 skeleton files + `scripts/obsidian/generate_changelog.sh` is outside the vault + Archive snapshot files).

- [ ] **Step 4: Final commit if anything was left uncommitted**

```bash
git add -f obsidian-vault/ CLAUDE.md scripts/obsidian/
git commit -m "chore(obsidian): finalize vault migration" --allow-empty
```
