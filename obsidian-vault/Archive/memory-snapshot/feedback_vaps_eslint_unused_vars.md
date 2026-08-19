---
name: feedback_vaps_eslint_unused_vars
description: "В frontend/eslint.config.js НЕТ varsIgnorePattern — идиома `_`-префикса для неиспользуемых переменных красит гейт"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 1d062288-812e-4f2d-ae73-7046068f1328
  modified: 2026-07-19T13:26:02.426Z
---

`@typescript-eslint/no-unused-vars` во фронте VAPS настроен **без** `varsIgnorePattern`/`argsIgnorePattern`. Значит привычная идиома «пометить неиспользуемое подчёркиванием» НЕ работает:

```ts
const { attachment_id: _omit, ...rest } = fixture   // ❌ '_omit' is assigned but never used
vi.fn((_blob: Blob) => { … })                       // ❌ '_blob' is defined but never used
```

Рабочие замены: для «выбросить ключ» — копия в `Record<string, unknown>` + `delete`; для неиспользуемого параметра колбэка — просто убрать параметр.

**Why:** идиома `_` работает в большинстве репозиториев, поэтому ошибка выглядит как каприз линтера, а не как отсутствие настройки; ловится только на `eslint .` внутри `npm run gate` — то есть уже после того, как тесты зелёные (инцидент 10.5, стоил цикла гейта).

**How to apply:** при написании тестов с деструктуризацией-исключением или заглушками-моками сразу писать без `_`-переменных, не дожидаясь красного гейта. Гейт запускать из `frontend/` — см. [[project_vaps_gate_location]].

Смежное: [[project_vaps_frontend_e2e_blindspots]], [[feedback_red_probe_backup]].
