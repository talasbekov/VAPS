import { opsApiClient } from "@/lib/ops-api";

/** Persisted notifications may still contain the old route. */
export function reportDownloadEndpoint(link: string | null): string | null {
  const match = /^\/api\/reports\/(?:reports\/)?([1-9]\d*)\/download\/$/.exec(link ?? "");
  return match ? `/api/reports/reports/${match[1]}/download/` : null;
}

export async function fetchNotificationReport(endpoint: string) {
  const canonical = reportDownloadEndpoint(endpoint);
  if (!canonical) throw new Error("Некорректная ссылка на отчёт");
  const response = await opsApiClient.get<{ download_url: string }>(canonical);
  const expectedContent = canonical.replace(/download\/$/, "content/");
  // Never forward the access token to a URL supplied by the response.
  if (response.download_url !== expectedContent) {
    throw new Error("Сервис вернул некорректную ссылку на файл отчёта");
  }
  return opsApiClient.download(expectedContent);
}
