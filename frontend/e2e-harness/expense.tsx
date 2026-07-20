// Story 10.5 (QA-добор, workflow qa-generate-e2e-tests) — e2e-харнес ЭКРАНА
// РАСХОДА.
//
// Монтируется НАСТОЯЩАЯ таблица маршрутов `AppRoutes` под настоящими
// `Providers`, а не сам `ExpenseReportPage`, и это главное решение харнеса.
// Причина — QA-проба (запись в test-summary 10.5): элемент маршрута
// `/reports` заменён мёртвым компонентом `<h1>Отчёты</h1>` → **622/622
// vitest-тестов остались зелёными**. Единственный тест, реально открывающий
// маршрут (`app-layout.qa.test.tsx:141-151`), ассертит РОВНО заголовок первого
// уровня — а заголовок есть и у заглушки, и у мёртвого дублёра. Врезка экрана
// в приложение не была покрыта ничем. Здесь она покрыта по построению: сюда
// доезжают и `RequireAuth`, и `RequirePermission daily_report.generate`, и
// `AppLayout`, и сам экран — тем же кодом, что в проде.
//
// `MemoryRouter` (а не `BrowserRouter`) — прямо предусмотренный App.tsx:18-19
// путь для e2e: `AppRoutes` экспортируется отдельно именно затем, чтобы можно
// было задать стартовый маршрут. Путь берётся из `ROUTES`, не литералом:
// канон ARCH-FE-012 на харнес формально не распространяется (правило скоуплено
// `src/**`), но литерал здесь означал бы, что подмена ключа в `routes.ts`
// проедет мимо спеки.
//
// `Providers` — БОЕВЫЕ (app/providers.tsx), не самодельная обёртка: они несут
// 401-цепочку, AuthProvider и дефолты QueryClient. Дефолт `retry` НЕ
// переопределяется намеренно (тот же приём, что в харнесе 11.4): `retry: false`
// на чтении расхода — решение САМОГО экрана (404 «не выпускался» здесь штатный
// ответ), и прописав его тут, харнес замаскировал бы его потерю. Спека вправе
// ассертить «ушёл РОВНО один GET», и утрата гасителя в прод-коде даст четыре.
//
// Сеть НЕ мокается здесь: её перехватывает `page.route` спеки — реальный fetch,
// реальные заголовки из `credential.ts`, боевой `parseErrorResponse` у границы
// и, главное, НАСТОЯЩЕЕ сохранение файла браузером (`URL.createObjectURL` +
// `<a download>` в jsdom застабены оба, то есть весь путь сохранения там —
// имитация; открытый вопрос №5 стори).
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'

import { AppRoutes } from '../src/app/App'
import { Providers } from '../src/app/providers'
import { setCredential } from '../src/shared/auth/credential'
import { ROUTES } from '../src/shared/routes'
import '../src/index.css'

// ASCII в credential: значение уходит заголовком X-User-Id (кириллица в
// заголовке отклоняется ещё до сети — находка 11.3). Ставится ДО рендера:
// `RequireAuth` читает credential синхронно и без него увёл бы на /login,
// то есть спека проверяла бы форму входа вместо экрана расхода.
setCredential({ kind: 'dev', userId: 'user-omd-7' })

createRoot(document.getElementById('root')!).render(
  // Без StrictMode (как во всех четырёх соседних харнесах): двойной монтаж
  // удвоил бы запросы, и ассерт «ушёл ровно один POST выпуска» перестал бы
  // значить то, что значит в приложении.
  <Providers>
    <MemoryRouter initialEntries={[ROUTES.reports]}>
      <AppRoutes />
    </MemoryRouter>
  </Providers>,
)
