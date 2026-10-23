import { opsApiClient } from "@/lib/ops-api";

export interface StatusDocument {
  id: number;
  title: string;
  file_url: string | null;
}

export async function fetchStatusDocuments(statusId: number): Promise<StatusDocument[]> {
  const detail = await opsApiClient.get<{ documents: StatusDocument[] }>(
    `/api/statuses/statuses/${statusId}/`,
  );
  return detail.documents;
}

export async function downloadStatusDocument(statusId: number, document: StatusDocument) {
  const endpoint = `/api/statuses/statuses/${statusId}/documents/${document.id}/content/`;
  // Never forward authentication to arbitrary URLs from stored metadata.
  if (document.file_url !== endpoint) {
    throw new Error("Некорректная ссылка на документ статуса");
  }
  return opsApiClient.download(endpoint);
}
