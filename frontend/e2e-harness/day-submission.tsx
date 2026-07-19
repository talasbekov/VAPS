// Story 10.3 (QA-добор) — e2e-харнес ЭКРАНА сдачи дня.
//
// Зачем отдельный вход, а не правка index.html: харнес 9.9 монтирует ГРИД без
// провайдеров и считает React-коммиты — его спека завязана на этот счётчик.
// Дописать туда экран значило бы менять предмет чужой спеки. Второй вход той
// же сборки dist-e2e прод-бандл и size-gate не задевает (Ловушка №3 стори 9.9).
//
// Здесь монтируется НАСТОЯЩИЙ DailyUpdatePage — тот же компонент, что в
// приложении, с теми же провайдерами, что даёт app/providers (features → app
// импортировать нельзя, ARCH-FE-013, поэтому обёртка локальная — тот же приём,
// что в renderPage() юнит-тестов).
//
// Сеть НЕ мокается здесь: её перехватывает page.route спеки — реальный fetch,
// реальные статусы, реальный разбор конверта §36. jsdom-теста это не заменяет,
// а дополняет: тут проверяется то, чего jsdom не умеет — настоящий порядок
// табуляции, настоящий disabled на кнопке во время полёта запроса и настоящий
// capture-перехват Ctrl+Enter поверх смонтированной панели.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'

import { DailyUpdatePage } from '../src/features/daily-grid/DailyUpdatePage'
import { ToastProvider } from '../src/shared/ui/toast'
import '../src/index.css'

// retry: false — как в app/providers для мутаций; для запросов в харнесе тоже,
// иначе спека отказа ждала бы бэкоффы и стала бы флейки по таймауту.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})

createRoot(document.getElementById('root')!).render(
  // Без StrictMode: двойной монтаж удвоил бы запросы, и ассерт «ровно один
  // POST» перестал бы значить то, что значит в приложении.
  <QueryClientProvider client={queryClient}>
    <ToastProvider>
      <DailyUpdatePage />
    </ToastProvider>
  </QueryClientProvider>,
)
