"use client";

// Кадровые справочники: чтение и правка под правом `dictionary.manage`.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import {
  staffDictionaryOf,
  staffDictionaryRowPath,
  type StaffDictionaryResponse,
  type StaffDictionaryRow,
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
  };
}

export function useCreateStaffDictionaryRow(kind: string) {
  const invalidate = useInvalidate(kind);
  const meta = staffDictionaryOf(kind);
  return useMutation<StaffDictionaryRow, Error, Omit<StaffDictionaryRow, "id">>({
    mutationFn: (body) =>
      opsApiClient.post<StaffDictionaryRow>(meta!.path, body),
    onSuccess: invalidate,
  });
}

export function useUpdateStaffDictionaryRow(kind: string) {
  const invalidate = useInvalidate(kind);
  return useMutation<StaffDictionaryRow, Error, StaffDictionaryRow>({
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
  return useMutation<void, Error, { id: number }>({
    mutationFn: ({ id }) =>
      opsApiClient.del<void>(staffDictionaryRowPath(kind, id)),
    onSuccess: invalidate,
  });
}
