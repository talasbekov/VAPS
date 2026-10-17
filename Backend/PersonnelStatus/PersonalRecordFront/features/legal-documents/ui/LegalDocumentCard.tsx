"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { LEGAL_DOCUMENTS_PATH, LEGAL_DOCUMENT_KIND_BADGE_CLASS, LEGAL_DOCUMENT_KIND_LABEL, LEGAL_DOCUMENT_STATUS_LABEL, type LegalDocument, type LegalFile } from "@/entities/legal-document";
import { opsApiClient } from "@/lib/ops-api";
import { friendlyOpsErrorMessage } from "@/lib/ops-errors";
import { formatIsoDateTime } from "@/shared/lib/date";

function legacyLink(value: string | null): string | null {
  if (!value) return null;
  const candidate = value.trim();
  if (!candidate || candidate.startsWith("//") || candidate.includes("\\") || /[\u0000-\u001f\u007f]/.test(candidate)) return null;
  try {
    const url = new URL(candidate, "https://relative.invalid/");
    return url.protocol === "http:" || url.protocol === "https:" ? candidate : null;
  } catch { return null; }
}

export function LegalDocumentCard({ document, onEdit }: { document: LegalDocument; onEdit?: () => void }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const history = useQuery({
    queryKey: ["ops-legal-document-files", document.id, document.version],
    queryFn: () => opsApiClient.get<{ results: LegalFile[] }>(`${LEGAL_DOCUMENTS_PATH}${document.id}/files/`),
    enabled: historyOpen,
  });
  async function download(file: LegalFile) {
    if (lock.current) return;
    lock.current = true; setPendingId(file.id); setError("");
    try {
      const result = await opsApiClient.download(`${LEGAL_DOCUMENTS_PATH}${document.id}/files/${file.id}/download/`);
      const url = URL.createObjectURL(result.blob);
      const anchor = window.document.createElement("a");
      anchor.href = url; anchor.download = result.filename ?? file.name;
      window.document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { setError(friendlyOpsErrorMessage(failure, "Нет права скачивания документов.")); }
    finally { lock.current = false; setPendingId(null); }
  }
  const href = legacyLink(document.fileUrl);
  return <article className="flex min-w-0 flex-col rounded-xl border bg-card p-4 shadow-sm">
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${LEGAL_DOCUMENT_KIND_BADGE_CLASS[document.kind]}`}>{LEGAL_DOCUMENT_KIND_LABEL[document.kind]}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs ${document.status === "IN_FORCE" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>{LEGAL_DOCUMENT_STATUS_LABEL[document.status]}</span>
    </div>
    <p className="mb-1 break-words text-xs font-semibold text-muted-foreground">{document.code}</p>
    <h2 className="mb-2 break-words text-base font-semibold">{document.title}</h2>
    <p className="mb-3 flex-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{document.description}</p>
    <div className="mb-3 flex justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
      <span className="break-words">{document.revision}</span>
      {document.pages != null && <span className="shrink-0">{document.pages} стр.</span>}
    </div>
    {document.file ? <div className="space-y-2">
      <p className="break-words text-xs text-muted-foreground">{document.file.name} · {Math.max(1, Math.round(document.file.size / 1024))} КБ</p>
      <Button className="w-full" size="sm" disabled={pendingId !== null} onClick={() => void download(document.file!)}>
        {pendingId === document.file.id ? "Скачивание…" : document.file.contentType === "application/pdf" ? "Скачать PDF" : "Скачать DOCX"}
      </Button>
      <Button className="w-full" size="sm" variant="ghost" onClick={() => { setError(""); setHistoryOpen(true); }}>Версии файла</Button>
    </div> : href ? <Button asChild size="sm" variant="outline"><a href={href} target="_blank" rel="noopener noreferrer">Открыть</a></Button>
      : <p className="rounded-lg border border-dashed px-3 py-2 text-center text-xs text-muted-foreground">Файл документа в системе не хранится</p>}
    {onEdit && <Button className="mt-2" size="sm" variant="outline" onClick={onEdit}>Изменить</Button>}
    {error && !historyOpen && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Версии файла</DialogTitle><DialogDescription>{document.code} · {document.title}</DialogDescription></DialogHeader>
        {history.isLoading ? <p role="status">Загрузка версий…</p> : history.isError
          ? <div><p role="alert">Не удалось загрузить версии.</p><Button variant="outline" onClick={() => void history.refetch()}>Повторить</Button></div>
          : <ul className="space-y-3">{history.data?.results.map((file, index) => <li key={file.id} className="rounded-lg border p-3">
            <p className="break-words font-medium">{file.name}</p>
            <p className="my-2 text-xs text-muted-foreground">{index === 0 ? "Текущая версия · " : ""}{formatIsoDateTime(file.uploadedAt)} · {Math.max(1, Math.round(file.size / 1024))} КБ</p>
            <Button size="sm" variant="outline" disabled={pendingId !== null} onClick={() => void download(file)}>{pendingId === file.id ? "Скачивание…" : "Скачать"}</Button>
          </li>)}</ul>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  </article>;
}
