"use client";

// Карточка дежурства одним согласованным срезом: смена, вид, производный
// статус паспорта (stale — предупреждение), конфликты дня и линейный цикл
// действий: ознакомление → заступление → завершение; отмена — с причиной,
// только для не начатой смены.
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useAcknowledgeDutyShift,
  useCancelDutyShift,
  useClockInDutyShift,
  useClockOutDutyShift,
  useDutyShiftDetail,
} from "@/hooks/use-duty-shifts";
import { ShiftStatusBadge } from "@/entities/duty-shift";

export default function DutyShiftPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const query = useDutyShiftDetail(id);

  const acknowledge = useAcknowledgeDutyShift(id);
  const clockIn = useClockInDutyShift(id);
  const clockOut = useClockOutDutyShift(id);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelErrors, setCancelErrors] = useState<Record<string, unknown> | null>(
    null
  );
  const cancel = useCancelDutyShift(id, {
    onFormError: (details) => setCancelErrors(details),
  });

  if (query.isLoading) {
    return (
      <DashboardLayout>
        <p className="text-sm text-muted-foreground">Загрузка смены…</p>
      </DashboardLayout>
    );
  }
  if (query.isError || query.data === undefined) {
    return (
      <DashboardLayout>
        <p className="text-sm text-destructive">Смена не найдена или недоступна.</p>
        <Link
          href="/security-ops/duties"
          className="mt-2 inline-block text-sm font-semibold text-primary"
        >
          ← Назад к плану
        </Link>
      </DashboardLayout>
    );
  }

  const { shift, passportStatus, dutyType, conflicts } = query.data;
  const actionError =
    acknowledge.error ?? clockIn.error ?? clockOut.error ?? cancel.error;

  return (
    <DashboardLayout>
      <Link
        href="/security-ops/duties"
        className="mb-3 inline-block text-xs font-semibold text-primary"
      >
        ← Назад к плану
      </Link>

      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="mb-1 flex items-center gap-2">
            <ShiftStatusBadge state={shift.stateCode} />
            <span className="text-xs text-muted-foreground tabular-nums">
              {shift.businessDate}
            </span>
          </div>
          <h1 className="text-xl font-bold">{shift.target.safeLabel}</h1>
          <p className="text-sm text-muted-foreground">
            {dutyType !== null
              ? `${dutyType.safeLabel} · отдых после: ${Math.round(dutyType.restAfterMinutes / 60)} ч`
              : "Вид дежурства отсутствует в реестре — правила отдыха неизвестны."}
          </p>
          <p className="text-sm">
            Исполнитель: <span className="font-semibold">{shift.employeeName}</span>
          </p>
          {shift.note !== null && (
            <p className="text-xs text-muted-foreground">Примечание: {shift.note}</p>
          )}
          {shift.overrideReason !== null && (
            <p className="text-xs text-amber-700">
              Заведена с обходом мягкого конфликта: {shift.overrideReason}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {shift.passportBinding !== null
              ? `Паспорт: ${shift.passportBinding.objectName}, версия ${shift.passportBinding.versionNumber} · ${shift.passportBinding.sectorName} · ${shift.passportBinding.postName}`
              : "Привязки к версии паспорта нет."}
          </p>
          {passportStatus.stale && (
            <Alert className="mt-2 border-amber-300">
              <AlertDescription>
                Действует версия паспорта новее привязанной (v
                {passportStatus.applicableVersionNumber}) — смена не
                переписывается автоматически.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {conflicts.length > 0 && (
        <Card className="mb-4 border-amber-300">
          <CardHeader>
            <CardTitle>Конфликты этого дня</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1">
              {conflicts.map((conflict) => (
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
          <CardTitle>Действия</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {shift.stateCode === "PLANNED" && (
              <Button
                type="button"
                disabled={acknowledge.isPending}
                onClick={() => acknowledge.mutate({})}
              >
                Отметить ознакомление
              </Button>
            )}
            {shift.stateCode === "ACKNOWLEDGED" && (
              <Button
                type="button"
                disabled={clockIn.isPending}
                onClick={() => clockIn.mutate({})}
              >
                Заступить на дежурство
              </Button>
            )}
            {shift.stateCode === "ACTIVE" && (
              <Button
                type="button"
                disabled={clockOut.isPending}
                onClick={() => clockOut.mutate({})}
              >
                Завершить дежурство
              </Button>
            )}
          </div>
          {shift.acknowledgedAt !== null && (
            <p className="text-xs text-muted-foreground">
              Ознакомлен: {shift.acknowledgedAt}
            </p>
          )}
          {shift.actualStart !== null && (
            <p className="text-xs text-muted-foreground">
              Заступил: {shift.actualStart}
            </p>
          )}
          {shift.actualEnd !== null && (
            <p className="text-xs text-muted-foreground">
              Завершил: {shift.actualEnd}
            </p>
          )}

          {shift.stateCode === "CANCELLED" && shift.cancellation !== null && (
            <Alert variant="destructive">
              <AlertDescription>
                Смена отменена {shift.cancellation.cancelledAt}: {" "}
                {shift.cancellation.reason}
              </AlertDescription>
            </Alert>
          )}

          {(shift.stateCode === "PLANNED" ||
            shift.stateCode === "ACKNOWLEDGED") && (
            <div className="space-y-2 border-t pt-3">
              <Label htmlFor="cancel-reason">Причина отмены *</Label>
              <Textarea
                id="cancel-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
              {cancelErrors !== null && Object.keys(cancelErrors).length > 0 && (
                <p className="text-xs text-destructive" role="alert">
                  Укажите причину отмены.
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={cancel.isPending}
                onClick={() => {
                  setCancelErrors(null);
                  cancel.mutate({ reason: cancelReason });
                }}
              >
                {cancel.isPending ? "Отмена…" : "Отменить смену"}
              </Button>
            </div>
          )}

          {actionError !== null && (
            <p className="text-sm text-destructive" role="alert">
              {actionError.message}
            </p>
          )}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
