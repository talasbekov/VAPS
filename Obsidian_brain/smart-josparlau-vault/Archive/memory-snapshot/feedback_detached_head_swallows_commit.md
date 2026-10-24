---
name: feedback_detached_head_swallows_commit
description: Параллельная сессия отцепляет HEAD в общем worktree — коммит уходит в никуда, на ветку не попадает
metadata:
  type: feedback
---

В общем чекауте (`.claude/worktrees/wizardly-chaplygin-f750e9`) параллельная
сессия дважды уводила указатель: сначала `main` → ветка от 08.08, потом
`main` → detached HEAD на том же коммите. Второй случай опаснее: `git commit`
проходит, лог выглядит нормально, но коммита НЕТ ни на одной ветке — только
в reflog.

**Why:** признак — `git branch --show-current` пусто, `git status` первой
строкой «Отсоединённый указатель HEAD». Стенд при этом обслуживает эту же
папку: при уводе на старую ветку он несколько минут отдавал код недельной
давности.

**How to apply:** ПЕРЕД коммитом в общем чекауте — `git symbolic-ref --short
HEAD`. После коммита — `git branch -a --contains <sha>`, а не только
`git log`. Починка без переписывания истории: убедиться, что ветка предок
(`git merge-base --is-ancestor main HEAD`), затем `git branch -f main HEAD` +
`git checkout main`. `git checkout` прерывается, если незакоммиченные правки
задевают файлы, различающиеся между коммитами, — сначала коммит, потом
перемотка. Родственное: [[feedback_parallel_story_commit_sweep]].
