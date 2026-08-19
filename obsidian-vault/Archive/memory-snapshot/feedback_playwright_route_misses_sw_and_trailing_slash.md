---
name: feedback_playwright_route_misses_sw_and_trailing_slash
description: page.route на старом фронте не перехватывает без serviceWorkers block + предиката вместо глоба
metadata:
  node_type: memory
  type: feedback
---

Чтобы `page.route` в `PersonalRecordFront` действительно перехватил запрос,
нужны **два** условия сразу — по отдельности каждое даёт ТИХИЙ промах
(обработчик просто не зовётся, ошибки нет):

1. `test.use({ serviceWorkers: 'block' })` — фронт держит service worker MSW,
   запросы приложения идут через него, а `page.route` видит только запросы
   самой страницы. Разделу ОМ мок не нужен (он живой), поэтому блокировать
   безопасно; для мок-доменов (ГВО, лица, законы) так нельзя;
2. **матчер-предикат**, а не строка-глоб: `'**/api/operations/my-permissions/**'`
   НЕ ловит `http://localhost:8100/api/operations/my-permissions/` —
   у Playwright (1.56) `/**` требует ещё одного сегмента, а путь кончается
   слэшем. Работает `(url) => url.pathname.includes('/api/operations/my-permissions/')`.

**Why:** проба задержки без перехвата зеленеет не от задержки, а от
медленного первого рендера. Инцидент 17.08.2026: окно загрузки прав на
холодном dev-сервере ~0.5 с — этого хватало ассерту, и на прогретом сервере
та же проба развалилась.

**How to apply:** в пробе, которая ЗАДЕРЖИВАЕТ ответ, обязателен счётчик
перехватов (`expect(asked).toBeGreaterThan(0)`) и проверка ПОСЛЕ ожидаемого
интервала («через 1.5 с всё ещё грузится»), а не мгновенный снимок — иначе
она снова начнёт ловить удачу. Счётчик проверять в КОНЦЕ теста: в начале
запрос может быть ещё не отправлен. См.
[[feedback_msw_pattern_needs_wildcard_origin]],
[[feedback_retrying_assert_hides_first_frame]].
