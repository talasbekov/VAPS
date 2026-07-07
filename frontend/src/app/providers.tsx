// Композиция провайдеров приложения (ARCH L550: providers живут в app/;
// shared не может импортировать app — контексты живут в shared, app монтирует).
// Канон §Process L472 «мутации не ретраить» → retry: false в дефолтах mutations;
// query-политики осознанно НЕ конфигурируются (Д6 — не стори 8.5).
import { useState } from 'react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../shared/ui/toast'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
    },
  })
}

export function Providers({ children }: { children: ReactNode }) {
  // useState-инициализатор: один QueryClient на жизнь дерева (StrictMode-safe)
  const [queryClient] = useState(createQueryClient)
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  )
}
