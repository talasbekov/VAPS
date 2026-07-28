// Story 10.10 — e2e-харнес ЦЕПОЧКИ СДАЧИ ЦЕЛИКОМ (сценарий №3 из лимита 5,
// architecture.md#L259): массовое обновление → сдача дня → зелёный светофор →
// скачанный расход, против ЖИВОГО бэкенда.
//
// Форма — копия expense.tsx: единственный из шести соседних харнесов, который
// поднимает настоящие `Providers` + `AppRoutes` + `MemoryRouter` и проходит
// через `RequireAuth`/`RequirePermission`/`AppLayout`. Отличий ровно два —
// стартовый маршрут и актор.
//
// 🔴 Почему НОВЫЙ вход, а не переиспользование expense.html (Решение №4):
// `expense.tsx` захардкожен на `ROUTES.reports` и `userId: 'user-omd-7'`, и от
// него зависит мокнутая `e2e/expense.spec.ts`. Правка сцепила бы живую и
// мокнутую спеки через один файл — класс отказа, который потом ловится днями.
//
// Почему ВСЯ таблица маршрутов, а не четыре экрана россыпью: предмет этой
// стори — именно СВЯЗКА. Навигация между шагами идёт кликами по сайдбару
// (`<nav aria-label="Разделы">`), то есть тем же кодом, что у оператора;
// `MemoryRouter` это поддерживает, URL-строки нет и она не нужна.
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'

import { AppRoutes } from '../src/app/App'
import { Providers } from '../src/app/providers'
import { setCredential } from '../src/shared/auth/credential'
import { ROUTES } from '../src/shared/routes'
import '../src/index.css'

// 🔴 ДОСЛОВНО `DEFAULT_ACTOR` сид-команды `seed_e2e_expense_chain` — актор
// получает `UserRole(ADMIN, scope=NULL)` только там. Рассинхрон дал бы актора
// без единой роли: экраны отдали бы 403, и отладка ушла бы в права вместо
// фикстуры. ASCII обязателен — значение уходит заголовком X-User-Id, где
// кириллица отклоняется ещё до сети (находка 11.3).
//
// Ставится ДО рендера: `RequireAuth` читает credential синхронно и без него
// увёл бы на /login, то есть спека проверяла бы форму входа вместо цепочки.
setCredential({ kind: 'dev', userId: 'e2e-chain-operator' })

// Story 10.10a — экспонирует ПЕРЕКЛЮЧАТЕЛЬ актора для многоактёрного спека.
// `setCredential` уже реактивен (`useSyncExternalStore`, credential.ts) и уже
// синхронно пишет в sessionStorage — `page.evaluate` вызывает эту же функцию
// БЕЗ `page.reload()`/повторного `addInitScript` (урок памяти проекта:
// `addInitScript` переустанавливает персону на КАЖДОЙ навигации; здесь
// навигаций между шагами нет — `MemoryRouter` держит состояние приложения,
// переходы идут кликами по сайдбару). e2e-only харнес-файл — отдельная
// Vite-точка входа (`vite.e2e.config.ts`), в прод-бандл не попадает.
;(window as unknown as { __e2eSetActor: typeof setCredential }).__e2eSetActor =
  setCredential

createRoot(document.getElementById('root')!).render(
  // Без StrictMode (канон всех шести соседних харнесов): двойной монтаж удвоил
  // бы запросы, и счётчик `GET /traffic-light/tree/` — несущий ассерт
  // атрибуции зелёного (AC-7в) — перестал бы значить то, что значит в
  // приложении.
  <Providers>
    {/* Цепочка НАЧИНАЕТСЯ с массового обновления: до записи статусов горизонт
        данных пуст, и светофор честно отдал бы 422 REPORT_NO_DATA_FOR_DATE. */}
    <MemoryRouter initialEntries={[ROUTES.dailyExpense]}>
      <AppRoutes />
    </MemoryRouter>
  </Providers>,
)
