---
name: feedback-vaps-blank-tab-loses-credential
description: target=_blank во фронте VAPS теряет credential (sessionStorage) — новая вкладка открывается на экране входа; context-level сид в e2e это маскирует
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 32841bcc-f76d-4010-95d9-427c4203682c
---

Во фронте VAPS credential живёт в `sessionStorage`
(`shared/auth/credential.ts`, ключ `vaps.credential`). Chromium ≥88 трактует
безымянный `target="_blank"` как implicit `noopener` — новая вкладка НЕ
является auxiliary browsing context, поэтому `sessionStorage` в неё не
клонируется, и любая страница за `RequireAuth` открывается на экране «Вход».
`rel="noreferrer"` усугубляет то же самое.

**Why:** ссылка «открыть в новой вкладке» выглядит безобидным UX-жестом, и
статический просмотр кода дефект не показывает — он виден только когда
попап реально отрендерился. Поймано на печатной форме расстановки
(коммит `7a2ce30`): первая версия ссылки была с `_blank`, e2e-попап показал
«Вход».

**How to apply:** для страниц за `RequireAuth` линковать в ТОЙ ЖЕ вкладке
(возврат — кнопкой браузера), как сделано в `SecurityEventDetailPage` →
`/print/placement`. Если пишешь e2e на такой переход — credential сеять
ТОЛЬКО на исходной странице (`page.addInitScript`): `context.addInitScript`
даёт credential каждой новой вкладке заново и делает пробу вакуумной —
ровно так замаскирован тот же дефект у донорской `ExpenseReportPage.tsx:285`
(`e2e/expense-print.spec.ts:200`, вынесен задачей `task_60f58012`).
Родственно [[feedback-redundant-guards-vacuous-probe]] и
[[project-vaps-frontend-e2e-blindspots]].
