"use client";

// Законы об ОМ: нормативная база раздела — поиск, фильтр по виду, карточки.
// Справочник только для чтения; поиск и фильтр живут в URL, чтобы обновление
// страницы не сбрасывало выборку и ссылкой можно было поделиться — как в
// реестре ОМ.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useLegalDocuments } from "@/hooks/use-legal-documents";
import { useDebouncedCommit } from "@/hooks/use-debounced-commit";
import {
  LEGAL_DOCUMENT_KINDS,
  LEGAL_DOCUMENT_KIND_BADGE_CLASS,
  LEGAL_DOCUMENT_KIND_LABEL,
  LEGAL_DOCUMENT_STATUS_LABEL,
} from "@/entities/legal-document";
import type {
  LegalDocument,
  LegalDocumentKind,
} from "@/entities/legal-document";

function isKind(value: string | null): value is LegalDocumentKind {
  return (LEGAL_DOCUMENT_KINDS as readonly string[]).includes(value ?? "");
}

function matches(document: LegalDocument, query: string): boolean {
  if (query === "") return true;
  const needle = query.toLowerCase();
  return (
    document.title.toLowerCase().includes(needle) ||
    document.code.toLowerCase().includes(needle) ||
    document.description.toLowerCase().includes(needle)
  );
}

export default function LegalDocumentsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Права те же, что у соседних экранов раздела: нормативная база — часть
  // контура ОМ, отдельного кода под неё в сиде RBAC нет, а выдумывать свой
  // значило бы закрыть экран всем, кроме администратора с `*`.
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();

  const kindParam = searchParams.get("kind");
  const kind: LegalDocumentKind | "ALL" = isKind(kindParam) ? kindParam : "ALL";
  const search = searchParams.get("search") ?? "";

  // `catalog.view`, а не `event.view` (решение заказчика 28.08.2026,
  // Plane №267): рядовой сотрудник видит нормативная база, не видя
  // реестра мероприятий. Пока экран спрашивал право чтения ОМ, выдать
  // одно без другого было нельзя.
  const canView = hasPermission("catalog.view");
  const query = useLegalDocuments({ enabled: canView });

  function updateParam(key: string, value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value === "") next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    router.replace(qs === "" ? pathname : `${pathname}?${qs}`, { scroll: false });
  }

  // Здесь фильтрация клиентская, но router.replace на каждую букву всё равно
  // перерисовывал список целиком и забивал историю навигации.
  const [searchDraft, setSearchDraft] = useDebouncedCommit(search, (value) =>
    updateParam("search", value)
  );

  if (!permissionsLoading && !canView) {
    return <OpsAccessDenied what="нормативной базы ОМ" />;
  }

  const documents = (query.data?.results ?? []).filter(
    (document) =>
      (kind === "ALL" || document.kind === kind) && matches(document, search)
  );

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Охранные мероприятия"
          title="Законы об ОМ"
          description="Действующие законы, приказы, регламенты и инструкции по организации охранных мероприятий"
        />

        <div className="space-y-[10px]">
          <Input
            className="h-[38px] text-[13px]"
            placeholder="Поиск по названию, номеру документа или содержанию…"
            aria-label="Поиск по нормативной базе"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {(["ALL", ...LEGAL_DOCUMENT_KINDS] as const).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                aria-pressed={kind === value}
                variant={kind === value ? "default" : "outline"}
                className="h-8 rounded-full px-[13px] text-[12.5px] font-semibold"
                onClick={() => updateParam("kind", value === "ALL" ? "" : value)}
              >
                {value === "ALL" ? "Все" : LEGAL_DOCUMENT_KIND_LABEL[value]}
              </Button>
            ))}
          </div>
        </div>

        {query.isLoading ? (
          <Card>
            <CardContent className="p-9 text-center text-sm text-muted-foreground">
              Загрузка нормативной базы…
            </CardContent>
          </Card>
        ) : query.isError ? (
          <Card>
            <CardContent className="p-9 text-center text-sm text-destructive-ink">
              Не удалось загрузить нормативную базу.
            </CardContent>
          </Card>
        ) : documents.length === 0 ? (
          <Card>
            <CardContent className="p-9 text-center text-[13px] text-muted-foreground">
              Документы не найдены
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {documents.map((document) => (
              <DocumentCard key={document.id} document={document} />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function DocumentCard({ document }: { document: LegalDocument }) {
  return (
    <article className="flex flex-col rounded-[12px] border bg-card p-4 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
      <div className="mb-[10px] flex items-start justify-between gap-2">
        <span
          className={`inline-flex whitespace-nowrap rounded-full px-[9px] py-0.5 text-[10.5px] font-bold ${LEGAL_DOCUMENT_KIND_BADGE_CLASS[document.kind]}`}
        >
          {LEGAL_DOCUMENT_KIND_LABEL[document.kind]}
        </span>
        <span
          className={
            document.status === "IN_FORCE"
              ? "inline-flex whitespace-nowrap rounded-full bg-green-100 px-[9px] py-0.5 text-[10.5px] font-bold text-green-800"
              : "inline-flex whitespace-nowrap rounded-full bg-amber-100 px-[9px] py-0.5 text-[10.5px] font-bold text-amber-800"
          }
        >
          {LEGAL_DOCUMENT_STATUS_LABEL[document.status]}
        </span>
      </div>
      <p className="mb-1 text-[11px] font-bold text-muted-foreground">
        {document.code}
      </p>
      <h2 className="mb-[7px] text-[14.5px] font-bold leading-[1.3]">
        {document.title}
      </h2>
      <p className="mb-3 flex-1 text-[12px] leading-[1.55] text-muted-foreground">
        {document.description}
      </p>
      <div className="mb-3 flex justify-between border-t pt-[10px] text-[11px] text-muted-foreground">
        <span>{document.revision}</span>
        <span className="tabular-nums">{document.pages} стр.</span>
      </div>
      {document.fileUrl === null ? (
        // Кнопки прототипа («Открыть» и «Скачать PDF») здесь показывали тост:
        // файла документа система не хранит. Рисовать рабочие кнопки над
        // несуществующим файлом — тот же обман, что пустой список вместо
        // ошибки, поэтому вместо них стоит прямая надпись.
        <p className="rounded-[8px] border border-dashed px-3 py-2 text-center text-[11.5px] text-muted-foreground">
          Файл документа в системе не хранится
        </p>
      ) : (
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm" className="h-[34px] flex-1">
            <Link href={document.fileUrl} target="_blank" rel="noopener noreferrer">
              Открыть
            </Link>
          </Button>
          <Button asChild size="sm" className="h-[34px] flex-1">
            <a href={document.fileUrl} download>
              Скачать PDF
            </a>
          </Button>
        </div>
      )}
    </article>
  );
}
