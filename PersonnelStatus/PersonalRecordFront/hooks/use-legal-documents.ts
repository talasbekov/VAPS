"use client";

// Нормативная база ОМ. Справочник читается целиком: поиск и фильтр по виду —
// на клиенте, серверных параметров у ручки нет.
import { useQuery } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";
import { LEGAL_DOCUMENTS_PATH } from "@/entities/legal-document";
import type { ListLegalDocumentsResponse } from "@/entities/legal-document";

export function useLegalDocuments(options: { enabled?: boolean } = {}) {
  return useQuery<ListLegalDocumentsResponse, OpsApiFailure>({
    queryKey: ["ops-legal-documents"],
    queryFn: () =>
      opsApiClient.get<ListLegalDocumentsResponse>(LEGAL_DOCUMENTS_PATH),
    enabled: options.enabled ?? true,
  });
}
