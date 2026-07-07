// Минимальный роутер 8.6 (Д3, ARCH-FE-012): plain Routes, пути — только
// константы ROUTES. Живые маршруты — /login и / (Home за RequireAuth);
// полная карта (UX L59-68), layout и разводка по правам — 8.7.
import { BrowserRouter, Route, Routes } from 'react-router'
import { LoginPage } from '../features/auth/LoginPage'
import { RequireAuth } from '../shared/auth/guards'
import { ROUTES } from '../shared/routes'

// Заглушка 8.1 в роли Home; экраны появятся в 8.7+
function Home() {
  return (
    <main>
      <h1>PersonnelStatus</h1>
      <p>Каркас портала. Экраны появятся в сториях 8.6–8.7.</p>
    </main>
  )
}

// Экспорт отдельно от BrowserRouter: E2E-тесты оборачивают AppRoutes в
// MemoryRouter с initialEntries (BrowserRouter не даёт задать стартовый маршрут)
export function AppRoutes() {
  return (
    <Routes>
      <Route path={ROUTES.login} element={<LoginPage />} />
      <Route
        path={ROUTES.home}
        element={
          <RequireAuth>
            <Home />
          </RequireAuth>
        }
      />
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
