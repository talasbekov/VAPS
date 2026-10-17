"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LEGAL_DOCUMENTS_PATH, LEGAL_DOCUMENT_KINDS, LEGAL_DOCUMENT_KIND_LABEL, LEGAL_DOCUMENT_STATUSES, LEGAL_DOCUMENT_STATUS_LABEL, type LegalDocument } from "@/entities/legal-document";
import { opsApiClient } from "@/lib/ops-api";
import { OpsApiError, friendlyOpsErrorMessage } from "@/lib/ops-errors";
import { LoadFailure } from "@/components/load-failure";

export function LegalDocumentEditor({ document, allowed, maxFileSize, onClose, onSaved, readFailure }: {
  document: LegalDocument | null;
  allowed: boolean;
  maxFileSize: number;
  onClose(): void;
  onSaved(document: LegalDocument): void;
  readFailure?: { onRetry(): void; isRetrying: boolean };
}) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const lock = useRef(false);
  const authorityContext = useMemo(() => ({}), [allowed, document]);
  const currentContext = useRef(authorityContext);
  const mounted = useRef(false);
  currentContext.current = authorityContext;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || !allowed || readFailure || conflict) return;
    const submittedContext = authorityContext;
    const isCurrent = () => mounted.current && currentContext.current === submittedContext;
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (file instanceof File && file.size > maxFileSize) {
      setError(`Файл больше ${Math.round(maxFileSize / 1024 / 1024)} МБ. Выберите файл меньшего размера.`);
      return;
    }
    if (file instanceof File && !file.name) form.delete("file");
    if (document) form.set("expectedVersion", String(document.version));
    lock.current = true; setPending(true); setError("");
    try {
      const saved = document
        ? await opsApiClient.patchForm<LegalDocument>(`${LEGAL_DOCUMENTS_PATH}${document.id}/`, form)
        : await opsApiClient.postForm<LegalDocument>(LEGAL_DOCUMENTS_PATH, form);
      void queryClient.invalidateQueries({ queryKey: ["ops-legal-documents"] });
      if (!isCurrent()) return;
      onSaved(saved);
    } catch (failure) {
      if (!isCurrent()) return;
      setConflict(failure instanceof OpsApiError && failure.status === 409);
      const message = friendlyOpsErrorMessage(failure, "Право изменения документов больше недоступно.");
      const details = failure instanceof OpsApiError && failure.status === 400
        ? Object.values(failure.details).flat().filter((value): value is string => typeof value === "string").join(" ")
        : "";
      setError([message, details].filter(Boolean).join(" "));
    } finally { lock.current = false; if (mounted.current) setPending(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !lock.current) onClose(); }}>
    <DialogContent className="sm:max-w-xl max-h-[90dvh] overflow-y-auto" showCloseButton={!pending}
      onEscapeKeyDown={event => { if (lock.current) event.preventDefault(); }}
      onPointerDownOutside={event => { if (lock.current) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>{document ? "Изменить документ" : "Добавить документ"}</DialogTitle>
        <DialogDescription>PDF или DOCX до {Math.round(maxFileSize / 1024 / 1024)} МБ. Карточку можно сохранить без файла.</DialogDescription>
      </DialogHeader>
      {readFailure && <LoadFailure what="нормативную базу" description="Черновик сохранён. Повторите загрузку каталога."
        onRetry={readFailure.onRetry} isRetrying={readFailure.isRetrying} />}
      <form onSubmit={save} className="space-y-4" aria-busy={pending}>
        <fieldset disabled={pending || !allowed || !!readFailure} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">Вид документа
              <select name="kind" defaultValue={document?.kind ?? "INSTRUCTION"} className="rounded-md border bg-background p-2">
                {LEGAL_DOCUMENT_KINDS.map(kind => <option key={kind} value={kind}>{LEGAL_DOCUMENT_KIND_LABEL[kind]}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm">Состояние
              <select name="status" defaultValue={document?.status ?? "IN_FORCE"} className="rounded-md border bg-background p-2">
                {LEGAL_DOCUMENT_STATUSES.map(status => <option key={status} value={status}>{LEGAL_DOCUMENT_STATUS_LABEL[status]}</option>)}
              </select>
            </label>
          </div>
          <label className="grid gap-1 text-sm">Номер документа<Input name="code" required maxLength={100} defaultValue={document?.code ?? ""} /></label>
          <label className="grid gap-1 text-sm">Название<Input name="title" required maxLength={300} defaultValue={document?.title ?? ""} /></label>
          <label className="grid gap-1 text-sm">Файл документа<Input name="file" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" /></label>
          <p className="text-xs text-muted-foreground">{document?.file
            ? `Сейчас: ${document.file.name}. Новый файл станет текущим; предыдущий останется в версиях.`
            : "Для PDF число страниц определяется при загрузке."}</p>
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">Описание и редакция</summary>
            <div className="mt-3 space-y-3">
              <label className="grid gap-1 text-sm">Описание<textarea name="description" rows={2} className="rounded-md border bg-background p-2" defaultValue={document?.description ?? ""} /></label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm">Редакция<Input name="revision" maxLength={100} defaultValue={document?.revision ?? ""} /></label>
                <label className="grid gap-1 text-sm">Количество страниц<Input name="pages" type="number" min={1} step={1} defaultValue={document?.pages ?? ""} /></label>
              </div>
            </div>
          </details>
        </fieldset>
        {!allowed && !readFailure && <p role="alert" className="text-sm text-destructive">Право изменения документов сейчас недоступно. Черновик сохранён только для просмотра.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {conflict && <p className="text-sm text-muted-foreground">Скопируйте нужные правки, закройте форму и откройте обновлённую карточку. Повторное сохранение старой версии заблокировано.</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>Отмена</Button>
          <Button type="submit" disabled={pending || !allowed || !!readFailure || conflict}>{pending ? "Сохранение…" : "Сохранить"}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
