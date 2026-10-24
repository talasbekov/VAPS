---
name: reference-skills-cli-find-blocked
description: "npx skills find зависает в песочнице (реестр недоступен), но npx skills add работает — искать через WebFetch по skills.sh"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 86978007-219e-43cb-a9b7-0927265b7519
---

`npx skills find` в этой песочнице **виснет насмерть** (таймаут по SIGTERM,
exit 143/144). Тот же симптом у `curl https://api.github.com` — 504 Gateway
Time-out через прокси. Реестр поиска недоступен.

При этом **`npx skills add <owner/repo>` работает** — идёт другим путём и
ставит скилл нормально.

Как искать вместо CLI:
- `WebFetch https://skills.sh/` — лидерборд рендерится, install-счётчики видны;
- `WebFetch https://skills.sh/topic/<slug>` — темы: `testing`, `databases`
  (единственное число `topic`, не `topics`; `/topics` и `/topic/python` → 404);
- `WebFetch https://skills.sh/<owner>/<repo>` — карточка скилла с точным
  install count и командой установки;
- `https://skills.sh/search?q=...` — JS-шелл, результатов не отдаёт, бесполезен;
- звёзды репо надёжнее читать со строки результата
  `github.com/search?q=repo:<owner>/<repo>&type=repositories`, чем со страницы репо.

Не запускать `skills find` в фоне «на всякий случай» — четыре фоновые задачи
провисели до принудительного kill и не дали ни строчки вывода.

См. [[project_new_stack_removed]] по поводу того, какой стек сейчас живой.
