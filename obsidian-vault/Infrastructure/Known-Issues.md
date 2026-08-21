---
title: Infrastructure — Known Issues
module: infrastructure
updated: 2026-08-19
tags: [infra, known-issues]
---

# Infrastructure — Known Issues

_Открытые дефекты инфраструктуры._

Открытых дефектов нет (21.08.2026). Все прежние записи описывали гейты удалённого 12.08.2026 стека (eslint-конфиг, ARCH-SEC-030, ruff format, namespace-пакеты, слепые пятна vitest-гейта) — перенесены в [[../Archive/spa/Справки-удалённого-стека|Archive/spa/Справки-удалённого-стека]]; переносимые уроки живут в auto-memory. Известная яма живого окружения: `ruff` в `.venv` Personnel-Records не установлен — линт-гейт бэка сейчас не гоняется (см. [[../Personnel-Records/Архитектура|Архитектуру бэка]]).
