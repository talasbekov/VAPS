---
name: conditional-check-null-gap
description: SQL CHECK проходит на NULL — regex-ветка «поле обязано быть» требует явного isnull=False
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 51a84c74-ebf7-442d-bedc-d645b1565e9e
---

В conditional-CHECK Django/Postgres голое `field__regex=r"\S"` в ветке «поле обязательно» НЕ ловит NULL: regex на NULL даёт NULL, а CHECK «проходит» на NULL. Инцидент 14.3a: `chk_checklist_override_add_shape` пропускал ADD без текста, поймано красной пробой.

**Why:** трёхзначная логика SQL — CHECK нарушен только при FALSE, NULL = пропуск.

**How to apply:** в каждой ветке CHECK, где поле обязано существовать, писать `Q(field__isnull=False, field__regex=...)`; ветки на isnull-предикатах безопасны. Красная проба на NULL — обязательна для каждой «обязательной» ветки. См. [[vaps-db-integrity-checks]].
