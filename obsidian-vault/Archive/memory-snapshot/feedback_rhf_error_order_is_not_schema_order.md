---
name: feedback-rhf-error-order-is-not-schema-order
description: Порядок ключей formState.errors не совпадает с порядком полей схемы — фокус на первую ошибку вести по положению в документе
metadata: 
  node_type: memory
  type: feedback
  originSessionId: d10f6f5a-fa4e-4b22-9f67-5bc7e551b6d1
---

`@hookform/resolvers` ПЕРЕСОБИРАЕТ объект ошибок, и порядок ключей в `formState.errors` не равен порядку полей zod-схемы. Прогон резолвера на пустой форме откомандирования: zod отдал `[startDate, endDate, divisionId, comment]`, резолвер вернул `[divisionId, comment, startDate, endDate]`.

**Why:** первая версия `focusFirstError` шла по ключам `errors`, считая их порядком схемы. Живая проба поймала: фокус уезжал на «Подразделение» — ТРЕТЬЕ поле сверху, мимо двух пустых дат. Никакой объявленный порядок (список `FIELD_ORDER`, порядок ключей схемы) и не нужен: «верхнее поле» — это положение в документе.

**How to apply:** в `shared/lib/form` фокус ведёт `focusFirstOf` — собирает элементы по `document.getElementById(name)` и выбирает самый ранний через `compareDocumentPosition` (`DOCUMENT_POSITION_PRECEDING`). Скрытые ветки формы выпадают сами: у них нет элемента. Имя поля обязано совпадать с `id` в DOM — на этом держится и связка `aria-describedby`.

Смежное: zod прогоняет `superRefine` ДАЖЕ когда правило самого поля уже нарушено (проверено на 3.25.67). Условие вида «даты обязательны, если статус выбран» требует явной проверки `values.status !== ""`, иначе пустая форма краснеет сразу тремя сообщениями вместо одного.

Ещё: `.refine((v) => v !== undefined, ...)` — TS 5.5+ выводит из этого предикат типа, zod сужает вывод схемы до `Date`, и тип формы перестаёт совпадать с тем, что она держит. Писать `(v): boolean => v !== undefined`.
