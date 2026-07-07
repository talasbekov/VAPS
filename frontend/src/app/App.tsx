// Роутер портала (ARCH-FE-012): plain Routes, пути — только константы ROUTES
// (literal-пути ловит eslint no-restricted-syntax, ужесточение 8.7).
// Layout-route: RequireAuth (credential-гейт) → AppLayout (каркас) → вложенные
// разделы, каждый за своим RequirePermission (карта гейтов — UX L59-68, коды
// из seed_operations дословно). Разделы пока — заглушки app/section-stubs
// (экраны — E9/E10). /admin/* в карте нет (Д5); catch-all/404 не в карте UX.
import { BrowserRouter, Route, Routes } from 'react-router'
import { LoginPage } from '../features/auth/LoginPage'
import { PrintTestPage } from '../features/print-forms/PrintTestPage'
import { RequireAuth, RequirePermission } from '../shared/auth/guards'
import { ROUTES } from '../shared/routes'
import { AppLayout } from '../shared/ui/AppLayout'
import {
  AuditStub,
  DailyExpenseStub,
  DashboardStub,
  EmployeesStub,
  OrganizationStub,
  ReportsStub,
} from './section-stubs'

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
              <EmployeesStub />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTES.dailyExpense}
          element={
            <RequirePermission permission="daily_report.mark_update">
              <DailyExpenseStub />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTES.organization}
          element={
            <RequirePermission permission="status.view">
              <OrganizationStub />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTES.reports}
          element={
            <RequirePermission permission="daily_report.generate">
              <ReportsStub />
            </RequirePermission>
          }
        />
        <Route
          path={ROUTES.audit}
          element={
            <RequirePermission permission="audit.view">
              <AuditStub />
            </RequirePermission>
          }
        />
      </Route>
    </Routes>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}

export default App
