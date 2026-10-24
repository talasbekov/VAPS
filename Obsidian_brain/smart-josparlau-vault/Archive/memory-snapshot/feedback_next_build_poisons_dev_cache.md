---
name: feedback-next-build-poisons-dev-cache
description: "next build в каталоге работающего next dev перетирает .next — стенд отдаёт 500, идущий e2e падает с «Unexpected token '<'»"
metadata:
  node_type: memory
  type: feedback
---

Проверочная сборка `npx next build` в том же каталоге, где крутится
`next dev`, пишет в ОБЩИЙ `.next`. Живой стенд начинает отдавать 500 и HTML
вместо JSON; идущий по нему Playwright падает не там, где ошибка, а на
`SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON` в шаге
авторизации. Выглядит как поломка кода — на самом деле собственный build.

**Как применять (PersonalRecordFront):** в `next.config.js` заведён
`distDir: process.env.NEXT_DIST_DIR || ".next"`. Проверочная сборка:

```
NEXT_DIST_DIR=.next-build npx next build
```

Дополнительно: переименование файла-точки входа (`index.ts` → `index.tsx`)
требует ПЕРЕЗАПУСКА `next dev` — резолвер держит старый путь и отдаёт 500 на
всё приложение, хотя `next build` при этом зелёный.

Родственно [[feedback-next-dev-shared-build-cache]] (там — два `next dev` на
общем `.next`).
