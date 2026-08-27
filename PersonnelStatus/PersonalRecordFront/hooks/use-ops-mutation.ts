"use client";

// Единая точка ветвления ошибок мутаций раздела ОМ по каналам:
//   400 OpsValidationError            → onFormError(details) — сырьё для RHF setError;
//   409 OpsConflictError overridable  → conflict-state (общий ConflictDialog);
//   5xx OpsServerError | NetworkError → тост, generic-текст БЕЗ деталей;
//   остальное (422, non-overridable 409, 401/403/404) → только mutation.error,
//   рендер — забота фичи.
// Повтор с override — осознанное действие пользователя с новым телом, не авто-ретрай.
import { useCallback, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  OpsConflictError,
  OpsNetworkError,
  OpsServerError,
  OpsValidationError,
} from "@/lib/ops-errors";
import type { OpsApiFailure } from "@/lib/ops-errors";
import { useToast } from "@/shared/hooks/use-toast";

/** Generic-текст тоста 5xx/network: без деталей наружу. */
export const OPS_GENERIC_FAILURE_MESSAGE =
  "Не удалось выполнить операцию: сервис временно недоступен. Попробуйте ещё раз.";

export interface UseOpsMutationOptions<
  TData,
  TVariables extends Record<string, unknown>,
> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  onSuccess?: (data: TData, variables: TVariables) => void;
  /** Канал формы: детали ошибок по полям (для RHF setError). */
  onFormError?: (details: Record<string, unknown>) => void;
}

export interface UseOpsMutationResult<
  TData,
  TVariables extends Record<string, unknown>,
> {
  mutate: (variables: TVariables) => void;
  /**
   * То же, но с ожиданием (Plane №239). Нужен там, где две мутации идут В ОДНУ
   * И ТУ ЖЕ строку и порядок между ними несущий: смена роли наряда — это
   * снятие с поста и назначение заново, и запущенные разом они гонятся —
   * снятие удаляет только что созданное назначение. Обычный `mutate` такой
   * последовательности выразить не может.
   */
  mutateAsync: (variables: TVariables) => Promise<TData>;
  isPending: boolean;
  error: OpsApiFailure | null;
  /** Открытый overridable-конфликт (канал ConflictDialog); null = диалога нет. */
  conflict: OpsConflictError | null;
  /** Повтор один раз: исходное тело + override: true + override_reason. */
  confirmOverride: (reason: string) => void;
  /** «Отмена»: повтора нет, conflict сбрасывается, ошибка остаётся в error. */
  dismissConflict: () => void;
  /**
   * Полный сброс к idle: error, data и conflict. Обязателен фичам, где
   * повторный вход в путь гардится производной от error — без reset ошибка
   * держала бы путь закрытым до ремаунта.
   */
  reset: () => void;
  data: TData | undefined;
}

export function useOpsMutation<
  TData,
  TVariables extends Record<string, unknown>,
>(
  options: UseOpsMutationOptions<TData, TVariables>
): UseOpsMutationResult<TData, TVariables> {
  const { mutationFn, onSuccess, onFormError } = options;
  const { toast } = useToast();
  // conflict — UI-state диалога; ставится из onError, не из эффекта
  // (идемпотентность под React StrictMode)
  const [conflict, setConflict] = useState<OpsConflictError | null>(null);
  const lastVariablesRef = useRef<TVariables | null>(null);

  const mutation = useMutation<TData, OpsApiFailure, TVariables>({
    mutationFn,
    retry: false,
    onSuccess: (data, variables) => {
      setConflict(null);
      onSuccess?.(data, variables);
    },
    onError: (error) => {
      if (error instanceof OpsValidationError) {
        onFormError?.(error.details);
        return;
      }
      if (error instanceof OpsConflictError && error.overridable) {
        setConflict(error);
        return;
      }
      if (error instanceof OpsServerError || error instanceof OpsNetworkError) {
        toast({
          variant: "destructive",
          description: OPS_GENERIC_FAILURE_MESSAGE,
        });
      }
      // остальное — фиче достаточно mutation.error
    },
  });

  const { mutate: rawMutate } = mutation;

  const mutate = useCallback(
    (variables: TVariables) => {
      lastVariablesRef.current = variables;
      setConflict(null); // новая мутация — прежний конфликт неактуален
      rawMutate(variables);
    },
    [rawMutate]
  );

  const confirmOverride = useCallback(
    (reason: string) => {
      const last = lastVariablesRef.current;
      if (last === null) return; // конфликта без исходного mutate не бывает
      setConflict(null);
      // спред исходного тела + два поля протокола override; каст — TS не
      // докажет, что TVariables переживает добавление ключей
      rawMutate({
        ...last,
        override: true,
        override_reason: reason,
      } as TVariables);
    },
    [rawMutate]
  );

  const dismissConflict = useCallback(() => {
    setConflict(null);
  }, []);

  const { reset: rawReset } = mutation;

  const reset = useCallback(() => {
    setConflict(null);
    rawReset();
  }, [rawReset]);

  const { mutateAsync: rawMutateAsync } = mutation;

  const mutateAsync = useCallback(
    (variables: TVariables) => {
      // Тело запоминается так же, как в `mutate`: повтор с обходом
      // (`confirmOverride`) должен работать и после ожидающего вызова.
      lastVariablesRef.current = variables;
      return rawMutateAsync(variables);
    },
    [rawMutateAsync]
  );

  return {
    mutate,
    mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    conflict,
    confirmOverride,
    dismissConflict,
    reset,
    data: mutation.data,
  };
}
