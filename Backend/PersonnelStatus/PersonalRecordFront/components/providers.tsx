"use client"

import { SessionProvider, useSession } from "next-auth/react"
import { AuthProvider } from "@/lib/auth"
import { useEffect, useRef, type ReactNode } from "react"
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query"
import { ThemeProvider } from "next-themes"
import { MotionConfig } from "framer-motion"
import { currentOpsAuthorityStamp, registerOpsWriteAuthority } from "@/lib/ops-write-authority"
import { NavigationSectionProvider } from "@/components/navigation/section-navigation"
import { GlobalAssistantProvider } from "@/features/assistant-dock/assistant-dock"

function OpsWriteAuthority() {
  const client = useQueryClient()
  const { data: session, status } = useSession()
  const actor = useRef<string | null>(null)
  const user = session?.user as { id?: string; email?: string | null } | undefined
  actor.current = status === "authenticated" && (session as { error?: string } | null)?.error === undefined
    ? user?.id ?? user?.email ?? null : null
  useEffect(() => registerOpsWriteAuthority(() => currentOpsAuthorityStamp(client, actor.current)), [client])
  return null
}

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
          {/* 🔴 СЕССИЯ ПЕРЕЧИТЫВАЕТСЯ ПО ЧАСАМ, А НЕ ТОЛЬКО ПО ФОКУСУ
              (Plane №460). Увод на форму входа висит на эффекте, зависящем
              от `session` из `useSession()`, а тот обновляется лишь при
              монтировании и при возврате фокуса в окно. Человек, который
              восемь часов работает в ОДНОЙ вкладке и никуда не переключается,
              получал исходный симптом №383: меню на месте, на каждом экране
              «не удалось загрузить», на вход не уводит. Разбудить `useSession`
              своей же вкладке нечем — next-auth рассылает событие через
              `localStorage`, а storage-событие в породившей его вкладке не
              срабатывает.

              Минута выбрана по цене: чтение сессии — локальный запрос к
              своему же Next, а окно продления токена и так минутное
              (`EXPIRY_SKEW_MS`), так что реже значило бы узнавать об отказе
              позже, чем он случился. */}
          <SessionProvider refetchInterval={60}>
            <OpsWriteAuthority />
            <AuthProvider><NavigationSectionProvider><GlobalAssistantProvider>{children}</GlobalAssistantProvider></NavigationSectionProvider></AuthProvider>
          </SessionProvider>
        </QueryClientProvider>
      </MotionConfig>
    </ThemeProvider>
  )
}








