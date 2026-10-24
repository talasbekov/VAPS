---
name: feedback-playwright-tail-hides-failures
description: tail на выводе Playwright показывает «N passed» даже когда часть спек упала — проверять прогон только по grep на failed/✘
metadata: 
  node_type: memory
  type: feedback
  originSessionId: eeb7d0ed-da7f-4643-8001-e75f4fa2863c
---

Playwright печатает итог в порядке: сначала `N failed` со списком упавших
спек, потом список медленных тестов, и в САМОМ КОНЦЕ — `M passed (время)`.
Поэтому `npm run test:e2e:mock | tail -5` показывает бодрое «81 passed» и
полностью скрывает «5 failed» выше.

Так Этап 50 (VAPS Smart Josparlau) уехал в `main` с пятью красными спеками:
прогон делался дважды, оба раза читался хвост, оба раза выглядел зелёным.
Обнаружилось только на следующем этапе, и подтвердилось прогоном на том же
коммите.

**Why:** «N passed» — это счётчик прошедших, а не вердикт прогона. Вердикт —
только exit code и строка `failed`.

**How to apply:** финальную проверку e2e гонять как
`npm run test:e2e:mock 2>&1 | grep -E "✘|failed|passed \("` (или смотреть
`echo $?`), НИКОГДА не `tail`. То же для `--reporter=list` в любом проекте.
Если в выводе нет строки `failed` и exit code 0 — только тогда зелёно.

Родственно [[feedback-vaps-canon-text-pins-include-e2e]] (e2e вне `npm run
gate`, поэтому его красноту ничто больше не покажет) и
[[feedback-narrow-projection-silent-break]].
