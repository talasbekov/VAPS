"use client";

import { Suspense, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { moduleOpenFor } from "@/entities/portal-access";
import { useLegalDocuments } from "@/hooks/use-legal-documents";
import { useDebouncedCommit } from "@/hooks/use-debounced-commit";
import { LEGAL_DOCUMENT_KINDS, LEGAL_DOCUMENT_KIND_LABEL, type LegalDocument, type LegalDocumentKind, type ListLegalDocumentsResponse } from "@/entities/legal-document";
import { LegalDocumentCard } from "@/features/legal-documents/ui/LegalDocumentCard";
import { LegalDocumentEditor } from "@/features/legal-documents/ui/LegalDocumentEditor";
import { LoadFailure } from "@/components/load-failure";

export default function LegalDocumentsPage() {
  return <Suspense fallback={<div className="min-h-screen bg-background" />}><LegalDocumentsScreen /></Suspense>;
}

function LegalDocumentsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const permissions = useOpsPermissions();
  const canView = moduleOpenFor("/security-ops/laws", permissions.hasPermission);
  const accessReady = !permissions.isLoading && permissions.error === null && canView;
  const query = useLegalDocuments({ enabled: accessReady });
  const accessReadFailed = query.readAccessBlocked;
  const catalogAvailable = accessReady && query.data !== undefined && !accessReadFailed;
  const canManage = catalogAvailable && permissions.hasGlobalPermission("legal.manage") && query.data?.canManage === true;
  const [editor, setEditor] = useState<{ document: LegalDocument | null } | null>(null);
  const [saved, setSaved] = useState("");
  useEffect(() => {
    if (!catalogAvailable) { setEditor(null); setSaved(""); }
  }, [catalogAvailable]);
  const kindParam = searchParams.get("kind");
  const kind = LEGAL_DOCUMENT_KINDS.includes(kindParam as LegalDocumentKind) ? kindParam as LegalDocumentKind : "ALL";
  const search = searchParams.get("search") ?? "";
  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  }
  const [searchDraft, setSearchDraft] = useDebouncedCommit(search, value => updateParam("search", value));
  function onSaved(document: LegalDocument) {
    queryClient.setQueryData<ListLegalDocumentsResponse>(["ops-legal-documents"], previous => previous ? {
      ...previous, results: previous.results.some(row => row.id === document.id)
        ? previous.results.map(row => row.id === document.id ? document : row)
        : [...previous.results, document],
    } : previous);
    setEditor(null);
    setSaved(`Документ сохранён: ${document.code}`);
    void queryClient.invalidateQueries({ queryKey: ["ops-legal-documents"] });
  }
  if (permissions.isLoading) return <DashboardLayout><p role="status" className="text-sm text-muted-foreground">Проверка доступа к нормативной базе…</p></DashboardLayout>;
  if (!canView || permissions.error) return <OpsAccessDenied what="нормативной базы ОМ" />;
  const needle = search.trim().toLowerCase();
  const documents = (query.data?.results ?? []).filter(document =>
    (kind === "ALL" || document.kind === kind) &&
    [document.title, document.code, document.description].some(value => value.toLowerCase().includes(needle)));
  return <DashboardLayout>
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader  title="Законы об ОМ" description="Законы, приказы, регламенты и инструкции." />
        {canManage && <Button disabled={query.isError} onClick={() => { setSaved(""); setEditor({ document: null }); }}>Добавить документ</Button>}
      </div>
      {saved && <p role="status" className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{saved}</p>}
      <details className="rounded-lg border px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">Как добавить документ</summary>
        <p className="mt-2 text-muted-foreground">{canManage
          ? "Нажмите «Добавить документ», заполните номер и название, прикрепите PDF или DOCX. Для существующей карточки нажмите «Изменить». Предыдущие файлы доступны через «Версии файла»."
          : "Файлы PDF и DOCX загружает администратор справочников с правом управления нормативными документами. Вы можете скачать доступный файл из карточки. Карточка без файла содержит только описание."}</p>
      </details>
      <div className="space-y-3">
        <Input placeholder="Поиск по названию, номеру документа или содержанию…" aria-label="Поиск по нормативной базе" value={searchDraft} onChange={event => setSearchDraft(event.target.value)} />
        <div className="flex flex-wrap gap-2">{(["ALL", ...LEGAL_DOCUMENT_KINDS] as const).map(value => <Button key={value}
          size="sm" aria-pressed={kind === value} variant={kind === value ? "default" : "outline"} className="rounded-full"
          onClick={() => updateParam("kind", value === "ALL" ? "" : value)}>{value === "ALL" ? "Все" : LEGAL_DOCUMENT_KIND_LABEL[value]}</Button>)}</div>
      </div>
      {query.isError && <LoadFailure what="нормативную базу"
        description={catalogAvailable ? "Показаны последние загруженные данные. Открытый черновик сохранён." : undefined}
        onRetry={() => { void query.refetch(); }} isRetrying={query.isFetching} />}
      {query.isLoading ? <p role="status" className="p-9 text-center text-muted-foreground">Загрузка нормативной базы…</p>
        : !catalogAvailable ? null : documents.length === 0 ? <p className="rounded-xl border p-9 text-center text-muted-foreground">Документы не найдены</p>
        : <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
          {documents.map(document => <LegalDocumentCard key={document.id} document={document} onEdit={canManage && !query.isError ? () => { setSaved(""); setEditor({ document }); } : undefined} />)}
        </div>}
      {catalogAvailable && editor && <LegalDocumentEditor key={editor.document?.id ?? "new"} document={editor.document} allowed={canManage}
        readFailure={query.isError ? { onRetry: () => { void query.refetch(); }, isRetrying: query.isFetching } : undefined}
        maxFileSize={query.data?.maxFileSizeBytes ?? 10 * 1024 * 1024}
        onClose={() => { setEditor(null); void query.refetch(); }} onSaved={onSaved} />}
    </div>
  </DashboardLayout>;
}
