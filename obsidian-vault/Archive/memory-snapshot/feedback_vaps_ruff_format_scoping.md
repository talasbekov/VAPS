---
name: feedback-vaps-ruff-format-scoping
description: "In VAPS, scope `ruff format` to specific files — running it on an app dir reformats out-of-scope files"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5733a606-fb3b-4e65-873e-3382f790f85a
---

When fixing E501 in auto-generated Django migrations (the natural-`code`-PK `CharField` line overflows the 88-col limit), run `ruff format <migration_file>` on that exact file — NOT `ruff format apps/<app>/`.

The gate (`Backend/VAPS/Makefile` → `make gate`) runs `ruff check` with `select = ["E","F"]` (no T20), so `print()` is fine but E501 bites; it does NOT run `ruff format --check`, so committed files are not guaranteed ruff-format-clean.

**Why:** `ruff format apps/operations/statuses/` during story 2.2 silently reformatted the out-of-scope `services/strength_report.py` (collapsed multi-line calls), creating an unintended diff that had to be `git checkout`-reverted before the review. Whole-dir formatting breaks story scope.

**How to apply:** target `ruff format` at the precise files you created/edited this task; verify with `git status --porcelain -- <app>` before declaring scope clean. See also [[project_vaps_architecture]].
