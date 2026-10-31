"use client";

// Один дневной срез «Свода по Службе» (Plane №992 → №1232, макет одобрен
// заказчиком 12.09.2026). Многодневный диапазон — срез НА ДАТУ (§20.4 п.8),
// между днями ничего не суммируется.
//
// Дежурный свод Службы ТОЛЬКО СОБИРАЕТ (`[РАСХ-РШ-09]`, решение заказчика
// 12.09.2026): «отправить дежурному» на уровне Службы некому — он и есть
// дежурный. Кнопка отправки, поле причины и подсказка про адресата, заведённые
// №992, сняты; состояния свода Службы — «не собран» / «собран vN».
import { useContext, useMemo, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { opsApiClient } from "@/lib/ops-api";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import {
  SUMMARY_ASSEMBLE_PERMISSION,
  useAssembleSummary,
} from "@/hooks/use-daily-summary-write";
import { formatIsoDate, formatIsoDateTime } from "@/shared/lib/date";
import { SummaryVersions, assembleFailureText } from "@/features/daily-expense/ui/SummaryVersions";
import { useServiceDay } from "../model/use-service-day";
import { ServiceSummaryRootActionContext, ServiceSummaryWorkspaceReadyContext } from "../model/workspace-context";
import { SummaryCorrection } from "@/features/daily-expense/ui/SummaryCorrection";
import { DivisionRow, FiguresCells, COLUMN_COUNT } from "./DivisionRow";

interface ReminderResult {
  business_date: string;
  laggard_division_ids: number[];
  notified_recipient_count: number;
  unresolved_division_ids: number[];
}

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold tabular-nums leading-tight">{value}</div>
    </div>
  );
}

/** Прямое подчинение Службе учитывается только в числовых итогах. */
function ServiceStaffRow({ figures }: { figures: ReturnType<ReturnType<typeof useServiceDay>["exactFigures"]> }) {
  return (
      <tr className="bg-muted/30" aria-level={1}>
        <td className="px-2 py-1.5">
          <span role="img" aria-label="Сдача не требуется" title="Сдача не требуется" className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-slate-400 align-middle" />
          <span className="font-semibold">Сотрудники прямого подчинения Службе</span>
          <span className="ml-2 rounded-full border px-2 text-[11px] text-muted-foreground">в знаменатель не входит</span>
        </td>
        <FiguresCells figures={figures} />
        <td className="px-2 py-1.5 text-right">
          <Badge variant="outline" className="border-transparent bg-primary/10 text-primary">числовые итоги</Badge>
        </td>
      </tr>
  );
}

export function DaySummarySection({ businessDate }: { businessDate: string }) {
  const day = useServiceDay(businessDate);
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const rootActionsAllowed = useContext(ServiceSummaryRootActionContext);
  const workspaceReady = useContext(ServiceSummaryWorkspaceReadyContext);
  const canAssemble = rootActionsAllowed && !permissionsLoading && hasPermission(SUMMARY_ASSEMBLE_PERMISSION);
  const assemble = useAssembleSummary();
  const remind = useMutation({
    mutationFn: () =>
      opsApiClient.post<ReminderResult>("/api/operations/daily-summaries/remind/", {
        division_id: day.rootId,
        business_date: businessDate,
      }),
  });

  const assembled = day.rootSubmission !== undefined;
  // A temporary context/read refresh hides data, but must not discard a
  // mounted correction draft. Actor/root/date changes and read denials discard
  // it; a write-only grant change must keep the input while disabling submit.
  const correction = useRef<{ scope: string; rootId: number } | null>(null);
  if (correction.current?.scope !== day.draftContext || day.readBlocked) correction.current = null;
  if (day.readAllowed && !day.isPending && !day.isError) {
    correction.current = assembled && day.rootId !== null ? { scope: day.draftContext, rootId: day.rootId } : null;
  }
  const correctionRootId = correction.current?.rootId ?? null;
  const rootStale = day.rootId !== null && day.isStale(day.rootId);
  const nameOf = useMemo(
    () => (id: number) => day.nodeById.get(id)?.name ?? `Подразделение №${id}`,
    [day.nodeById]
  );

  const chip = !day.isPending && day.rootId !== null
    ? assembled
      ? rootStale
        ? { tone: "warn", text: `Свод Службы устарел · v${day.rootSubmission!.version} — департамент пересдал` }
        : { tone: "ok", text: `Свод Службы собран · v${day.rootSubmission!.version} · ${formatIsoDateTime(day.rootSubmission!.submitted_at)}` }
      : { tone: "off", text: "Свод Службы не собран" }
    : { tone: "off", text: "Свод Службы: проверяем…" };
  const chipClass = {
    off: "bg-muted text-muted-foreground",
    warn: "bg-amber-50 text-amber-800  ",
    ok: "bg-emerald-50 text-emerald-700  ",
  }[chip.tone as "off" | "warn" | "ok"];

  return (
    <section
      role="region"
      aria-label={`Свод по Службе на ${formatIsoDate(businessDate)}`}
      className="space-y-4"
    >
      {day.isPending && <p className="text-sm text-muted-foreground">Загрузка структуры и сдач…</p>}
      {!day.isPending && day.isError && (
        <div role="alert" className="space-y-2 text-sm text-muted-foreground">
          <p>{day.readBlocked ? "Доступ к структуре и состоянию сдачи не подтверждён. Проверьте права доступа." : "Не удалось прочитать структуру и состояние сдачи."}</p>
          {!day.readBlocked && <Button type="button" size="sm" variant="outline" disabled={!day.canRetry} aria-busy={day.retryPending} onClick={() => void day.retry()}>
            {day.retryPending ? "Загрузка свода…" : "Повторить загрузку свода"}
          </Button>}
        </div>
      )}

      {correctionRootId !== null && <SummaryCorrection key={day.draftContext} divisionId={correctionRootId} businessDate={businessDate} workspaceReady={workspaceReady} dataReady={day.readAllowed && !day.isError && !day.isPending && !day.retryPending} />}

      {!day.isPending && !day.isError && day.rootId !== null && (
        <>
          <div className="grid gap-4 rounded-xl border border-primary/20 bg-primary/5 p-4 md:grid-cols-[minmax(0,1fr)_minmax(280px,36%)]">
            <div>
              <h2 className="text-lg font-semibold tabular-nums">
                {formatIsoDate(businessDate)} · Сдали {day.submittedDepartments.length} из {day.departments.length} департаментов
              </h2>
              <progress
                className="mt-2 block h-2 w-full accent-primary"
                max={Math.max(day.departments.length, 1)}
                value={day.submittedDepartments.length}
                aria-label="Сдача обязательных департаментов"
              />
              <p className="mt-2 text-sm text-muted-foreground">
                {day.laggardDepartments.length > 0 ? (
                  <>Не сдали: <span className="font-semibold text-red-700 ">{day.laggardDepartments.map((node) => node.name).join(", ")}</span>.</>
                ) : (
                  <>Все департаменты сдали.</>
                )}
                {day.staleDepartments.length > 0 && <> Пересдано после отправки: {day.staleDepartments.map((node) => node.name).join(", ")}.</>}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Tile label="По списку" value={day.reportError ? "—" : day.totals?.listTotal ?? "…"} />
                <Tile label="В строю" value={day.reportError ? "—" : day.totals?.inService ?? "…"} />
                <Tile label="Отклонения" value={day.reportError ? "—" : day.totals?.deviations ?? "…"} />
                <Tile label="Неполных сводов" value={day.incompleteDepartments.length} />
              </dl>
              {day.reportError && <div role="alert" className="mt-2 space-y-2 text-xs text-muted-foreground">
                <p>{day.reportReadBlocked ? "Доступ к расходу на дату не подтверждён — числа недоступны. Проверьте права доступа." : "Расход на дату не прочитался — числа недоступны, дерево сдач показано без них."}</p>
                {!day.reportReadBlocked && <Button type="button" size="sm" variant="outline" disabled={!day.canRetryReport} aria-busy={day.reportRetryPending} onClick={() => void day.retryReport()}>
                  {day.reportRetryPending ? "Загрузка чисел…" : "Повторить загрузку чисел"}
                </Button>}
              </div>}
            </div>
            <div role="region" aria-label="Свод Службы" className="grid content-start gap-2 rounded-lg border bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span role="status" aria-atomic="true" className={`inline-flex min-h-8 items-center rounded-full px-3 text-xs font-semibold ${chipClass}`}>{chip.text}</span>
                {!permissionsLoading && canAssemble && !assembled && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={assemble.isPending}
                    onClick={() => {
                      if (!canAssemble || assemble.isPending || day.rootId === null) return;
                      assemble.reset();
                      assemble.mutate({ division_id: day.rootId as number, business_date: businessDate });
                    }}
                  >
                    {assemble.isPending ? "Собираем…" : "Собрать свод Службы"}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {assembled
                  ? "Свод Службы собран для контроля: дальше он никому не отправляется. Пересдача департамента делает его устаревшим — тогда версии ниже покажут расхождение."
                  : "Свод Службы собирается из действующих сводов департаментов; недостающие остаются видны как «не сдали». Никому не отправляется — дежурный собирает его для себя."}
              </p>
              {assemble.isError && <p role="alert" className="text-sm text-muted-foreground">{assembleFailureText(assemble.error)}</p>}
              {assemble.isSuccess && <p role="status" className="text-sm text-muted-foreground">Свод Службы собран — версия в списке ниже</p>}
              <div className="flex flex-wrap gap-2">
                {!permissionsLoading && canAssemble && (
                  <Button type="button" size="sm" variant="outline" disabled={remind.isPending || day.laggardDepartments.length === 0} onClick={() => {
                    if (!canAssemble || remind.isPending || day.rootId === null || day.laggardDepartments.length === 0) return;
                    remind.mutate();
                  }}>
                    {remind.isPending ? "Отправка напоминаний…" : "Напомнить несдавшим"}
                  </Button>
                )}
              </div>
              {!permissionsLoading && !canAssemble && <p className="text-xs text-muted-foreground">Свод доступен для просмотра. Сборка и напоминания для Службы вам недоступны.</p>}
              {remind.isSuccess && (
                <p role="status" className="text-xs text-muted-foreground">
                  Получателей уведомлено: {remind.data.notified_recipient_count}.
                  {remind.data.unresolved_division_ids.length > 0 && <> Без получателя: {remind.data.unresolved_division_ids.map(nameOf).join(", ")}.</>}
                </p>
              )}
              {remind.isError && <p role="alert" className="text-xs text-muted-foreground">Напоминания не отправлены. Повторите попытку.</p>}
            </div>
          </div>

          <div className="rounded-xl border bg-card">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b px-3 py-2.5">
              <div>
                <h3 className="text-sm font-semibold">Служба по департаментам</h3>
                <p className="text-xs text-muted-foreground">Начальники департаментов и заместители показаны поимённо со статусами. Остальной состав — числовые итоги по подразделениям.</p>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label="Обозначения">
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-600" />отправлено · сдано</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-600" />собран, не отправлен · пересдано</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-600" />не сдано</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-400" />сдача не требуется</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm" aria-label="Служба по департаментам">
                <thead>
                  <tr className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-2 py-2 text-left font-medium">Подразделение</th>
                    <th scope="col" className="w-16 px-2 py-2 text-right font-medium">Список</th>
                    <th scope="col" className="w-16 px-2 py-2 text-right font-medium">В строю</th>
                    <th scope="col" className="w-16 px-2 py-2 text-right font-medium">Откл.</th>
                    <th scope="col" className="w-64 px-2 py-2 text-right font-medium">Состояние на {formatIsoDate(businessDate)}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <ServiceStaffRow figures={day.exactFigures(day.rootId)} />
                  {day.departments.map((department) => (
                    <DivisionRow key={department.division_id} node={department} depth={0} day={day} businessDate={businessDate} />
                  ))}
                  {day.departments.length === 0 && (
                    <tr><td colSpan={COLUMN_COUNT} className="px-2 py-3 text-sm text-muted-foreground">Департаментов не найдено</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <section role="region" aria-label="Версии свода Службы">
            <SummaryVersions
              variant="history"
              businessDate={businessDate}
              boardDivisionIds={day.departments.map((node) => node.division_id)}
              labelOfDivision={nameOf}
              scopeDivisionId={day.rootId}
            />
          </section>
        </>
      )}
    </section>
  );
}
