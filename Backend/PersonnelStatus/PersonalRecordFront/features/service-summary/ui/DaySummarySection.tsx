"use client";

// Один дневной срез «Свода по Службе» (Plane №992, §20.4 п.8): многодневный
// диапазон рендерится КАРТОЧКОЙ НА ДАТУ, а не одним сложенным числом —
// каждая дата хранит собственные версии и источники, и склейка их в общий
// итог обесценила бы личный состав, посчитанный за несколько дней разом.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { OpsApiError } from "@/lib/ops-errors";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import {
  SUMMARY_ASSEMBLE_PERMISSION,
  useAssembleSummary,
  useSendSummary,
} from "@/hooks/use-daily-summary-write";
import { formatIsoDate, formatIsoDateTime } from "@/shared/lib/date";
import { useSetStatusHost } from "@/features/daily-expense/ui/SetStatusHost";
import { useServiceTree } from "../model/use-service-tree";
import { DivisionRow, LeafEmployees } from "./DivisionRow";
import { ChevronRight } from "lucide-react";

/** Право дежурного на статусы «Руководству Службы» (Plane №1223, `[РАСХ-РШ-07]`):
 * сервер принимает его как второе право записи и добавляет к области ровно
 * корень организации. */
export const STATUS_MANAGE_ROOT_PERMISSION = "status.manage_root";

/**
 * «Руководство Службы» — сотрудники, прикреплённые к корню организации
 * напрямую (Plane №1223). До этого в дереве их не было вовсе: срез рисовал
 * только детей корня. Строка стоит ПЕРВОЙ, как «Руководство департамента» у
 * ответственного, в знаменатель «сдали N из M» не входит.
 */
function LeadershipRow({ rootId, businessDate, onPick }: { rootId: number; businessDate: string; onPick?: (person: { id: string; name: string }) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div role="group" aria-label="Руководство Службы" className="rounded-md border border-dashed">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex min-h-11 w-full items-center gap-2 px-2 py-1.5 text-left text-sm font-medium hover:bg-muted/50"
      >
        <ChevronRight aria-hidden size={16} className={open ? "rotate-90 transition-transform" : "transition-transform"} />
        <span className="flex-1">Руководство Службы</span>
        <span className="text-xs text-muted-foreground">в знаменатель не входит</span>
      </button>
      {open && <LeafEmployees divisionId={rootId} businessDate={businessDate} onPick={onPick} />}
    </div>
  );
}

export function DaySummarySection({ businessDate }: { businessDate: string }) {
  const tree = useServiceTree(businessDate);
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const canAssemble = hasPermission(SUMMARY_ASSEMBLE_PERMISSION);
  const assemble = useAssembleSummary();
  const send = useSendSummary();
  const [reason, setReason] = useState("");
  const canManageRoot = hasPermission(STATUS_MANAGE_ROOT_PERMISSION);
  const statusHost = useSetStatusHost(businessDate);

  const departments =
    tree.rootId !== null ? tree.childrenOf.get(tree.rootId) ?? [] : [];
  const rootSubmission =
    tree.rootId !== null
      ? tree.submissionByDivision.get(String(tree.rootId))
      : undefined;
  const assembled = rootSubmission !== undefined;
  const alreadySent = rootSubmission?.sent_at != null;

  const submittedDepartments = departments.filter((department) =>
    tree.submissionByDivision.has(String(department.division_id))
  );
  const laggardDepartments = departments.filter(
    (department) => !tree.submissionByDivision.has(String(department.division_id))
  );

  const sendNeedsReason =
    send.error !== null &&
    send.error instanceof OpsApiError &&
    Array.isArray(send.error.details.laggards);

  return (
    <section
      role="region"
      aria-label={`Свод по Службе на ${formatIsoDate(businessDate)}`}
      className="space-y-3 rounded-lg border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{formatIsoDate(businessDate)}</h2>
        {tree.rootId !== null && !permissionsLoading && canAssemble && !assembled && (
          <Button
            type="button"
            size="sm"
            disabled={assemble.isPending}
            onClick={() => {
              assemble.reset();
              assemble.mutate({
                division_id: tree.rootId as number,
                business_date: businessDate,
              });
            }}
          >
            {assemble.isPending ? "Собираем…" : "Собрать свод Службы"}
          </Button>
        )}
        {tree.rootId !== null && !permissionsLoading && canAssemble && assembled && !alreadySent && (
          <Button
            type="button"
            size="sm"
            disabled={send.isPending || (sendNeedsReason && reason.trim() === "")}
            onClick={() => {
              send.mutate({
                division_id: tree.rootId as number,
                business_date: businessDate,
                reason,
              });
            }}
          >
            {send.isPending ? "Отправляем…" : "Отправить дежурному"}
          </Button>
        )}
      </div>

      {tree.isPending && (
        <p className="text-sm text-muted-foreground">Загрузка структуры и сдач…</p>
      )}
      {!tree.isPending && tree.isError && (
        <p role="alert" className="text-sm text-muted-foreground">
          Не удалось прочитать структуру подразделений
        </p>
      )}

      {!tree.isPending && !tree.isError && tree.rootId !== null && (
        <>
          <p className="text-sm">
            Сдали {submittedDepartments.length} из {departments.length} департаментов
            {alreadySent && rootSubmission !== undefined && (
              <>
                {" "}
                — свод отправлен {formatIsoDateTime(rootSubmission.sent_at as string)} ·{" "}
                {rootSubmission.sent_by}
                {rootSubmission.incomplete_reason !== "" && (
                  <> (неполный: «{rootSubmission.incomplete_reason}»)</>
                )}
              </>
            )}
          </p>
          {laggardDepartments.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Не сдали: {laggardDepartments.map((department) => department.name).join(", ")}
            </p>
          )}
          {send.isError && (
            <p role="alert" className="text-sm text-muted-foreground">
              {sendNeedsReason
                ? "Свод неполный — укажите причину и подтвердите отправку"
                : "Отправка не удалась"}
            </p>
          )}
          {sendNeedsReason && !send.isSuccess && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Причина неполной отправки — обязательна"
                className="min-w-64 flex-1 rounded-md border bg-background px-2 py-1 text-sm"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={send.isPending || reason.trim() === ""}
                onClick={() => {
                  send.mutate({
                    division_id: tree.rootId as number,
                    business_date: businessDate,
                    reason,
                  });
                }}
              >
                Подтвердить отправку
              </Button>
            </div>
          )}
          {send.isSuccess && (
            <p role="status" className="text-sm text-muted-foreground">
              Свод отправлен дежурному
            </p>
          )}

          {tree.rootId !== null && (
            <LeadershipRow rootId={tree.rootId} businessDate={businessDate} onPick={canManageRoot ? statusHost.pick : undefined} />
          )}
          <div role="list" aria-label="Департаменты" className="space-y-0.5">
            {departments.map((department) => (
              <DivisionRow
                key={department.division_id}
                node={department}
                depth={0}
                childrenOf={tree.childrenOf}
                submissionByDivision={tree.submissionByDivision}
                businessDate={businessDate}
              />
            ))}
            {departments.length === 0 && (
              <p className="text-sm text-muted-foreground">Департаментов не найдено</p>
            )}
          </div>
          {statusHost.dialog}
        </>
      )}
      {!tree.isPending && !tree.isError && tree.rootId === null && (
        <p className="text-sm text-muted-foreground">
          Корень организации не определён по структуре подразделений
        </p>
      )}
      {!permissionsLoading && !canAssemble && (
        <p className="text-xs text-muted-foreground">
          Сборка и отправка свода Службы закрыты правом «Суточный отчёт: генерация».
        </p>
      )}
    </section>
  );
}
