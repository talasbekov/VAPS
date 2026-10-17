"use client";

// Кадровые справочники: чтение по `dictionary.view`, правка под `dictionary_value.manage`.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import {
  staffDictionaryOf,
  staffDictionaryRowActionPath,
  staffDictionaryRowPath,
  type RemoveStaffDictionaryRowResult,
  type StaffDictionaryResponse,
  type StaffDictionaryRow,
  type StaffDictionaryWrite,
} from "@/entities/staff-dictionary";

/** Ручка отвечает конвертом DRF либо голым списком — читаем оба. */
function rowsOf(data: StaffDictionaryResponse | StaffDictionaryRow[]): StaffDictionaryRow[] {
  if (Array.isArray(data)) return data;
  return data.results ?? [];
}

export function useStaffDictionary(kind: string) {
  const meta = staffDictionaryOf(kind);
  return useQuery<StaffDictionaryRow[]>({
    queryKey: ["staff-dictionary", kind],
    enabled: meta !== null,
    queryFn: async () => {
      // page_size крупный: справочник должностей короткий, но постраничность
      // ручки уже один раз обрезала данные молча (Plane №269) — второй раз
      // наступать на это не будем.
      const data = await opsApiClient.get<StaffDictionaryResponse>(
        `${meta!.path}?page_size=500`
      );
      return rowsOf(data);
    },
  });
}

function useInvalidate(kind: string) {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ["staff-dictionary", kind] });
    void client.invalidateQueries({ queryKey: [kind] });
    void client.invalidateQueries({ queryKey: [`core-${kind}`] });
    void client.invalidateQueries({ queryKey: ["ops-dictionaries"] });
  };
}

export function useCreateStaffDictionaryRow(kind: string) {
  const invalidate = useInvalidate(kind);
  const meta = staffDictionaryOf(kind);
  return useMutation<StaffDictionaryRow, Error, StaffDictionaryWrite>({
    mutationFn: (body) =>
      opsApiClient.post<StaffDictionaryRow>(meta!.path, body),
    onSuccess: invalidate,
  });
}

export function useUpdateStaffDictionaryRow(kind: string) {
  const invalidate = useInvalidate(kind);
  return useMutation<
    StaffDictionaryRow,
    Error,
    Partial<StaffDictionaryWrite> & { id: number }
  >({
    mutationFn: ({ id, ...body }) =>
      opsApiClient.patch<StaffDictionaryRow>(
        staffDictionaryRowPath(kind, id),
        body
      ),
    onSuccess: invalidate,
  });
}

export function useDeleteStaffDictionaryRow(kind: string) {
  const invalidate = useInvalidate(kind);
  return useMutation<RemoveStaffDictionaryRowResult, Error, { id: number }>({
    mutationFn: async ({ id }) => {
      // 204 — удалено; 200 с телом — деактивировано по связям (UC-REF-001).
      const body = await opsApiClient.del<
        RemoveStaffDictionaryRowResult | undefined
      >(staffDictionaryRowPath(kind, id));
      return body ?? { result: "deleted" };
    },
    onSuccess: invalidate,
  });
}

export function useSetStaffDictionaryRowActive(kind: string) {
  const invalidate = useInvalidate(kind);
  return useMutation<StaffDictionaryRow, Error, { id: number; is_active: boolean }>({
    mutationFn: ({ id, is_active }) =>
      opsApiClient.post<StaffDictionaryRow>(
        staffDictionaryRowActionPath(kind, id, "set-active"),
        { is_active }
      ),
    onSuccess: invalidate,
  });
}

export function useSupersedeStaffDictionaryRow(kind: string) {
  const invalidate = useInvalidate(kind);
  return useMutation<
    StaffDictionaryRow,
    Error,
    StaffDictionaryWrite & { id: number }
  >({
    mutationFn: ({ id, ...body }) =>
      opsApiClient.post<StaffDictionaryRow>(
        staffDictionaryRowActionPath(kind, id, "supersede"),
        body
      ),
    onSuccess: invalidate,
  });
}
