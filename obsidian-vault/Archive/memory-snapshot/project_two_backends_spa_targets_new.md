---
name: project-two-backends-spa-targets-new
description: "SPA Smart Josparlau написана под НОВЫЙ бэк VAPS, а стенд :8100 — старый Personnel-Records; сверять контракт с обоими"
metadata: 
  node_type: memory
  type: project
  originSessionId: be7b91bc-b843-47a0-85ad-a0e84beeb1e2
---

В репозитории ДВА бэка, и они покрывают разные префиксы:

- **`Backend/VAPS`** (новый, донор переезда) — `core`, `operations`, `audit`,
  `notifications`, `documents`. Полный список путей лежит готовым в
  `Backend/VAPS/schema.yaml` (39 путей) — venv там нет, резолвер не поднять,
  но схема отвечает на вопрос без запуска.
- **`Backend/PersonnelStatus/Personnel-Records`** (старый, ЦЕЛЕВОЙ, стенд
  Django :8100) — `staff_unit`, `divisions`, `dictionaries`, `statuses`,
  `reports`, `operations`, `audit`, `notifications`, `token`.

**SPA написана под НОВЫЙ бэк.** Из 58 путей, которые она зовёт: 16 есть в
новом, 10 — в старом. Прямая улика — `/api/core/*` и
`/api/operations/expense-reports/`: в новом есть, в старом нет вовсе.

**Почему это важно:** легко потратить день, подгоняя фронт под старый бэк и
делая вывод «бэка под раздел нет». Вывод будет неверным — часть бэка есть, но
в другом репозитории и ещё не перевезена. Перед выводом «ручки не существует»
проверять ОБА: `schema.yaml` нового и резолвер старого.

Переезд идёт срезами из нового в старый; на срезе 152 все срезы — про
`operations`/расход/снимки, а `apps/core` не переносили вовсе. Пока `core` не
переехал, ни один экран раздела не женится целиком: «Расход дня» зовёт четыре
пути, и `core/divisions` + `core/employees` — половина из них.

37 путей `/api/ops/*` (объекты, дежурства, рейтинги, аналитика, служебные
отчёты, справочники, настройки) не существуют НИ В ОДНОМ бэке — это не
разъехавшийся префикс (проверено: аналога под `operations` нет у 37 из 38).

См. [[project-stand-raise-gotchas]], [[project-native-port-security-ops]].
