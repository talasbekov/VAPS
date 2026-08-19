"use client";

// Реестр ОМ: поиск, фильтр по этапу, таблица, создание. Фильтры — в URL
// (обновление страницы не сбрасывает фильтр, ссылкой можно поделиться).
import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { FilterBar } from "@/components/filter-bar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSecurityEvents } from "@/hooks/use-security-events";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useDebouncedCommit } from "@/hooks/use-debounced-commit";
import { CreateSecurityEventDialog } from "@/features/create-security-event";
import {
  SECURITY_EVENT_STAGES,
  STAGE_LABEL,
  StageBadge,
} from "@/entities/security-event";
import type {
  ListSecurityEventsParams,
  SecurityEvent,
  SecurityEventStage,
} from "@/entities/security-event";
import { OpsAccessDenied } from "@/components/ops-access-denied";

const PAGE_SIZE = 20;

function isStage(value: string | null): value is SecurityEventStage {
  return (SECURITY_EVENT_STAGES as readonly string[]).includes(value ?? "");
}

export default function SecurityEventsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Текущий отбор едет с человеком в карточку: возврат «← Назад» без него
  // приводил на голый корень реестра, и подобранный фильтр приходилось
  // набирать заново.
  const backSuffix = (() => {
    const query = searchParams.toString();
    return query === "" ? "" : `?back=${encodeURIComponent(query)}`;
  })();
  const [dialogOpen, setDialogOpen] = useState(false);
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();

  const stageParam = searchParams.get("stage");
  const params: ListSecurityEventsParams = {
    search: searchParams.get("search") ?? "",
    stage: isStage(stageParam) ? stageParam : "ALL",
    // Период и ответственный фильтрует СЕРВЕР: тот же фильтр на клиенте сузил
    // бы только загруженную страницу и врал бы про пустой результат.
    from: searchParams.get("from") ?? "",
    to: searchParams.get("to") ?? "",
    owner: searchParams.get("owner") ?? "",
    page: Number(searchParams.get("page") ?? "1") || 1,
    pageSize: PAGE_SIZE,
  };

  const query = useSecurityEvents(params);

  // Поиск фиксируется с задержкой: в URL и в запрос уезжает набранное слово, а
  // не каждая его буква. Само поле отвечает мгновенно — оно живёт в черновике.
  const [searchDraft, setSearchDraft] = useDebouncedCommit(
    params.search ?? "",
    (value) => updateParam("search", value)
  );

  function updateParam(key: string, value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value === "") next.delete(key);
    else next.set(key, value);
    next.delete("page"); // фильтр меняется — начинаем с первой страницы
    const qs = next.toString();
    router.replace(qs === "" ? pathname : `${pathname}?${qs}`, { scroll: false });
  }

  if (!permissionsLoading && !hasPermission("event.view")) {
    return (
      <OpsAccessDenied what="реестра ОМ" />
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Охранные мероприятия"
          title="Реестр ОМ"
          description="Полный цикл: от бюллетеня и рекогносцировки до закрытия и архива"
          actions={<Button onClick={() => setDialogOpen(true)}>+ Создать ОМ</Button>}
        />

        <FilterBar
          onReset={
            params.search !== "" ||
            params.stage !== "ALL" ||
            params.from !== "" ||
            params.to !== "" ||
            params.owner !== ""
              ? () => router.replace(pathname, { scroll: false })
              : undefined
          }
        >
          <Input
            className="min-w-56 flex-1"
            placeholder="Поиск по названию, объекту или ответственному"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
          />
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            aria-label="Этап"
            value={params.stage}
            onChange={(e) =>
              updateParam("stage", e.target.value === "ALL" ? "" : e.target.value)
            }
          >
            <option value="ALL">Все этапы</option>
            {SECURITY_EVENT_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {STAGE_LABEL[stage]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            с
            <Input
              type="date"
              aria-label="Период с"
              className="w-auto"
              value={params.from}
              onChange={(e) => updateParam("from", e.target.value)}
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            по
            <Input
              type="date"
              aria-label="Период по"
              className="w-auto"
              value={params.to}
              onChange={(e) => updateParam("to", e.target.value)}
            />
          </label>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            aria-label="Ответственный"
            value={params.owner}
            onChange={(e) => updateParam("owner", e.target.value)}
          >
            <option value="">Все ответственные</option>
            {(query.data?.owners ?? []).map((owner) => (
              <option key={owner} value={owner}>
                {owner}
              </option>
            ))}
          </select>
        </FilterBar>

        <ResultsTable
          backSuffix={backSuffix}
          isLoading={query.isLoading}
          isError={query.isError}
          events={query.data?.results ?? []}
          isEmpty={query.data !== undefined && query.data.results.length === 0}
        />

        <CreateSecurityEventDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
        />
      </div>
    </DashboardLayout>
  );
}

function ResultsTable({
  backSuffix,
  isLoading,
  isError,
  events,
  isEmpty,
}: {
  /** Текущий отбор реестра — уезжает в карточку, чтобы вернуться на него. */
  backSuffix: string;
  isLoading: boolean;
  isError: boolean;
  events: SecurityEvent[];
  isEmpty: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-9 text-center text-sm text-muted-foreground">
          Загрузка реестра…
        </CardContent>
      </Card>
    );
  }
  if (isError) {
    return (
      <Card>
        <CardContent className="p-9 text-center text-sm text-destructive-ink">
          Не удалось загрузить реестр ОМ. Попробуйте обновить страницу.
        </CardContent>
      </Card>
    );
  }
  if (isEmpty) {
    return (
      <Card>
        <CardContent className="p-9 text-center text-sm text-muted-foreground">
          Мероприятия не найдены
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <Th>ОМ</Th>
            <Th>Дата и объект</Th>
            <Th>Этап</Th>
            <Th>Готовность</Th>
            <Th>Потребность</Th>
            <Th>Конфликты</Th>
            <Th>Ответственный</Th>
            <Th>
              <span className="sr-only">Действия</span>
            </Th>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((event) => (
            <TableRow key={event.id}>
              <TableCell>
                <Link href={`/security-ops/events/${event.id}${backSuffix}`} className="block">
                  <span className="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-[10.5px] font-bold text-purple-800">
                    {event.code}
                  </span>
                  <span className="mt-1 block font-semibold">{event.title}</span>
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {event.businessDate} · {event.objectName}
              </TableCell>
              <TableCell>
                <StageBadge stage={event.stage} />
              </TableCell>
              <TableCell>
                {/* Полоса готовности из прототипа: процент числом рядом —
                    полоса без числа не читается на печати и в узкой колонке. */}
                <div className="flex items-center gap-2">
                  <span
                    className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={event.readinessPercent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Готовность ${event.code}`}
                  >
                    <span
                      className="block h-full bg-primary"
                      style={{ width: `${event.readinessPercent}%` }}
                    />
                  </span>
                  <span className="tabular-nums">{event.readinessPercent}%</span>
                </div>
              </TableCell>
              <TableCell className="tabular-nums">{event.forceNeed}</TableCell>
              <TableCell>
                <span
                  className={
                    event.conflictsCount > 0
                      ? "inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800"
                      : "inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-800"
                  }
                >
                  {event.conflictsCount}
                </span>
              </TableCell>
              <TableCell>{event.ownerName}</TableCell>
              <TableCell className="text-center text-muted-foreground">
                <Link href={`/security-ops/events/${event.id}${backSuffix}`}>›</Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function Th({ children }: { children?: ReactNode }) {
  return <TableHead>{children}</TableHead>;
}
