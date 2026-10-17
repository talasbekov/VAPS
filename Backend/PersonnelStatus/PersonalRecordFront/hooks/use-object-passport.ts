"use client";

// Мутации паспорта объекта: правка действующей редакции и публикация версии.
// Обе идут через use-ops-mutation (каналы 400/409/5xx) и после успеха кладут
// свежий объект в кэш + инвалидируют список.
import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { opsApiClient } from "@/lib/ops-api";
import { useOpsMutation } from "@/hooks/use-ops-mutation";
import {
  objectPassportPath,
  objectPassportVersionsPath,
  type PublishPassportVersionRequest,
  type SecurityObject,
  type UpdatePassportRequest,
} from "@/entities/security-object";

export function useUpdatePassport(id: string, onSaved?: () => void, isCurrentResult?: () => boolean) {
  const queryClient = useQueryClient();
  const submittedContexts = useRef(new WeakMap<UpdatePassportRequest, (() => boolean) | undefined>());
  return useOpsMutation<SecurityObject, UpdatePassportRequest>({
    mutationFn: (body) => {
      submittedContexts.current.set(body, isCurrentResult);
      return opsApiClient.patch<SecurityObject>(objectPassportPath(id), body);
    },
    onSuccess: (data, body) => {
      if (submittedContexts.current.get(body)?.() === false) {
        void queryClient.invalidateQueries({ queryKey: ["ops-objects"] });
        return;
      }
      queryClient.setQueryData(["ops-objects", id], data);
      void queryClient.invalidateQueries({ queryKey: ["ops-objects"] });
      // Сигнал «сохранил Я»: по нему форму можно пересобрать от свежего
      // серверного состояния, не трогая её на чужих обновлениях.
      onSaved?.();
    },
  });
}

export function usePublishPassportVersion(id: string, onPublished?: () => void, isCurrentResult?: () => boolean) {
  const queryClient = useQueryClient();
  const submittedContexts = useRef(new WeakMap<PublishPassportVersionRequest, (() => boolean) | undefined>());
  return useOpsMutation<SecurityObject, PublishPassportVersionRequest>({
    mutationFn: (body) => {
      submittedContexts.current.set(body, isCurrentResult);
      return opsApiClient.post<SecurityObject>(objectPassportVersionsPath(id), body);
    },
    onSuccess: (data, body) => {
      if (submittedContexts.current.get(body)?.() === false) {
        void queryClient.invalidateQueries({ queryKey: ["ops-objects"] });
        return;
      }
      queryClient.setQueryData(["ops-objects", id], data);
      void queryClient.invalidateQueries({ queryKey: ["ops-objects"] });
      onPublished?.();
    },
  });
}
