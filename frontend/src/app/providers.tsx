// Композиция провайдеров приложения (ARCH L550: providers живут в app/;
// shared не может импортировать app — контексты живут в shared, app монтирует).
// Канон §Process L472 «мутации не ретраить» → retry: false в дефолтах mutations;
// query-политики для ['me'] — дефолтные (Д10: отзыв прав — серверная гарантия
// ARCH-SEC-031, клиентский кэш — UX-слой).
import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { AuthProvider } from '../shared/auth/AuthContext'
import { handle401 } from '../shared/auth/handle401'
import { ToastProvider } from '../shared/ui/toast'

export function createQueryClient(): QueryClient {
  // 401-механика (Д7, AC 6): ЛЮБОЙ запрос — query И mutation — через единую
  // handle401 (shared/auth; там же — канал прямых fetch вне React Query,
  // например blob-download 10.5). Ветвление — по типизированному
  // ApiError.status (ARCH-FE-015: парсинга Response тут нет).
  // chicken-egg «onError нужен client до его создания» — замыкание читает
  // биндинг client, инициализируемый ниже (onError зовётся только после).
  const on401 = (error: unknown): void => {
    handle401(error, client)
  }
  const client = new QueryClient({
    queryCache: new QueryCache({ onError: on401 }),
    mutationCache: new MutationCache({ onError: on401 }),
    defaultOptions: {
      mutations: { retry: false },
    },
  })
  return client
}

export function Providers({ children }: { children: ReactNode }) {
  // useState-инициализатор: один QueryClient на жизнь дерева (StrictMode-safe)
  const [queryClient] = useState(createQueryClient)
  return (
    <QueryClientProvider client={queryClient}>
      {/* AuthProvider ВНУТРИ Query-провайдера: logout() зовёт useQueryClient */}
      <AuthProvider>
        <ToastProvider>{children}</ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
