// Роутер портала (ARCH-FE-012): plain Routes, пути — только константы ROUTES
// (literal-пути ловит eslint no-restricted-syntax, ужесточение 8.7).
// Layout-route: RequireAuth (credential-гейт) → AppLayout (каркас) → вложенные
// разделы, каждый за своим RequirePermission (карта гейтов — UX L59-68, коды
// из seed_operations дословно). Разделы пока — заглушки app/section-stubs
// (экраны — E9/E10). /admin/* в карте нет (Д5); catch-all/404 не в карте UX.
import { BrowserRouter, Route, Routes } from 'react-router'
import { LoginPage } from '../features/auth/LoginPage'
import { ChangelogPage } from '../features/changelog/ChangelogPage'
import { DailyExpensePage } from '../features/daily-grid/DailyExpensePage'
import { ExpenseReportPage } from '../features/expense-report/ExpenseReportPage'
import { ExpensePrintPage } from '../features/print-forms/ExpensePrintPage'
import { PrintTestPage } from '../features/print-forms/PrintTestPage'
import { ReadinessTreePage } from '../features/readiness-tree/ReadinessTreePage'
import { RequireAuth, RequirePermission } from '../shared/auth/guards'
import { ROUTES } from '../shared/routes'
import { AppLayout } from '../shared/ui/AppLayout'
import { AuditStub, DashboardStub, EmployeesStub } from './section-stubs'

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
      {/* Story 10.7: печатная форма расхода — сиблинг layout-route (на бумагу
          сайдбар/шапка не попадают), но в отличие от тест-страницы 8.8 здесь
          РЕАЛЬНЫЕ данные → RequirePermission("daily_report.generate") —
          зеркало backend-гейта period (_EXPENSE_PERMISSION, api/views.py:84). */}
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
              <EmployeesStub />
            </RequirePermission>
          }
        />
        {/* Story 10.2: реальный экран «Расход дня» вместо заглушки; гейт
            права daily_report.mark_update НЕ меняется (карта UX L59-68). */}
        <Route
          path={ROUTES.dailyExpense}
          element={
            <RequirePermission permission="daily_report.mark_update">
              <DailyExpensePage />
            </RequirePermission>
          }
        />
        {/* Story 10.4: экран «Готовность сдачи» (светофор-дерево) вместо
            заглушки; гейт права status.view НЕ меняется (карта UX L59-68). */}
        <Route
          path={ROUTES.organization}
          element={
            <RequirePermission permission="status.view">
              <ReadinessTreePage />
            </RequirePermission>
          }
        />
        {/* Story 10.5: экран «Расход» (выпуск + журнал) вместо заглушки;
            гейт права daily_report.generate НЕ меняется (карта UX L59-68). */}
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
              <AuditStub />
            </RequirePermission>
          }
        />
        {/* Story 10.9: журнал «сообщено → исправлено» — НАМЕРЕННО БЕЗ
            RequirePermission (единственный такой раздел в карте): architecture
            L145 и AC 13.4 — журнал «доступный пользователям», т.е. любому
            авторизованному (credential-гейт RequireAuth на layout-route
            остаётся). НЕ «чинить» добавлением permission-гейта. */}
        <Route path={ROUTES.changelog} element={<ChangelogPage />} />
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
