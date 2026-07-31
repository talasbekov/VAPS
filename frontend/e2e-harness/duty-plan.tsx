// Story 14.12b — e2e-харнес полного цикла плана дежурств.
//
// Монтируется НАСТОЯЩИЙ AppRoutes + Providers (app/App.tsx, app/providers.tsx)
// — тот же композиционный корень, что боевое приложение, тот же приём, что
// notifications.tsx (11.4)/day-submission.tsx (10.3): «features → app»
// запрещён линтом ТОЛЬКО внутри src/ (ARCH-FE-013, boundaries/include:
// src/**/*) — e2e-harness/ вне src/, импорт из ../src/app легален.
//
// Сеть НЕ мокается здесь (в отличие от MSW-режима dev:mock) — её перехватывает
// page.route спеки, реальный fetch/статусы/конверт §36, тот же приём, что
// day-submission.tsx (10.3): jsdom этого класса багов не видит по построению
// (настоящая модальность <dialog>, настоящий datetime-local, настоящая
// навигация между /duty-plans и /duty-plans/:id).
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'

import { AppRoutes } from '../src/app/App'
import { Providers } from '../src/app/providers'
import { setCredential } from '../src/shared/auth/credential'
import '../src/index.css'

// Прямое присвоение credential (не addInitScript спеки) — тот же приём, что
// notifications.tsx (11.4): harness сам себе оператор, спека мокает только
// /api/operations/my-permissions/ + /duty-plans/*.
setCredential({ kind: 'dev', userId: 'duty-operator-e2e' })

createRoot(document.getElementById('root')!).render(
  // Без StrictMode: двойной монтаж удвоил бы запросы — та же причина, что
  // day-submission.tsx/notifications.tsx.
  <Providers>
    <MemoryRouter initialEntries={['/duty-plans']}>
      <AppRoutes />
    </MemoryRouter>
  </Providers>,
)
