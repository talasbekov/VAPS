"use client";

// Нормативная база ОМ. Справочник читается целиком: поиск и фильтр по виду —
// на клиенте, серверных параметров у ручки нет.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isReadAccessBlocked, readWithAccessCheck } from "@/lib/query-read-access";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";
import { LEGAL_DOCUMENTS_PATH } from "@/entities/legal-document";
import type { ListLegalDocumentsResponse } from "@/entities/legal-document";

export function useLegalDocuments(options: { enabled?: boolean } = {}) {
  const client = useQueryClient();
  const key = ["ops-legal-documents"] as const;
  const query = useQuery<ListLegalDocumentsResponse, OpsApiFailure>({
    queryKey: ["ops-legal-documents"],
    queryFn: ({ signal, queryKey }) => readWithAccessCheck(client, queryKey, signal, () =>
      opsApiClient.get<ListLegalDocumentsResponse>(LEGAL_DOCUMENTS_PATH)),
    enabled: options.enabled ?? true,
  });
  return { ...query, readAccessBlocked: isReadAccessBlocked(client, key) };
}
