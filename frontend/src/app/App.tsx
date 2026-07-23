// Роутер портала (ARCH-FE-012): plain Routes, пути — только константы ROUTES
// (literal-пути ловит eslint no-restricted-syntax, ужесточение 8.7).
// Layout-route: RequireAuth (credential-гейт) → AppLayout (каркас) → вложенные
// разделы, каждый за своим RequirePermission (карта гейтов — UX L59-68, коды
// из seed_operations дословно). Разделы пока — заглушки app/section-stubs
// (экраны — E9/E10). /admin/* в карте нет (Д5); catch-all/404 не в карте UX.
import { Suspense, lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { getFrontendEnv } from '../shared/config/env'
import { LoginPage } from '../features/auth/LoginPage'
import { ChangelogPage } from '../features/changelog/ChangelogPage'
import { DailyUpdatePage } from '../features/daily-grid/DailyUpdatePage'
import { ExpenseReportPage } from '../features/expense/ExpenseReportPage'
import { ExpensePrintPage } from '../features/print-forms/ExpensePrintPage'
import { PrintTestPage } from '../features/print-forms/PrintTestPage'
import { EmployeeDetailPage } from '../features/personnel/pages/EmployeeDetailPage'
import { EmployeesListPage } from '../features/personnel/pages/EmployeesListPage'
import { ObjectPassportPage } from '../features/objects/pages/ObjectPassportPage'
import { ObjectsListPage } from '../features/objects/pages/ObjectsListPage'
import { AuditLogPage } from '../features/audit/pages/AuditLogPage'
import { ServiceAnalyticsPage } from './ServiceAnalyticsPage'
import { TrafficLightTreePage } from '../features/traffic-light/TrafficLightTreePage'
import { RequireAuth, RequirePermission } from '../shared/auth/guards'
import { ROUTES } from '../shared/routes'
import { AppLayout } from '../shared/ui/AppLayout'
import { RouteChunkBoundary } from './RouteChunkBoundary'
import { DashboardStub } from './section-stubs'

// `React.lazy`, а НЕ статический импорт: `import.meta.env.MODE === 'mock'`
// (build-time литерал, Vite ARCH L459) даёт Rollup статически исключить весь
// DemoToolbar-chunk (persona-каталог, demo-runtime) из `vite build` (дефолт,
// mode=production) — mock-only-demo UI не входит в обязательный startup
// API-режима (§8.1/§8.3).
const DemoToolbar = lazy(() =>
  import('./mocks/DemoToolbar').then((m) => ({ default: m.DemoToolbar })),
)

// Route-based code splitting обязателен для «охранных мероприятий» (§5.2).
const CommandCenterPage = lazy(() =>
  import('../features/security-events/pages/CommandCenterPage').then((m) => ({
    default: m.CommandCenterPage,
  })),
)
const SecurityEventsListPage = lazy(() =>
  import('../features/security-events/pages/SecurityEventsListPage').then(
    (m) => ({ default: m.SecurityEventsListPage }),
  ),
)
const SecurityEventDetailPage = lazy(() =>
  import('../features/security-events/pages/SecurityEventDetailPage').then(
    (m) => ({ default: m.SecurityEventDetailPage }),
  ),
)

// Экспорт отдельно от BrowserRouter: E2E-тесты оборачивают AppRoutes в
// MemoryRouter с initialEntries (BrowserRouter не даёт задать стартовый маршрут)
export function AppRoutes() {
  return (
    <Routes>
      <Route path={ROUTES.login} element={<LoginPage />} />
      {/* Печатный каркас (8.8, канон L255): сиблинг layout-route — на бумагу
          сайдбар/шапка AppLayout не попадают. За RequireAuth (единый credential-
          гейт: реальные формы = ПДн), БЕЗ RequirePermission — у тест-страницы
          данных нет, коды прав приедут с формами E10 (Д3). */}
      <Route
        path={ROUTES.printTest}
        element={
          <RequireAuth>
            <PrintTestPage />
          </RequireAuth>
        }
      />
      {/* Печатная форма расхода (10.7): тоже сиблинг layout-route — сайдбар и
          шапка на бумагу не попадают. В отличие от каркаса 8.8 здесь ЕСТЬ
          RequirePermission: страница читает реальные данные расхода, и гейт
          зеркалит бэковое `_EXPENSE_PERMISSION` (views.py:74). В NAV_SECTIONS
          маршрут не добавляется — печатная форма не раздел портала. */}
      <Route
        path={ROUTES.printExpense}
        element={
          <RequireAuth>
            <RequirePermission permission="daily_report.generate">
              <ExpensePrintPage />
            </RequirePermission>
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route
          path={ROUTES.home}
          element={
            <RequirePermission permission="status.view">
              <DashboardStub />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTES.employees}
          element={
            <RequirePermission permission="status.view">
              <EmployeesListPage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTES.employeeDetail}
          element={
            <RequirePermission permission="status.view">
              <EmployeeDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTES.objects}
          element={
            <RequirePermission permission="ops.object.view">
              <ObjectsListPage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTES.objectDetail}
          element={
            <RequirePermission permission="ops.object.view">
              <ObjectPassportPage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTES.commandCenter}
          element={
            <RequirePermission permission="ops.dashboard.view">
              <RouteChunkBoundary>
                <CommandCenterPage />
              </RouteChunkBoundary>
            </RequirePermission>
          }
        />
        <Route
          path={ROUTES.securityEvents}
          element={
            <RequirePermission permission="ops.security_event.view">
              <RouteChunkBoundary>
                <SecurityEventsListPage />
              </RouteChunkBoundary>
            </RequirePermission>
          }
        />
        <Route
          path={ROUTES.securityEventDetail}
          element={
            <RequirePermission permission="ops.security_event.view">
              <RouteChunkBoundary>
                <SecurityEventDetailPage />
              </RouteChunkBoundary>
            </RequirePermission>
          }
        />
        <Route
          path={ROUTES.dailyExpense}
          element={
            <RequirePermission permission="daily_report.mark_update">
              <DailyUpdatePage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTES.organization}
          element={
            <RequirePermission permission="status.view">
              <TrafficLightTreePage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTES.reports}
          element={
            <RequirePermission permission="daily_report.generate">
              <ExpenseReportPage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTES.audit}
          element={
            <RequirePermission permission="audit.view">
              <AuditLogPage />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTES.serviceAnalytics}
          element={
            <RequirePermission permission="ops.analytics.view">
              <ServiceAnalyticsPage />
            </RequirePermission>
          }
        />
        {/* Журнал «сообщено → исправлено» (10.9): вложен в layout-route, то
            есть за RequireAuth родителя — своей обёртки НЕ добавляем. БЕЗ
            RequirePermission, и это не упущение: журнал доступен ЛЮБОМУ
            авторизованному (AC 13.4, epics.md#L1378) — читать «система живёт и
            чинится» должны и те, у кого прав нет вовсе. Прецедент безправного
            роута за RequireAuth — printTest (:29-36), прецедент безправной
            аудитории в каркасе — NotificationBell (AppLayout.tsx:75-78).
            В NAV_SECTIONS маршрут не добавляется — вход через футер (AC-7). */}
        <Route path={ROUTES.changelog} element={<ChangelogPage />} />
      </Route>
    </Routes>
  )
}

function App() {
  const env = getFrontendEnv()
  // `import.meta.env.MODE === 'mock'` — ОБЯЗАТЕЛЬНО первым в `&&`: build-time
  // литерал позволяет Rollup исключить ветку (и chunk) целиком в production-
  // сборке; `env.demoToolsEnabled` — рантайм-тумблер ВНУТРИ mock-сборки.
  const showDemoToolbar = import.meta.env.MODE === 'mock' && env.demoToolsEnabled
  return (
    <BrowserRouter>
      <AppRoutes />
      {/* mock-only-demo (§8.3): переключатель persona/reset, НЕ продуктовый UI.
          Внутри BrowserRouter — DemoToolbar зовёт useNavigate(). */}
      {showDemoToolbar ? (
        <Suspense fallback={null}>
          <DemoToolbar />
        </Suspense>
      ) : null}
    </BrowserRouter>
  )
}

export default App
