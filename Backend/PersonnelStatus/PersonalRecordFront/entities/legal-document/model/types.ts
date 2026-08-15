// Домен «Нормативный документ» — законы, приказы, регламенты и инструкции по
// организации ОМ. Справочник только для чтения: правки нормативной базы
// делаются не в системе.

export const LEGAL_DOCUMENT_KINDS = [
  "LAW",
  "ORDER",
  "REGULATION",
  "INSTRUCTION",
] as const;

export type LegalDocumentKind = (typeof LEGAL_DOCUMENT_KINDS)[number];

export const LEGAL_DOCUMENT_KIND_LABEL: Record<LegalDocumentKind, string> = {
  LAW: "Закон",
  ORDER: "Приказ",
  REGULATION: "Регламент",
  INSTRUCTION: "Инструкция",
};

/** Цветовая пара плашки вида — из прототипа, вид к виду. */
export const LEGAL_DOCUMENT_KIND_BADGE_CLASS: Record<LegalDocumentKind, string> = {
  LAW: "bg-blue-100 text-blue-800",
  ORDER: "bg-purple-100 text-purple-800",
  REGULATION: "bg-green-100 text-green-800",
  INSTRUCTION: "bg-amber-100 text-amber-800",
};

export const LEGAL_DOCUMENT_STATUSES = ["IN_FORCE", "UNDER_REVIEW"] as const;

export type LegalDocumentStatus = (typeof LEGAL_DOCUMENT_STATUSES)[number];

export const LEGAL_DOCUMENT_STATUS_LABEL: Record<LegalDocumentStatus, string> = {
  IN_FORCE: "Действует",
  UNDER_REVIEW: "На пересмотре",
};

export interface LegalDocument {
  id: string;
  kind: LegalDocumentKind;
  /** Номер документа: «№ 174-V ЗРК», «Приказ № 112». */
  code: string;
  title: string;
  description: string;
  /** Строка редакции целиком: «актуален с 02.2024», «обновлён 03.2025». */
  revision: string;
  status: LegalDocumentStatus;
  pages: number;
  /**
   * Адрес файла документа; null — файла в системе нет. Отдельное поле, а не
   * догадка по коду: хранилища нормативки пока не существует, и «Открыть» без
   * этого поля пришлось бы либо врать, либо выкидывать из вёрстки.
   */
  fileUrl: string | null;
}

// ── Контракты API (реального бэка нет — см. lib/api-gaps.ts) ─────────────

export const LEGAL_DOCUMENTS_PATH = "/api/ops/legal-documents/";

export interface ListLegalDocumentsResponse {
  results: LegalDocument[];
}
