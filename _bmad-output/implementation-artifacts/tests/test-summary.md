# Test Automation Summary — Story 8.5 (useApiMutation и ConflictDialog)

Дата: 2026-07-07 · Скилл: bmad-qa-generate-e2e-tests · Модель: Claude Fable 5
(предыдущая сводка — 8.4 — в git-истории этого файла)

## Контекст

Стори 8.5 — UI-половина протокола ошибок ARCH-FE-015: `useApiMutation` ветвит
ApiError-union по каналам (форма/диалог/тост/state), общий `ConflictDialog` с
override-повтором, aria-live тост, `Providers` (react-query `retry: false`).
Браузерного раннера (Playwright/Cypress) в проекте нет → E2E-уровень стека =
vitest 4 + RTL + user-event + MSW 2 (jsdom per-file docblock, Д7).

Dev-стори принесла 21 тест: хук изолированно (renderHook + локальная обёртка,
12) и диалог изолированно (RTL, 9). QA-проход искал непокрытые связки и ветки.

## Найденные пробелы покрытия (auto-applied, 51 → 60 тестов)

### E2E user-флоу через РЕАЛЬНУЮ app-композицию — `src/app/providers.test.tsx` (новый, +3)

1. **`providers.tsx` не тестировался вовсе**, а хук-тесты шли через локальную
   обёртку, зеркалящую конфиг — регресс в самом `createQueryClient`/монтаже
   `ToastProvider` тесты 21 шт. не поймали бы. Закрыто интеграцией «мини-фича
   как в E9» (хук + общий ConflictDialog + error-state) внутри настоящего
   `<Providers>`:
   - **happy path глазами пользователя**: сабмит → 409 → диалог → paste причины →
     «Подтвердить оверрайд» → тело второго запроса `{...исходное, override: true,
     override_reason}` (захвачено) → «Статус создан», диалог закрыт (AC 1);
   - **отмена глазами пользователя**: «Отмена» → повтора нет, ошибка у фичи;
     повторный сабмит открывает диалог с ЧИСТОЙ textarea — state причины не
     переживает закрытие (инвариант «размонтирование = закрытие», AC 2);
   - **канал тоста через реальный ToastProvider**: 500 → generic-текст в
     `role="status"`, без деталей конверта, без диалога, ровно 1 запрос (AC 5).
   Размещение в `app/` — вынужденно-правильное: app→shared легален, обратное
   запрещено (ARCH-FE-013); рядом с providers.tsx (L440).

### Тост (`shared/ui/toast.tsx`) — `toast.test.tsx` (новый, +3)

2. **Нулевое покрытие компонента**; `TOAST_AUTO_DISMISS_MS` экспортирован «для
   тестов с fake timers», но не использовался ни одним тестом. Закрыто:
   - авто-dismiss ровно через `TOAST_AUTO_DISMISS_MS` (граница: жив на −1 мс);
   - постоянный live-регион существует и ДО сообщения;
   - **перезарядка таймера**: второй toast заменяет сообщение, и дедлайн первого
     НЕ гасит второе (ветка `clearTimeout` в `toast()`);
   - guard `useToast` вне провайдера кидает понятную ошибку (монтаж из app).

### Хук (`shared/api/useApiMutation.ts`) — дополнен `useApiMutation.test.tsx` (+3)

3. **Сброс конфликта новым `mutate`** (строка `setConflict(null)` в mutate):
   диалог закрывается синхронно, не дожидаясь ответа; новый 409 взводит заново.
4. **Override-повтор, встретивший НОВЫЙ 409 overridable** → диалог взводится
   заново, `onSuccess` не вызван — сервер авторитетен (UX L177: hard/soft
   деление на бэке); дефолтная MSW-фикстура этот путь не проявляла (201 на повтор).
5. **Guard `confirmOverride` без предшествующего mutate** — no-op: запрос не
   уходит (defensive-ветка `lastVariablesRef === null`).

## Верификация (не вакуумность)

- `vitest run` — **60/60 зелёные** (30 node 8.4 + 30 jsdom: 21 стори + 9 QA).
- **Мутационная проба 1**: убран `setConflict(null)` из `mutate` → ровно тест
  «новый mutate сбрасывает conflict-state» красный (1 failed | 14 passed). Откачено.
- **Мутационная проба 2**: убран `clearTimeout` из `toast()` → ровно тест
  перезарядки таймера красный (1 failed | 2 passed). Откачено.
- **Мутационная проба 3**: `retry: false` → `retry: 1` в `createQueryClient` →
  **все 3 E2E-теста красные** — интеграция пинует реальный app-конфиг, а не
  тестовую обёртку. Откачено.
- Прод-код восстановлен байт-в-байт (Edit туда-обратно; файлы стори untracked
  до коммита — git-restore недоступен, урок 8.4 учтён).
- `npm run gate` — **все 9 шагов зелёные** после отката (deps-gate 413 пакетов,
  schema-check, tsc -b, eslint, lint-canon 13+5, schema-check.test, vitest 60/60,
  vite build, size-gate). Бандл **66.7 KB gzip — не вырос** (тесты в бандл не утекли).

## Покрытие

- AC стори: 8/8 автоматизированы (AC 1–5 — хук + E2E-интеграция, AC 6 —
  lint-canon фикстуры стори, AC 7 — контракт-тест каналов + компонентные, AC 8 —
  сам gate); QA добавил E2E-срез поверх изолированных срезов dev-стори.
- Файлы стори с тестами: 4/4 (`useApiMutation.ts`, `ConflictDialog.tsx`,
  `toast.tsx` — было 0, `providers.tsx` — было 0).
- Каналы протокола ARCH-FE-015: 4/4 доказаны дважды — изолированно (renderHook)
  и в user-флоу (E2E через Providers) для диалога и тоста.
- Переходы conflict-state: 5/5 (open/confirm/dismiss — стори; re-mutate,
  re-conflict после override, no-op guard — QA).

## Файлы

- Создано: `frontend/src/app/providers.test.tsx` (3 E2E),
  `frontend/src/shared/ui/toast.test.tsx` (3 компонентных).
- Изменено: `frontend/src/shared/api/useApiMutation.test.tsx` (+3 теста,
  describe «conflict-state: граничные переходы»).
- Продакшен-код, конфиги, gate-цепочка — не тронуты (пробы откачены байт-в-байт).

## Next Steps

- Q1–Q4 стори (Д1–Д8) по-прежнему ждут подтверждения Bratan на ревью — E2E-тесты
  пинуют Д1-контракт повтора, при смене решения обновить капчер-ассерты.
- Настоящие браузерные E2E (Playwright) — кандидат на конец E8/E9, когда появятся
  роутер (8.7) и первые страницы; текущий стек сознательно ограничен jsdom.
- Паттерн «мини-фича как в E9» из providers.test.tsx — готовый шаблон для
  тестов первых реальных фич (8.6+).
