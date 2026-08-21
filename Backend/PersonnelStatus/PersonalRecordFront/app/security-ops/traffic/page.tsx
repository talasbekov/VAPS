"use client";

/**
 * «Расход и светофор» — экран прототипа `view: "traffic"` (группа «Личный
 * состав»): контроль сдачи расхода по подразделениям.
 *
 * Слева — дерево светофора (цвет узла — худший из своего и потомков, `late`
 * поднимается снизу), справа — карточка выбранного узла: версии сдач с
 * выгрузкой XLSX, выпуски документов и точечное расхождение. Панель
 * блокировки — про ЗАВТРА сервера: тот день, который гейт и закрывает.
 *
 * Отклонения от прототипа — по источникам, а не по вкусу:
 * — ролевого селектора нет: зону видимости даёт RBAC-область актора;
 * — плитки «Черновик» нет: сдача иммутабельна, черновиков в домене не
 *   существует; её место занял счёт «с опозданием» (`late` живой);
 * — кнопок «Напомнить» нет: напоминания отстающим шлёт автоматика бэка
 *   после контрольного часа (lagging_check), ручной отправки в API нет.
 */

import { Suspense, useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { LoadFailure } from "@/components/load-failure";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ChevronDown, ChevronRight, Download, Loader2 } from "lucide-react";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import {
  useDailySubmissions,
  useDivisionTrafficLight,
  useIssuedDocuments,
  useOverrideTomorrowBlock,
  useTomorrowBlock,
  useTrafficTreeFor,
  type TrafficLightColor,
} from "@/hooks/use-daily-control";
import { opsApiClient } from "@/lib/ops-api";
import type { TrafficLightNode } from "@/lib/api";
import { useToast } from "@/shared/hooks/use-toast";
import { formatIsoDate } from "@/shared/lib/date";
import { cn } from "@/lib/utils";

/** Подписи цветов — семантика сдачи, не имена цветов (traffic_light.py). */
const COLOR_LABEL: Record<TrafficLightColor, string> = {
  GREEN: "Сдано",
  YELLOW: "Расхождение",
  RED: "Не сдано",
  NEUTRAL: "Сдавать некого",
  UNKNOWN: "Неопределён",
};

const COLOR_BADGE: Record<TrafficLightColor, string> = {
  GREEN: "bg-green-100 text-green-800",
  YELLOW: "bg-amber-100 text-amber-800",
  RED: "bg-red-100 text-red-800",
  NEUTRAL: "bg-gray-100 text-gray-600",
  UNKNOWN: "bg-gray-200 text-gray-800",
};

const COLOR_DOT: Record<TrafficLightColor, string> = {
  GREEN: "bg-green-500",
  YELLOW: "bg-amber-400",
  RED: "bg-red-500",
  NEUTRAL: "bg-gray-300",
  UNKNOWN: "bg-gray-500",
};

/** Режим даты экрана: серверные «завтра»/«сегодня» или явный день из пикера. */
type DayMode = "tomorrow" | "today" | string;

function parseDayParam(raw: string | null): DayMode {
  if (raw === null || raw === "tomorrow") return "tomorrow";
  if (raw === "today") return "today";
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "tomorrow";
}

export default function TrafficControlPage() {
  // useSearchParams требует границы Suspense — иначе пререндер падает на сборке.
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <TrafficControlScreen />
    </Suspense>
  );
}

function TrafficControlScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const dayMode = parseDayParam(searchParams.get("day"));
  const selectedId = (() => {
    const raw = searchParams.get("division");
    if (raw === null) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
  })();

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (value === null) next.delete(key);
      else next.set(key, value);
      const query = next.toString();
      router.replace(query === "" ? pathname : `${pathname}?${query}`, {
        scroll: false,
      });
    },
    [router, pathname, searchParams]
  );

  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const canView = hasPermission("status.view");
  const canDocuments = hasPermission("document.view");
  const canOverride = hasPermission("daily_report.override_block");

  // Блокировка всегда про ЗАВТРА сервера; её эхо `business_date` — источник
  // серверного «завтра» для остальных запросов (клиентские часы не участвуют).
  const blockQuery = useTomorrowBlock(canView);

  // Опорная дата остальных запросов. В режиме «сегодня» дерево уходит БЕЗ
  // даты (день ставит сервер), и его эхо становится датой для сдач/выпусков.
  const pinnedDate: string | null =
    dayMode === "tomorrow"
      ? (blockQuery.data?.business_date ?? null)
      : dayMode === "today"
        ? null
        : dayMode;

  const treeQuery = useTrafficTreeFor(
    pinnedDate,
    canView && (dayMode !== "tomorrow" || pinnedDate !== null)
  );
  const businessDate = treeQuery.data?.business_date ?? pinnedDate;

  if (!permissionsLoading && !canView) {
    return <OpsAccessDenied what="расхода и светофора" />;
  }

  const nodes = treeQuery.data?.nodes ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Контроль готовности"
          title="Расход и светофор"
          description="Сдача расхода по подразделениям: светофор сдачи, версии, выпуски и блокировка завтрашнего дня"
          actions={<DaySwitch mode={dayMode} onChange={(value) => setParam("day", value)} />}
        />

        {/* Чего на этом экране нет и почему — строкой, а не пустыми ячейками. */}
        <p className="text-xs text-muted-foreground">
          Черновиков сдачи в системе нет — сдача записывается сразу и
          поправляется отдельным действием с причиной. Напоминания отстающим
          шлёт автоматика после контрольного часа; ручной отправки нет. Зона
          видимости — фактическая область прав, ролевой переключатель ей не
          нужен.
        </p>

        {treeQuery.isError && (
          <LoadFailure
            what="светофор подразделений"
            onRetry={() => void treeQuery.refetch()}
            isRetrying={treeQuery.isFetching}
            className="rounded-xl border bg-card px-4"
          />
        )}

        {(treeQuery.isLoading || (dayMode === "tomorrow" && blockQuery.isLoading)) && (
          <p className="text-sm text-muted-foreground">Загрузка светофора…</p>
        )}

        {!treeQuery.isLoading && !treeQuery.isError && (
          <>
            <TrafficKpis nodes={nodes} businessDate={businessDate} />

            <div className="grid items-start gap-4 lg:grid-cols-[2fr_1fr]">
              <TrafficTreeCard
                nodes={nodes}
                selectedId={selectedId}
                onSelect={(id) =>
                  setParam("division", id === null ? null : String(id))
                }
              />

              <div className="flex flex-col gap-4">
                <DivisionCard
                  divisionId={selectedId}
                  divisionName={
                    nodes.find((node) => node.division_id === selectedId)
                      ?.name ?? null
                  }
                  businessDate={businessDate}
                  canView={canView}
                  canDocuments={canDocuments}
                  onToast={toast}
                />
                <TomorrowBlockCard
                  query={blockQuery}
                  canOverride={canOverride}
                  onSelectDivision={(id) => setParam("division", String(id))}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function DaySwitch({
  mode,
  onChange,
}: {
  mode: DayMode;
  onChange: (value: string | null) => void;
}) {
  const explicit = mode !== "tomorrow" && mode !== "today";
  return (
    <div className="flex items-center gap-2">
      <div className="inline-flex gap-[3px] rounded-[9px] bg-[hsl(210_40%_93%)] p-[3px]">
        {(
          [
            ["tomorrow", "На завтра"],
            ["today", "Сегодня"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => onChange(value === "tomorrow" ? null : value)}
            className={
              mode === value
                ? "h-[30px] rounded-[7px] bg-card px-3 text-[12.5px] font-semibold shadow-sm"
                : "h-[30px] rounded-[7px] px-3 text-[12.5px] font-semibold text-muted-foreground"
            }
          >
            {label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-1 text-[12px] text-muted-foreground">
        <span className="sr-only">Дата</span>
        <input
          type="date"
          value={explicit ? mode : ""}
          onChange={(event) =>
            onChange(event.target.value === "" ? null : event.target.value)
          }
          className="h-[30px] rounded-[7px] border bg-card px-2 text-[12.5px]"
          aria-label="Выбрать дату"
        />
      </label>
    </div>
  );
}

/**
 * KPI считаются по ЛИСТЬЯМ дерева: родитель несёт худший цвет поддерева, и
 * счёт по всем узлам задваивал бы каждую сдачу на каждом уровне выше.
 */
function TrafficKpis({
  nodes,
  businessDate,
}: {
  nodes: TrafficLightNode[];
  businessDate: string | null;
}) {
  const { leaves, done, drifted, missing, late, neutral, unknown } =
    useMemo(() => {
      const parents = new Set(
        nodes
          .map((node) => node.parent_id)
          .filter((id): id is number => id !== null)
      );
      const leafNodes = nodes.filter(
        (node) => !parents.has(node.division_id)
      );
      return {
        leaves: leafNodes.length,
        done: leafNodes.filter((node) => node.status === "GREEN").length,
        drifted: leafNodes.filter((node) => node.status === "YELLOW").length,
        missing: leafNodes.filter((node) => node.status === "RED").length,
        late: leafNodes.filter((node) => node.late).length,
        neutral: leafNodes.filter((node) => node.status === "NEUTRAL").length,
        unknown: leafNodes.filter((node) => node.status === "UNKNOWN").length,
      };
    }, [nodes]);

  const dateLabel =
    businessDate === null ? "" : `на ${formatIsoDate(businessDate)}`;

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Подразделений" value={leaves} caption="листья дерева в зоне видимости" />
        <StatCard
          label="Сдали"
          value={done + drifted}
          caption={
            drifted > 0 ? `${dateLabel}; с расхождением: ${drifted}` : dateLabel
          }
          tone="success"
        />
        <StatCard
          label="С опозданием"
          value={late}
          caption="после контрольного часа"
          tone="warning"
        />
        <StatCard
          label="Не сдали"
          value={missing}
          caption={dateLabel}
          tone="danger"
        />
      </div>
      {(neutral > 0 || unknown > 0) && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Вне счёта: сдавать некого — {neutral}
          {unknown > 0 ? `, цвет неопределён (дефект данных) — ${unknown}` : ""}.
        </p>
      )}
    </div>
  );
}

function TrafficTreeCard({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: TrafficLightNode[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}) {
  const { roots, children } = useMemo(() => {
    const childMap = new Map<number, TrafficLightNode[]>();
    const rootList: TrafficLightNode[] = [];
    for (const node of nodes) {
      if (node.parent_id === null) {
        rootList.push(node);
        continue;
      }
      const bucket = childMap.get(node.parent_id);
      if (bucket === undefined) childMap.set(node.parent_id, [node]);
      else bucket.push(node);
    }
    return { roots: rootList, children: childMap };
  }, [nodes]);

  // Свёрнутые узлы: по умолчанию дерево раскрыто целиком — прототип показывает
  // иерархию сразу, а «свернуть» оставлено для больших поддеревьев.
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  const toggle = useCallback((id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (nodes.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Светофор пуст — в зоне видимости нет ни одного подразделения.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Иерархия подразделений</CardTitle>
      </CardHeader>
      <CardContent>
        <ul role="tree" aria-label="Светофор подразделений" className="space-y-px">
          {roots.map((root) => (
            <TreeRow
              key={root.division_id}
              node={root}
              depth={0}
              childrenMap={children}
              collapsed={collapsed}
              onToggle={toggle}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function TreeRow({
  node,
  depth,
  childrenMap,
  collapsed,
  onToggle,
  selectedId,
  onSelect,
}: {
  node: TrafficLightNode;
  depth: number;
  childrenMap: Map<number, TrafficLightNode[]>;
  collapsed: ReadonlySet<number>;
  onToggle: (id: number) => void;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}) {
  const kids = childrenMap.get(node.division_id) ?? [];
  const isCollapsed = collapsed.has(node.division_id);
  const isSelected = selectedId === node.division_id;

  return (
    <li role="treeitem" aria-expanded={kids.length > 0 ? !isCollapsed : undefined}>
      <div
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5",
          isSelected ? "bg-accent" : "hover:bg-accent/50"
        )}
        style={{ paddingLeft: `${8 + depth * 22}px` }}
      >
        {kids.length > 0 ? (
          <button
            type="button"
            onClick={() => onToggle(node.division_id)}
            aria-label={isCollapsed ? "Развернуть" : "Свернуть"}
            className="grid size-[22px] shrink-0 place-items-center text-muted-foreground"
          >
            {isCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        ) : (
          <span className="size-[22px] shrink-0" />
        )}
        <span
          className={cn(
            "size-2.5 shrink-0 rounded-full",
            COLOR_DOT[node.status]
          )}
          aria-hidden="true"
        />
        <button
          type="button"
          onClick={() => onSelect(isSelected ? null : node.division_id)}
          className="min-w-0 flex-1 truncate text-left text-[12.5px] font-medium"
          aria-pressed={isSelected}
        >
          {node.name === "" ? `Подразделение №${node.division_id}` : node.name}
        </button>
        {node.late && (
          <span className="whitespace-nowrap text-[11px] font-medium text-amber-700 dark:text-amber-400">
            с опозданием
          </span>
        )}
        <span
          className={cn(
            "inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold",
            COLOR_BADGE[node.status]
          )}
        >
          {COLOR_LABEL[node.status]}
        </span>
      </div>
      {kids.length > 0 && !isCollapsed && (
        <ul role="group" className="space-y-px">
          {kids.map((kid) => (
            <TreeRow
              key={kid.division_id}
              node={kid}
              depth={depth + 1}
              childrenMap={childrenMap}
              collapsed={collapsed}
              onToggle={onToggle}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Карточка выбранного узла: точечный цвет, версии сдач, выпуски. */
function DivisionCard({
  divisionId,
  divisionName,
  businessDate,
  canView,
  canDocuments,
  onToast,
}: {
  divisionId: number | null;
  divisionName: string | null;
  businessDate: string | null;
  canView: boolean;
  canDocuments: boolean;
  onToast: ReturnType<typeof useToast>["toast"];
}) {
  const lightQuery = useDivisionTrafficLight(
    { divisionId, businessDate },
    canView
  );
  const submissionsQuery = useDailySubmissions(
    { divisionId, businessDate },
    canView
  );
  const documentsQuery = useIssuedDocuments(
    { divisionId, businessDate },
    canView && canDocuments
  );
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const saveFile = useCallback(
    async (key: string, endpoint: string, fallbackName: string) => {
      setDownloadingId(key);
      try {
        const { blob, filename } = await opsApiClient.download(endpoint);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename ?? fallbackName;
        anchor.click();
        URL.revokeObjectURL(url);
      } catch (error) {
        onToast({
          title: "Выгрузка не удалась",
          description:
            error instanceof Error ? error.message : "Неизвестная ошибка",
          variant: "destructive",
        });
      } finally {
        setDownloadingId(null);
      }
    },
    [onToast]
  );

  if (divisionId === null) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Выберите подразделение в дереве — здесь появятся его версии сдач,
          выпуски и расхождение.
        </CardContent>
      </Card>
    );
  }

  const light = lightQuery.data;
  const submissions = submissionsQuery.data?.results ?? [];
  const documents = documentsQuery.data?.results ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="truncate">
            {divisionName ?? `Подразделение №${divisionId}`}
          </span>
          {light !== undefined && (
            <span
              className={cn(
                "inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold",
                COLOR_BADGE[light.status]
              )}
            >
              {COLOR_LABEL[light.status]}
              {light.late ? " · опоздание" : ""}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Цвет здесь — СВОЙ уровень узла, без свода потомков: он может
            отличаться от цвета того же узла в дереве, это разные вопросы. */}
        {lightQuery.isError && (
          <p className="text-xs text-muted-foreground">
            Точечный светофор недоступен:{" "}
            {lightQuery.error?.message ?? "ошибка чтения"}.
          </p>
        )}
        {light?.drift != null && (
          <p className="text-xs text-muted-foreground">
            Расхождение со сданным: добавились {light.drift.added.length},
            выбыли {light.drift.removed.length}, сменили состояние{" "}
            {light.drift.changed.length}. Поимённая расшифровка — следующим
            срезом.
          </p>
        )}

        <section aria-label="Версии сдач">
          <h3 className="mb-1 text-[12.5px] font-semibold">История версий</h3>
          {submissionsQuery.isLoading && (
            <p className="text-xs text-muted-foreground">Загрузка версий…</p>
          )}
          {!submissionsQuery.isLoading && submissions.length === 0 && (
            <p className="text-xs text-muted-foreground">
              За этот день подразделение не сдавало.
            </p>
          )}
          <ul className="divide-y">
            {submissions.map((submission) => (
              <li
                key={submission.id}
                className="flex items-center gap-2 py-2 text-[12px]"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">
                    Версия {submission.version}
                    {submission.is_current && (
                      <span className="ml-2 inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[10.5px] font-semibold text-green-800">
                        Действующая
                      </span>
                    )}
                    {submission.late && (
                      <span className="ml-2 text-[10.5px] font-medium text-amber-700 dark:text-amber-400">
                        с опозданием
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10.5px] text-muted-foreground">
                    {new Date(submission.submitted_at).toLocaleString("ru-RU")}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  disabled={downloadingId === `submission-${submission.id}`}
                  onClick={() =>
                    void saveFile(
                      `submission-${submission.id}`,
                      `/api/operations/daily-submissions/${submission.id}/export/`,
                      `submission-${submission.id}.xlsx`
                    )
                  }
                >
                  {downloadingId === `submission-${submission.id}` ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <Download className="h-3 w-3" aria-hidden="true" />
                  )}
                  <span className="ml-1">XLSX</span>
                </Button>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Выпуски документов">
          <h3 className="mb-1 text-[12.5px] font-semibold">Выпуски</h3>
          {!canDocuments && (
            <p className="text-xs text-muted-foreground">
              Реестр выпусков закрыт: нет права document.view.
            </p>
          )}
          {canDocuments && documentsQuery.isLoading && (
            <p className="text-xs text-muted-foreground">Загрузка выпусков…</p>
          )}
          {canDocuments &&
            !documentsQuery.isLoading &&
            documents.length === 0 && (
              <p className="text-xs text-muted-foreground">
                За этот день документ не выпускался.
              </p>
            )}
          <ul className="divide-y">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center gap-2 py-2 text-[12px]"
              >
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "font-semibold",
                      doc.status !== "ACTIVE" &&
                        "text-muted-foreground line-through"
                    )}
                  >
                    Исх. № {doc.number}/{doc.year}
                  </div>
                  <div className="mt-0.5 text-[10.5px] text-muted-foreground">
                    {doc.status === "ACTIVE"
                      ? `по версии сдачи ${doc.submission_version}`
                      : doc.supersedes_number !== null
                        ? `заменён № ${doc.supersedes_number}`
                        : "отозван"}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  disabled={downloadingId === `attachment-${doc.attachment_id}`}
                  onClick={() =>
                    void saveFile(
                      `attachment-${doc.attachment_id}`,
                      `/api/operations/attachments/${doc.attachment_id}/download/`,
                      doc.original_name
                    )
                  }
                >
                  {downloadingId === `attachment-${doc.attachment_id}` ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <Download className="h-3 w-3" aria-hidden="true" />
                  )}
                  <span className="ml-1">Скачать</span>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      </CardContent>
    </Card>
  );
}

/** Панель блокировки расхода на завтра: состояние, отстающие, законный обход. */
function TomorrowBlockCard({
  query,
  canOverride,
  onSelectDivision,
}: {
  query: ReturnType<typeof useTomorrowBlock>;
  canOverride: boolean;
  onSelectDivision: (id: number) => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState("");
  const override = useOverrideTomorrowBlock();

  const state = query.data;

  return (
    <Card
      className={cn(
        state?.blocked === true &&
          "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
      )}
    >
      <CardHeader>
        <CardTitle className="text-base">
          Блокировка расхода на завтра
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-[12px]">
        {query.isLoading && (
          <p className="text-muted-foreground">Загрузка состояния…</p>
        )}
        {query.isError && (
          <p className="text-muted-foreground">
            Состояние блокировки недоступно:{" "}
            {query.error?.message ?? "ошибка чтения"}.
          </p>
        )}
        {state !== undefined && (
          <>
            <p>
              {formatIsoDate(state.business_date)}:{" "}
              {state.blocked
                ? "расход ЗАКРЫТ — есть отстающие."
                : state.overridden
                  ? "замок снят законным обходом, отстающие остаются видны."
                  : "расход открыт: отстающих по правилам контроля сдачи нет."}
            </p>
            {state.laggards.length > 0 && (
              <div>
                <div className="mb-1 font-semibold">Не сдали:</div>
                <ul className="flex flex-wrap gap-1">
                  {state.laggards.map((laggard) => (
                    <li key={laggard.division_id}>
                      <button
                        type="button"
                        onClick={() => onSelectDivision(laggard.division_id)}
                        className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800 hover:bg-red-200"
                      >
                        {laggard.name === ""
                          ? `№${laggard.division_id}`
                          : laggard.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Напоминания отстающим шлёт автоматика после контрольного часа —
              с эскалацией руководителю; ручной отправки нет.
            </p>
            {state.blocked && !state.overridden && (
              <Button
                variant="outline"
                size="sm"
                disabled={!canOverride}
                title={
                  canOverride
                    ? undefined
                    : "Нужно право daily_report.override_block"
                }
                onClick={() => setDialogOpen(true)}
              >
                Снять блокировку
              </Button>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Законный обход блокировки</DialogTitle>
            <DialogDescription>
              Замок снимается со всего раздела на{" "}
              {state !== undefined ? formatIsoDate(state.business_date) : "дату"}
              . Причина обязательна и попадёт в журнал вместе с вашей подписью.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Почему расход открывается без сдачи отстающих"
            rows={3}
          />
          {override.isError && (
            <p className="text-xs text-destructive">
              {override.error?.message ?? "Обход не записан"}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={override.isPending}
            >
              Отмена
            </Button>
            <Button
              disabled={reason.trim() === "" || override.isPending || state === undefined}
              onClick={() => {
                if (state === undefined) return;
                override.mutate(
                  { businessDate: state.business_date, reason: reason.trim() },
                  {
                    onSuccess: () => {
                      setDialogOpen(false);
                      setReason("");
                    },
                  }
                );
              }}
            >
              {override.isPending && (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              )}
              Снять блокировку
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
