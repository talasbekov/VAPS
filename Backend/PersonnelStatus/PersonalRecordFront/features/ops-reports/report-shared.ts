// Общие подписи и хелперы страниц отчётного реестра.
import type { ReportJobActionCode, ReportJobState } from "@/entities/service-report";

export const JOB_STATE_LABEL: Record<ReportJobState, string> = {
  PENDING: "В очереди",
  PROCESSING: "Формируется",
  COMPLETED: "Готов",
  FAILED: "Ошибка",
};

export const ACTION_LABEL: Record<ReportJobActionCode, string> = {
  OPEN_PARAMETERS: "Открыть параметры",
  DOWNLOAD: "Скачать",
  RETRY: "Повторить",
  NEW_REVISION: "Новая редакция",
  VIEW_ERROR: "Посмотреть ошибку",
};

export function formatMoment(iso: string): string {
  const at = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(at.getDate())}.${pad(at.getMonth() + 1)}.${at.getFullYear()}, ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  return `${(bytes / 1024).toFixed(1)} КБ`;
}

/** Сохранение полученного потока файлом. Object URL живёт до revokeObjectURL:
 * §22.23 запрещает постоянную ссылку на файл, и временная не заменяет её. */
export function saveFile(fileName: string, content: string): void {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** Сохранить ДВОИЧНЫЙ файл, пришедший в base64 (Plane №159, шаг ПД-3).
 *
 * Рядом с `saveFile`, а не вместо него: тот собирает Blob как `text/csv`, и
 * PDF, сохранённый им, открылся бы битым. Разные типы файлов — разные
 * функции, потому что ошибка здесь не видна до попытки открыть документ. */
export function saveBinaryFile(
  fileName: string,
  contentBase64: string,
  contentType: string
): void {
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
