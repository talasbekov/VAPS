// Story 16.8i — e2e-харнес полного интерактивного цикла Расстановки.
//
// Монтируется НАСТОЯЩИЙ AppRoutes + Providers (тот же приём, что
// duty-plan.tsx, 14.12b) — цикл сам по себе многостраничный
// (/placement → /placement/:id), нужна реальная навигация через <Link>,
// не голый компонент. Сеть перехватывает page.route спеки, не MSW.
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'

import { AppRoutes } from '../src/app/App'
import { Providers } from '../src/app/providers'
import { setCredential } from '../src/shared/auth/credential'
import '../src/index.css'

setCredential({ kind: 'dev', userId: 'placement-operator-e2e' })

createRoot(document.getElementById('root')!).render(
  <Providers>
    <MemoryRouter initialEntries={['/placement']}>
      <AppRoutes />
    </MemoryRouter>
  </Providers>,
)
