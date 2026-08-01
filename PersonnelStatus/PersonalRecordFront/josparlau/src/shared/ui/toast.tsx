// Минимальный глобальный тост протокола ошибок (стори 8.5, канал «5xx/network»
// ARCH-FE-015). Headless-минимум: Context + постоянный aria-live регион
// (role="status" всегда в DOM — screen-reader'ы не ловят динамически созданные
// live-регионы), авто-dismiss таймером. Осознанно НЕТ: sonner/notistack (не
// донорские, инжектят стили — конфликт с ARCH-FE-014 по духу), очередей/стека
// (минимум 8.5), порталов. Рескин на донорский примитив — 8.7.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'

export interface ToastContextValue {
  /** Показать глобальное сообщение (aria-live polite, авто-скрытие). */
  toast(message: string): void
}

const ToastContext = createContext<ToastContextValue | null>(null)

/** Время жизни сообщения; экспорт — для тестов с fake timers. */
export const TOAST_AUTO_DISMISS_MS = 6000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const toast = useCallback((next: string) => {
    setMessage(next)
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setMessage(null)
    }, TOAST_AUTO_DISMISS_MS)
  }, [])

  // очистка таймера на unmount: setState после unmount — утечка/ворнинг
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    },
    [],
  )

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div role="status" aria-live="polite">
        {message}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (ctx === null) {
    throw new Error(
      'useToast вне ToastProvider — оберните приложение в Providers (src/app/providers.tsx)',
    )
  }
  return ctx
}
