"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { downloadStatusDocument, fetchStatusDocuments, type StatusDocument } from "../model/status-documents";

export function StatusDocuments({ statusId }: { statusId: number }) {
  const [expanded, setExpanded] = useState(false);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const documents = useQuery({
    queryKey: ["status-documents", statusId],
    queryFn: () => fetchStatusDocuments(statusId),
    enabled: expanded,
  });

  async function download(documentRow: StatusDocument) {
    setDownloading(documentRow.id);
    setError(null);
    try {
      const { blob, filename } = await downloadStatusDocument(statusId, documentRow);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      try {
        anchor.href = objectUrl;
        anchor.download = filename || documentRow.title;
        document.body.appendChild(anchor);
        anchor.click();
      } finally {
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
      }
    } catch {
      setError("Не удалось скачать документ. Проверьте доступ и повторите попытку.");
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="space-y-2 text-sm">
      <Button type="button" variant="outline" size="sm" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        {expanded ? "Скрыть документы" : "Документы статуса"}
      </Button>
      {expanded && (
        <div className="space-y-2">
          {documents.isLoading && <p className="text-muted-foreground">Загрузка документов…</p>}
          {documents.isError && (
            <div role="alert">
              <p>Не удалось загрузить документы.</p>
              <Button type="button" variant="outline" size="sm" onClick={() => documents.refetch()}>Повторить</Button>
            </div>
          )}
          {!documents.isError && documents.data?.length === 0 && <p className="text-muted-foreground">Документы не приложены.</p>}
          {!documents.isError && documents.data?.map(documentRow => (
            <div key={documentRow.id}>
              <Button type="button" variant="link" className="h-auto max-w-full whitespace-normal break-words px-0 text-left" disabled={downloading !== null || !documentRow.file_url} onClick={() => download(documentRow)}>
                {documentRow.title}
              </Button>
            </div>
          ))}
          {downloading !== null && <p role="status">Скачивание…</p>}
          {error && <p role="alert" className="text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
