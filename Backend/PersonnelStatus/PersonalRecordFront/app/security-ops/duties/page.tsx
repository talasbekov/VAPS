"use client";

// План дежурств: месяц в URL, шапка lifecycle (доступность кнопок приходит
// от сервера с причинами), серверные KPI, конфликты и таблица смен месяца.
import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CalendarDays } from "lucide-react";
import {
  useApprovePlan,
  useCheckPlanConflicts,
  useCreatePlanDraft,
  useMonthlyDutyPlan,
  useReopenPlan,
} from "@/hooks/use-duty-plan";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { CreateDutyShiftDialog } from "@/features/duty-plan-lifecycle";
import {
  PLAN_HISTORY_LABEL,
  PLAN_STATE_LABEL,
  ShiftStatusBadge,
} from "@/entities/duty-shift";
import type {
  DutyPlanAction,
  MonthlyDutyPlanResponse,
} from "@/entities/duty-shift";

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export default function DutiesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const [dialogOpen, setDialogOpen] = useState(false);

  const monthParam = searchParams.get("month");
  const month = /^\d{4}-\d{2}$/.test(monthParam ?? "")
    ? (monthParam as string)
    : currentMonth();

  const query = useMonthlyDutyPlan(month);

  const draft = useCreatePlanDraft();
  const check = useCheckPlanConflicts();
  const approve = useApprovePlan();
  const reopen = useReopenPlan();
  const actionError =
    draft.error ?? check.error ?? approve.error ?? reopen.error;

  const actionRunner = useMemo(
    () => ({
      CREATE_DRAFT: () => draft.mutate({ month }),
      CHECK_CONFLICTS: () => check.mutate({ month }),
      APPROVE: () => approve.mutate({ month }),
      REOPEN: () => reopen.mutate({ month }),
      ADD_SHIFT: () => setDialogOpen(true),
    }),
    [draft, check, approve, reopen, month]
  );

  function setMonth(next: string): void {
    const params = new URLSearchParams(searchParams);
    params.set("month", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  if (!permissionsLoading && !hasPermission("duty.view")) {
    return (
      <DashboardLayout>
        <Card>
          <CardContent className="p-9 text-center text-sm text-muted-foreground">
            Недостаточно прав для просмотра плана дежурств.
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            <CalendarDays className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">План дежурств</h1>
              <p className="text-muted-foreground">
                Суточные дежурства и месячный план ·{" "}
                <Link
                  href="/security-ops/duties/combat"
                  className="text-primary underline"
                >
                  Боевые группы на Трассе
                </Link>
              </p>
            </div>
          </div>
          <Input
            className="w-44"
            type="month"
            aria-label="Месяц плана"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </header>

        {query.isLoading && (
          <p className="text-sm text-muted-foreground">Загрузка плана…</p>
        )}
        {query.isError && (
          <p className="text-sm text-destructive">
            Не удалось загрузить план дежурств.
          </p>
        )}
        {query.data !== undefined && (
          <PlanContent
            plan={query.data}
            onAction={(code) =>
              actionRunner[code as keyof typeof actionRunner]?.()
            }
            actionErrorMessage={actionError?.message ?? null}
          />
        )}

        <CreateDutyShiftDialog
          open={dialogOpen}
          defaultDate={`${month}-01`}
          onClose={() => setDialogOpen(false)}
        />
      </div>
    </DashboardLayout>
  );
}

function PlanContent({
  plan,
  onAction,
  actionErrorMessage,
}: {
  plan: MonthlyDutyPlanResponse;
  onAction: (code: DutyPlanAction["code"]) => void;
  actionErrorMessage: string | null;
}) {
  const statusById = new Map(
    plan.passportStatuses.map((status) => [status.shiftId, status])
  );
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            План на {plan.month}:{" "}
            {plan.record === null
              ? "черновик не сформирован"
              : `${PLAN_STATE_LABEL[plan.record.stateCode]} (редакция ${plan.record.revision})`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {plan.actions.map((action) => (
              <Button
                key={action.code}
                type="button"
                variant={action.code === "APPROVE" ? "default" : "outline"}
                size="sm"
                disabled={!action.enabled}
                title={action.reason ?? undefined}
                onClick={() => onAction(action.code)}
              >
                {action.label}
              </Button>
            ))}
          </div>
          {/* причины недоступности — те же, что в title: видимы всегда */}
          <ul className="flex flex-col gap-0.5">
            {plan.actions
              .filter((action) => !action.enabled && action.reason !== null)
              .map((action) => (
                <li key={action.code} className="text-[11px] text-muted-foreground">
                  {action.label}: {action.reason}
                </li>
              ))}
          </ul>
          {actionErrorMessage !== null && (
            <p className="text-sm text-destructive" role="alert">
              {actionErrorMessage}
            </p>
          )}
          {plan.record?.lastValidation && (
            <p className="text-xs text-muted-foreground">
              Последняя проверка: {plan.record.lastValidation.checkedAt} — жёстких{" "}
              {plan.record.lastValidation.hardConflicts}, мягких{" "}
              {plan.record.lastValidation.softConflicts}
              {plan.record.lastValidation.passed ? " (пройдена)" : " (не пройдена)"}
            </p>
          )}
          {plan.record !== null && plan.record.history.length > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer font-semibold">История</summary>
              <ul className="mt-1 flex flex-col gap-0.5">
                {plan.record.history.map((entry, index) => (
                  <li key={index}>
                    {entry.at} · ред. {entry.revision} ·{" "}
                    {PLAN_HISTORY_LABEL[entry.event]} — {entry.note}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          ["Смен в месяце", plan.kpi.totalShifts],
          ["Активных", plan.kpi.activeShifts],
          ["Отменено", plan.kpi.cancelledShifts],
          ["Жёстких конфликтов", plan.kpi.hardConflicts],
          ["Мягких конфликтов", plan.kpi.softConflicts],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardContent className="p-3">
              <p className="text-[11px] font-semibold text-muted-foreground">
                {label}
              </p>
              <p className="text-xl font-bold tabular-nums">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {plan.conflicts.length > 0 && (
        <Card className="border-amber-300">
          <CardHeader>
            <CardTitle>Конфликты месяца</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1">
              {plan.conflicts.map((conflict) => (
                <li key={conflict.conflictId} className="text-xs">
                  <span
                    className={
                      conflict.severity === "HARD"
                        ? "font-bold text-red-700"
                        : "font-bold text-amber-700"
                    }
                  >
                    [{conflict.severity === "HARD" ? "жёсткий" : "мягкий"}]
                  </span>{" "}
                  {conflict.message}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Смены месяца</CardTitle>
        </CardHeader>
        {plan.shifts.length === 0 ? (
          <CardContent className="text-sm text-muted-foreground">
            Смен на этот месяц нет.
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Объект</TableHead>
                <TableHead>Пост</TableHead>
                <TableHead>Исполнитель</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Паспорт</TableHead>
                <TableHead>
                  <span className="sr-only">Действия</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.shifts.map((shift) => {
                const status = statusById.get(shift.id);
                return (
                  <TableRow key={shift.id}>
                    <TableCell className="tabular-nums">
                      {shift.businessDate}
                    </TableCell>
                    <TableCell>{shift.target.safeLabel}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {shift.passportBinding !== null
                        ? `${shift.passportBinding.sectorName} · ${shift.passportBinding.postName}`
                        : "—"}
                    </TableCell>
                    <TableCell>{shift.employeeName}</TableCell>
                    <TableCell>
                      <ShiftStatusBadge state={shift.stateCode} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {status?.stale
                        ? `⚠ действует v${status.applicableVersionNumber}, привязка v${shift.passportBinding?.versionNumber}`
                        : shift.passportBinding !== null
                          ? `v${shift.passportBinding.versionNumber}`
                          : "без привязки"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Link
                        href={`/security-ops/duties/${shift.id}`}
                        className="text-primary"
                      >
                        ›
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
