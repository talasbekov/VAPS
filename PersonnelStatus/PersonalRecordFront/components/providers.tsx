"use client"

import { SessionProvider } from "next-auth/react"
import { AuthProvider } from "@/lib/auth"
import { type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "next-themes"
import { MotionConfig } from "framer-motion"

/**
 * Повтор — только там, где он что-то меняет.
 *
 * `retry: 1` без разбора повторял и 401/403/404: ответ на них тот же самый, а
 * человек ждал вдвое дольше — и вдвое дольше видел «Загрузка…» вместо отказа.
 * Повторяем сетевые обрывы (статуса нет вовсе) и 5xx.
 */
function retryOnlyTransient(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false
  const status = (error as { status?: unknown } | null)?.status
  if (typeof status !== "number") return true // обрыв сети — ответа не было
  return status >= 500
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 минута
      refetchOnWindowFocus: false,
      retry: retryOnlyTransient,
    },
  },
})

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      {/* reducedMotion="user": движение framer-motion живёт в inline-стилях и
          медиа-правилом в globals.css не гасится — это его выключатель. */}
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <AuthProvider>{children}</AuthProvider>
          </SessionProvider>
        </QueryClientProvider>
      </MotionConfig>
    </ThemeProvider>
  )
}








