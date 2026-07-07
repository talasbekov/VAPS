// Auth-контекст (один из 2 канонных Context, ARCH-FE-010): хранит ТОЛЬКО
// клиентский credential-state («кто вошёл»), НЕ права — права живут
// исключительно в Query-кэше ['me'] (usePermissions). Контекст живёт в shared,
// app монтирует (providers.tsx L1-2).
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from 'react'
import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  clearCredential,
  getSnapshot,
  setCredential,
  subscribe,
} from './credential'
import type { Credential } from './credential'

export interface AuthContextValue {
  /**
   * Идентификатор вошедшего (dev-путь). Для JWT — null: SPA токен не
   * разбирает (sub извлекает бэк, ARCH-SEC-030), профиля-API нет (Д4).
   */
  userId: string | null
  login(credential: Credential): void
  logout(): void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  // AuthProvider обязан жить ВНУТРИ QueryClientProvider (Ловушка 9)
  const queryClient = useQueryClient()
  // useSyncExternalStore, не useState+useEffect (StrictMode-safe, Ловушка 7)
  const credential = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const login = useCallback(
    (next: Credential) => {
      setCredential(next)
      // смена пользователя БЕЗ logout: ['me'] прежнего не должен пережить новый
      // credential (queryKey не меняется — сам кэш рефетч не запустит);
      // removeQueries, не invalidate — заголовки уже новые, рефетч чистый
      queryClient.removeQueries({ queryKey: ['me'] })
    },
    [queryClient],
  )

  const logout = useCallback(() => {
    clearCredential()
    // removeQueries, НЕ invalidate: рефетч без credential словил бы 403 (Ловушка 4)
    queryClient.removeQueries({ queryKey: ['me'] })
  }, [queryClient])

  const value = useMemo<AuthContextValue>(
    () => ({
      userId: credential?.kind === 'dev' ? credential.userId : null,
      login,
      logout,
    }),
    [credential, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (value === null) {
    throw new Error('useAuth вызван вне <AuthProvider>')
  }
  return value
}
