---
name: feedback_msw_pattern_needs_wildcard_origin
description: MSW-handler без ведущей «*» в пути молча не перехватывает — в dev клиент бьёт по абсолютному BACKEND_URL другого origin
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a2b4232c-f341-470f-822c-88b26edc0107
---

Паттерны MSW в `mocks/ops/*` обязаны начинаться с `*`: `http.get(\`*${PATH}\`)`.
Относительный путь резолвится от origin документа (:3106), а `opsApiClient`
в dev шлёт запрос на абсолютный `BACKEND_URL` (`http://localhost:8100`,
`shared/config/env.ts` — `BACKEND_URL` из `.env.local` в браузер не инлайнится,
работает зашитый дефолт). При `onUnhandledRequest: "bypass"` промах НЕ падает
ошибкой — запрос молча уходит в сеть и возвращает 404/чужой ответ.

**Why:** признак дефекта — GET «работает» (пустой список выглядит нормально),
а мутация тихо не доезжает: модалка не закрывается, статус не меняется.
Искать в network-табе, а не в коде хендлера.

**How to apply:** копируй форму соседних наборов (`daily-handlers`,
`combat-handlers`) — там уже `` `*${PATH}` ``. И не собирай паттерн хелпером,
который кодирует сегмент (`encodeURIComponent`): «:omCode» превратится в
«%3AomCode» и перестанет быть плейсхолдером — литерал в паттерне, хелпер в
клиенте. Родственное: [[feedback_msw_path_collision_silent]].
