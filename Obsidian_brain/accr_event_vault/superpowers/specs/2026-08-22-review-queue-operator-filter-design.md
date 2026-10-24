# Фильтр по оператору в очереди проверки (hd-2-2 / gap §3.7)

> **Тип:** bounded design (see [[accreditation-gap-analysis]] §3.7, `High`).
> **Статус:** РЕАЛИЗОВАНО 2026-08-22 (backend + frontend, full-stack).

## Проблема

§3.7 требует фильтрацию заявок по мероприятию/оператору/статусу и поиск по ФИО.
При проверке кода выяснилось: `ReviewQueueViewSet` (fe-3-1) уже имел все фильтры,
кроме одного — по **оператору** (`request__created_by`). Фильтры по
мероприятию (`sub_event_id`), статусу (`status`), проблеме (`problem`) и
поиск по ФИО уже были реализованы.

## Решение

**Backend** (`eventproject/views/review_queue_api.py`): `?operator_id=` — тот же
паттерн валидации, что `sub_event_id` (не-int/пустой → 400 `coded_error`,
неизвестный id → пустой список 200, не 404). AND поверх уже
scope-изолированного queryset (`get_operator_attendee_queryset`) — не может
расширить видимость, только сузить.

**Frontend**:
- `frontend/src/api/operators.ts` (новый) — минимальный клиент
  `GET /api/v1/operators/?page_size=200` для наполнения дропдауна
  (не строгая zod-схема — не замороженный контракт, в отличие от review-queue DTO)
- `frontend/src/api/reviewQueue.ts` — параметр `operator_id`
- `frontend/src/pages/ReviewQueuePage.tsx` — новый `<select>` рядом с
  status/problem; `operator_id` из URL валидируется ТОЛЬКО против реально
  загруженного списка операторов (аналог enum-валидации status/problem, но
  динамический набор) — до загрузки списка/при неизвестном id фильтр
  молча игнорируется (не шлём невалидный параметр, не 400)
- i18n: `filter_operator_aria`/`filter_operator_all` в ru/kz/en `reviewQueue.json`

## RBAC-проверка (ревью)

И `/api/v1/review-queue/`, и `/api/v1/operators/` защищены `IsSuperoperator` —
новый дропдаун не может утечь PII операторов роли ниже. `operator_id` — строгий
AND поверх уже-scoped queryset, расширить видимость не может (подтверждено
code-review).

## Тесты

- Backend: 6 новых тестов в `test_review_queue_api.py` (valid/другой оператор/
  non-int 400/empty 400/unknown→пусто/комбинация с sub_event_id) — 43 теста в
  файле, все OK.
- Frontend unit (Vitest): 2 новых теста в `ReviewQueuePage.test.tsx` (клик по
  опции → запрос с `operator_id`; неизвестный `?operator_id=` в URL
  игнорируется, не шлётся, не ломает controlled-select) — 41/41 OK в файле,
  389/389 во всём фронтенд-сьюте.
- **E2E клик-тест** (`frontend/e2e/review-queue.spec.ts`, Playwright, реальный
  браузер): дропдаун реально наполняется операторами из мокнутого API, клик по
  опции → реальный HTTP-запрос с `operator_id=7`, сброс на «Все операторы» →
  параметр снят. Прогнан вручную против чистого dev-сервера (порт 5199 —
  порт 5173 в этом окружении занят посторонним долгоживущим Docker-контейнером
  `accr-frontend`, который НЕ трогали) — **зелёный**. Заодно обнаружено: pre-
  existing e2e-тесты (`attendees.spec.ts`) в этом окружении тоже падают из-за
  локаль-артефакта (browser locale detector берёт не `ru` без явного
  localStorage) — не связано с этим изменением, не чинили (не в скоупе).

Полный прогон backend: **708 тестов OK** (9 skip). Frontend: `typecheck`/`lint`/
`build` чисты, 389 vitest OK.

## Связанные заметки

- [[accreditation-gap-analysis]] — §3.7
