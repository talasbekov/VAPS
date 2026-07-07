# Test Automation Summary — Story 8.4 (apiClient и DomainError-парсинг)

Дата: 2026-07-07 · Скилл: bmad-qa-generate-e2e-tests · Модель: Claude Fable 5

## Контекст

Стори 8.4 — транспортная половина ARCH-FE-015: свой fetch-клиент + типизированный
парсинг конверта §36 в одной точке. UI-фич нет (App — каркас 8.1) → браузерных E2E
нет по определению; «API-тесты» = vitest + MSW (environment node) против реальных
путей schema.d.ts. Фреймворк проекта: vitest 4 + MSW 2 (заложены самой сторей 8.4),
паттерны — существующие client.test.ts / errors.test.ts.

Dev-стори уже принесла 17 тестов (13 client + 4 errors): все AC-ветки маппинга
статусов покрыты. QA-проход искал дыры в ветках кода и заявленных, но не
проверенных свойствах транспорта.

## Найденные пробелы покрытия (auto-applied, 17 → 30 тестов)

### Транспорт (`client.ts`) — закрыто в `client.test.ts` (+7)

1. **JSON-сериализация тела (Task 3) не проверялась вовсе**: ни один тест не
   смотрел на сам запрос. Закрыто capture-хендлером: POST шлёт JSON-тело и
   `Content-Type: application/json`, 201-тело возвращается типизированным.
2. **Ветка «без тела»**: `Content-Type` НЕ выставляется — была не покрыта.
3. **`defaultHeaders` (Д6 — точка расширения 8.6/auth)**: заявлена в опциях, но
   не проверялась; регресс стрелял бы только в 8.6. Закрыто capture-тестом.
4. **`patch()` ни разу не вызывался** (0 покрытия метода фабрики). Закрыто:
   PATCH `/api/core/employees/{id}/` (реальный метод схемы) — метод/тело доходят,
   200-тело типизировано.
5. **`NetworkError.cause` и message**: клиент передаёт `{cause}` и `метод+путь` —
   не ассертилось. Дополнен существующий network-тест.
6. **Деградация спец-статусов без конверта**: ветка `envelope === null` ДО switch
   (400/409/422 c text/plain → базовый `ApiError`, НЕ сабкласс) — покрывалась
   только для 405. Закрыто `it.each([400, 409, 422])` (Ловушка 3: конверт ≠ гарантия).

### Парсер (`errors.ts`) — закрыто юнит-describe в `errors.test.ts` (+6)

7. **Конверт без `message`** → fallback `message = error_code` (ветка readEnvelope).
8. **Мусорные поля конверта**: `details` не-объект → `{}`, `request_id` не-строка →
   `null` (нормализация).
9. **JSON не-объект (массив)** → конверта нет → базовый `ApiError`, `errorCode: null`.
10. **5xx с JSON без `error_code`** (DRF-native `{"detail"}`) → `ServerError` без
    вторичного исключения (был покрыт только HTML-вариант 502).
11. **Пустой `statusText`** → короткая форма message `HTTP <status>`.
12. **`ConflictError` с `errorCode: null`** → `overridable=false` (defensive-ветка
    конструктора, через parseErrorResponse недостижима — прямая юнит-проверка).

Юнит-тесты парсера конструируют `Response` напрямую (без MSW): проверяются формы,
которые бэк-handler не шлёт, но защита от которых обязана существовать.

## Верификация (не вакуумность)

- `vitest run` — **30/30 зелёные** (13+7 client, 4+6 errors).
- **Мутационная проба 1**: убрана строка `headers['Content-Type'] = …` в client.ts →
  ровно новый POST-тест красный (1 failed | 29 passed). Откачено.
- **Мутационная проба 2**: fallback `message = error_code` → `''` в errors.ts →
  ровно новый fallback-тест красный (1 failed | 29 passed). Откачено.
- `git diff` по `client.ts`/`errors.ts` пуст — продакшен-код не изменён, QA-проход
  трогал ТОЛЬКО тестовые файлы.
- `npm run gate` — **все 9 шагов зелёные** (deps-gate, schema-check, tsc -b strict,
  eslint, lint-canon 11 красных + 4 негативных контроля, schema-check.test, vitest
  30/30, vite build, size-gate). Бандл **59.4 KB gzip — не вырос** (тесты/MSW в
  бандл не утекли, Ловушка 8-бандл).

## Покрытие

- AC стори: 9/9 с автоматическим исполнением (AC 1–6 — client.test.ts, AC 7 —
  контракт-тест реестра, AC 8 — lint-canon фикстуры, AC 9 — сам gate).
- Методы клиента: 4/4 вызваны тестами (get/post/patch/del; было 3/4).
- Defensive-ветки readEnvelope/parseErrorResponse: 6/6 (было 2/6 — только
  502-HTML и DRF-native 405).
- Заявленные опции клиента: 2/2 (`baseUrl` — все тесты, `defaultHeaders` — было 0).

## Файлы

- Изменено: `frontend/src/shared/api/client.test.ts` (+7 тестов + 2 ассерта),
  `frontend/src/shared/api/errors.test.ts` (+6 тестов, расширен header-коммент).
- Продакшен-код, конфиги, gate-цепочка — не тронуты.

## Next Steps

- Браузерные E2E появятся с первым UI-потребителем (8.5: useApiMutation +
  ConflictDialog, jsdom/RTL); каркас vitest уже готов.
- Остаточная дыра enforcement из Dev Record 8.4 (`window.XMLHttpRequest` в
  no-restricted-properties) — кандидат в code-review стори, не в QA-тесты.
- Runtime-валидация MSW-хендлеров против schema.yaml — deferred (E10 либо первый
  рассинхрон), зафиксировано в границах стори.
