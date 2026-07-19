// UI-половина протокола ошибок §36 (ARCH-FE-015, стори 8.5; транспорт — 8.4).
// ЕДИНСТВЕННАЯ точка ветвления ApiError-union по каналам:
//   400 ValidationError            → onFormError(details) — сырьё для RHF setError (Д3);
//   409 ConflictError overridable  → conflict-state (общий ConflictDialog);
//   5xx ServerError | NetworkError → глобальный тост, generic БЕЗ деталей (UX L208);
//   остальное (422, non-overridable 409, 401/403/404 базовый ApiError)
//                                  → только mutation.error (рендер — фича; 401 — 8.6).
// Сырой useMutation в src/features/** забанен eslint-ом; здесь (shared/api) легален.
// Авто-ретраев нет (канон L472, retry: false в QueryClient); повтор с override —
// осознанное действие пользователя с НОВЫМ телом (L242), не авто-ретрай.
import { useCallback, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  ConflictError,
  NetworkError,
  ServerError,
  ValidationError,
} from './errors'
import type { ApiFailure } from './errors'
import { useToast } from '../ui/toast'

/** Generic-текст тоста 5xx/network: БЕЗ деталей наружу (UX L208). */
export const GENERIC_FAILURE_MESSAGE =
  'Не удалось выполнить операцию: сервис временно недоступен. Попробуйте ещё раз.'

export interface UseApiMutationOptions<
  TData,
  TVariables extends Record<string, unknown>,
> {
  mutationFn: (variables: TVariables) => Promise<TData>
  onSuccess?: (data: TData, variables: TVariables) => void
  /** Канал формы: DRF-details по полям (совместимо с будущим RHF setError, Д3). */
  onFormError?: (details: Record<string, unknown>) => void
}

export interface UseApiMutationResult<
  TData,
  TVariables extends Record<string, unknown>,
> {
  mutate: (variables: TVariables) => void
  isPending: boolean
  error: ApiFailure | null
  /** Открытый overridable-конфликт (канал ConflictDialog); null = диалога нет. */
  conflict: ConflictError | null
  /** Повтор ОДИН раз: исходное тело + override: true + override_reason (snake_case, L429). */
  confirmOverride: (reason: string) => void
  /** «Отмена»: повтора нет, conflict сбрасывается, ошибка остаётся в error. */
  dismissConflict: () => void
  /**
   * Полный сброс к idle: error, data и conflict. Нужен фичам, где ПОВТОРНЫЙ
   * вход в путь гардится производной от `error` (10.6: форма исправления
   * закрыта, пока висит 409/404) — без сброса ошибка держала бы путь закрытым
   * до ремаунта, т.к. сама очищается только следующим mutate.
   */
  reset: () => void
  data: TData | undefined
}

export function useApiMutation<
  TData,
  TVariables extends Record<string, unknown>,
>(
  options: UseApiMutationOptions<TData, TVariables>,
): UseApiMutationResult<TData, TVariables> {
  const { mutationFn, onSuccess, onFormError } = options
  const { toast } = useToast()
  // conflict — UI-state диалога, не дубль серверных данных (ARCH-FE-010 не нарушен);
  // из onError, не из эффекта (StrictMode-идемпотентность, Ловушка 7)
  const [conflict, setConflict] = useState<ConflictError | null>(null)
  const lastVariablesRef = useRef<TVariables | null>(null)

  const mutation = useMutation<TData, ApiFailure, TVariables>({
    mutationFn,
    onSuccess: (data, variables) => {
      setConflict(null)
      onSuccess?.(data, variables)
    },
    onError: (error) => {
      if (error instanceof ValidationError) {
        onFormError?.(error.details)
        return
      }
      if (error instanceof ConflictError && error.overridable) {
        setConflict(error)
        return
      }
      if (error instanceof ServerError || error instanceof NetworkError) {
        toast(GENERIC_FAILURE_MESSAGE)
      }
      // остальное — фиче достаточно mutation.error
    },
  })

  const { mutate: rawMutate } = mutation

  const mutate = useCallback(
    (variables: TVariables) => {
      lastVariablesRef.current = variables
      setConflict(null) // новая мутация — прежний конфликт неактуален
      rawMutate(variables)
    },
    [rawMutate],
  )

  const confirmOverride = useCallback(
    (reason: string) => {
      const last = lastVariablesRef.current
      if (last === null) return // конфликта без исходного mutate не бывает
      setConflict(null)
      // спред исходного тела + ДВА поля протокола — зеркало kwargs сервиса (Д1);
      // каст: TS не докажет, что TVariables переживает добавление ключей
      rawMutate({
        ...last,
        override: true,
        override_reason: reason,
      } as TVariables)
    },
    [rawMutate],
  )

  const dismissConflict = useCallback(() => {
    setConflict(null)
  }, [])

  const { reset: rawReset } = mutation

  const reset = useCallback(() => {
    setConflict(null)
    rawReset()
  }, [rawReset])

  return {
    mutate,
    isPending: mutation.isPending,
    error: mutation.error,
    conflict,
    confirmOverride,
    dismissConflict,
    reset,
    data: mutation.data,
  }
}
