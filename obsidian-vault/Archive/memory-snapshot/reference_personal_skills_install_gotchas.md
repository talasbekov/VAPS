---
name: reference-personal-skills-install-gotchas
description: "Скиллы из ~/.agents/skills не видны сессии, открытой до установки; CLAUDE_PLUGIN_ROOT у них пустой — путь к скриптам только абсолютный"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 2eb7c32a-cae5-491a-a87a-1593f63271ec
---

Personal-скиллы ставятся `npx skills add` в `/home/erda/.agents/skills/<name>` и симлинкуются в `/home/erda/.claude/skills/<name>`. Две ямы:

1. **«isn't a recognized command here»** ≠ скилл не установлен. Список слэш-команд строится **при старте сессии**. Скилл, поставленный в уже открытую сессию, невидим до перезапуска. Проверять установку, а не верить сообщению: `ls -la ~/.claude/skills/<name>` + `head ~/.agents/skills/<name>/SKILL.md` (фронтматтер `name:`) + прогнать скрипт скилла.

2. **`CLAUDE_PLUGIN_ROOT` пустой** — это personal skill, не плагин. Команды вида `python "${CLAUDE_PLUGIN_ROOT}/.claude/skills/<name>/scripts/x.py"` из SKILL.md не работают дважды: переменная пуста И путь задваивает `.claude/skills`. Подставлять абсолютный: `python3 /home/erda/.agents/skills/<name>/scripts/x.py`. Правка SKILL.md переживёт только до следующего `skills add`.

Связано: [[reference-skills-cli-find-blocked]].
