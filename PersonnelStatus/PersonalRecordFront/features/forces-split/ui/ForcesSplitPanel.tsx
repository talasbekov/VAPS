"use client";

// Раскладка потребности по департаментам — первое звено цепочки «Сбор сил на
// ОМ» (задача заказчика Plane №73, шаг «СС-1»). Живёт ВНУТРИ ленты входящих
// штаба: разложить пришедшее число — не отдельная работа со своим экраном, а
// продолжение той строки, в которой это число показано.
//
// Итог («разложено M из N») берётся у сервера: по этому же числу он отбивает
// перебор, и второй счёт на клиенте разошёлся бы с ним молча. Считается на
// клиенте только СУММА того, что человек набрал в форме прямо сейчас, — она
// про несохранённый черновик, о котором сервер ещё не знает.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FieldErrors,
  StageError,
} from "@/features/security-event-stages/ui/StageErrors";
import {
  useNotifyDirectorates,
  useSplitForceDemand,
} from "@/hooks/use-security-event-stages";
import { apiClient, type CoreDivision } from "@/lib/api";
import type {
  ForceAllocationRow,
  ForceAllocationStatus,
  SecurityEvent,
} from "@/entities/security-event";
import { formatIsoDateTime } from "@/shared/lib/date";

/** Строка формы. `key` — своя, стабильная: departmentId ещё может быть пуст.
 *
 * Признака «заявка уже ушла» здесь НЕТ сознательно: он живёт на сервере и
 * меняется мимо этой формы (оповещение управлений, решение штаба). Копия в
 * состоянии формы протухала бы молча — ровно на этом и упала первая проба
 * оповещения: кнопка снятия оставалась живой у заявки, уже ушедшей в
 * департамент.
 */
interface DraftRow {
  key: string;
  departmentId: string;
  need: string;
  departmentName: string;
}

function seedRows(event: SecurityEvent): DraftRow[] {
  return event.forceAllocation.map((row) => ({
    key: row.id,
    departmentId: row.departmentId,
    need: String(row.need),
    departmentName: row.departmentName,
  }));
}

export function ForcesSplitPanel({ event }: { event: SecurityEvent }) {
  const [rows, setRows] = useState<DraftRow[]>(() => seedRows(event));
  const [saved, setSaved] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, unknown> | null>(
    null
  );
  const { departments, isLoading } = useDepartments();
  const split = useSplitForceDemand(event.id, {
    onEvent: (fresh) => {
      // Строки перечитываются из ОТВЕТА: сервер мог сохранить не то, что
      // набрано (имя департамента, статус заявки), и оставить форму как есть
      // значило бы показывать человеку его черновик вместо сохранённого.
      setRows(seedRows(fresh));
      setFieldErrors(null);
      setSaved(true);
    },
    onFormError: (details) => {
      setFieldErrors(details);
      setSaved(false);
    },
  });

  const total = event.forceDemandTotal;
  const drafted = rows.reduce((sum, row) => sum + toCount(row.need), 0);
  const remainder = total - drafted;

  const patch = (key: string, next: Partial<DraftRow>) => {
    setSaved(false);
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...next } : row))
    );
  };

  const taken = new Set(rows.map((row) => row.departmentId).filter(Boolean));
  // Состояние заявки живёт на СЕРВЕРЕ и в форме не редактируется: форма про
  // «кому сколько», а оповещение и списки — про то, что с заявкой уже сделали.
  const stored = new Map(
    event.forceAllocation.map((row) => [row.departmentId, row])
  );

  return (
    <div className="mt-3 border-t pt-3" data-slot="forces-split">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Раскладка по департаментам
        </h4>
        <p
          className="text-xs tabular-nums text-muted-foreground"
          data-slot="forces-split-total"
        >
          разложено <b className="text-foreground">{drafted}</b> из {total}
          {remainder > 0 && <> · остаток {remainder}</>}
          {remainder < 0 && (
            <span className="text-destructive-ink"> · перебор {-remainder}</span>
          )}
        </p>
      </div>

      {rows.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Запрос ещё не разложен — добавьте департамент и укажите, сколько
          человек он выделяет.
        </p>
      )}

      <div className="mt-2 flex flex-col gap-2">
        {rows.map((row, index) => {
          const storedRow = stored.get(row.departmentId);
          const locked = storedRow !== undefined && storedRow.status !== "DRAFT";
          return (
          <div key={row.key} className="flex flex-wrap items-center gap-2">
            <select
              aria-label={`Департамент, строка ${index + 1}`}
              // Гашение видно: у собственного <select> нет disabled-стиля shadcn,
              // и заблокированная строка выглядела бы обычной.
              className="h-9 min-w-[14rem] flex-1 rounded-md border border-input bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              value={row.departmentId}
              disabled={locked}
              onChange={(e) => patch(row.key, { departmentId: e.target.value })}
            >
              <option value="">
                {isLoading ? "Загрузка справочника…" : "Выберите департамент"}
              </option>
              {/* Уже занятые департаменты из списка убраны: у департамента одна
                  заявка и один ответственный, и повтор сервер отбивает. Своё
                  значение строки остаётся, иначе выбранное исчезало бы. */}
              {departments
                .filter(
                  (department) =>
                    !taken.has(String(department.id)) ||
                    String(department.id) === row.departmentId
                )
                .map((department) => (
                  <option key={department.id} value={String(department.id)}>
                    {department.name}
                  </option>
                ))}
              {/* Заявка, чей департамент справочник больше не отдаёт (скрыт,
                  переименован), обязана остаться видимой — иначе строка
                  выглядела бы пустой, а сервер её всё равно бы держал. */}
              {row.departmentId !== "" &&
                !departments.some(
                  (department) => String(department.id) === row.departmentId
                ) && (
                  <option value={row.departmentId}>
                    {row.departmentName || `Департамент ${row.departmentId}`}
                  </option>
                )}
            </select>
            <Input
              aria-label={`Сколько человек, строка ${index + 1}`}
              className="h-9 w-24 tabular-nums"
              inputMode="numeric"
              value={row.need}
              onChange={(e) => patch(row.key, { need: e.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              // Строку, ушедшую в департамент, снимает не форма: там уже могут
              // быть оповещённые управления и выделенные люди.
              disabled={locked}
              title={
                locked
                  ? "Заявка уже ушла в департамент — снять её нельзя"
                  : "Убрать департамент из раскладки"
              }
              aria-label={`Убрать департамент, строка ${index + 1}`}
              onClick={() => {
                setSaved(false);
                setRows((current) => current.filter((r) => r.key !== row.key));
              }}
            >
              <X className="h-4 w-4" />
            </Button>
            <AllocationState event={event} row={storedRow} />
          </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setSaved(false);
            setRows((current) => [
              ...current,
              {
                key: `draft-${current.length}-${Date.now()}`,
                departmentId: "",
                need: remainder > 0 ? String(remainder) : "1",
                departmentName: "",
              },
            ]);
          }}
        >
          <Plus className="mr-1 h-4 w-4" />
          Департамент
        </Button>
        <div className="flex items-center gap-3">
          {saved && !split.isPending && (
            <span className="text-xs text-muted-foreground" role="status">
              Раскладка сохранена
            </span>
          )}
          <Button
            type="button"
            size="sm"
            disabled={split.isPending}
            onClick={() => {
              setSaved(false);
              split.mutate({
                rows: rows.map((row) => ({
                  departmentId: row.departmentId,
                  need: toCount(row.need),
                })),
              });
            }}
          >
            {split.isPending ? "Сохраняю…" : "Сохранить раскладку"}
          </Button>
        </div>
      </div>

      <div className="mt-2 space-y-1">
        <StageError error={split.error} />
        <FieldErrors errors={fieldErrors} />
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<ForceAllocationStatus, string> = {
  DRAFT: "В департамент не отправлено",
  NOTIFIED: "Управления оповещены",
  SUBMITTED: "Список отправлен в штаб",
  ACCEPTED: "Принято штабом",
  RETURNED: "Возвращено департаменту",
};

/**
 * Состояние СОХРАНЁННОЙ заявки: подпись, кнопка оповещения управлений и
 * список тех, кому уже сказали, с моментом.
 *
 * Момент показан у каждого управления, а не один на заявку: повторное
 * оповещение добирает новых, и общее «оповещено такого-то числа» врало бы про
 * тех, кто узнал позже.
 */
function AllocationState({
  event,
  row,
}: {
  event: SecurityEvent;
  row: ForceAllocationRow | undefined;
}) {
  const notify = useNotifyDirectorates(event.id, row?.id ?? "");
  if (row === undefined) {
    return (
      <p className="basis-full text-xs text-muted-foreground">
        Строка не сохранена — оповестить управления можно после сохранения.
      </p>
    );
  }
  return (
    <div className="basis-full" data-slot="allocation-state">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground">
          {STATUS_LABEL[row.status]}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          disabled={notify.isPending}
          onClick={() => notify.mutate({})}
        >
          {notify.isPending
            ? "Оповещаю…"
            : row.directorates.length === 0
              ? "Оповестить управления"
              : "Оповестить ещё раз"}
        </Button>
      </div>
      {row.directorates.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {row.directorates.map((directorate) => (
            <li key={directorate.id}>
              {directorate.name}
              {directorate.notifiedAt !== null && (
                <> · оповещено {formatIsoDateTime(directorate.notifiedAt)}</>
              )}
            </li>
          ))}
        </ul>
      )}
      <StageError error={notify.error} />
    </div>
  );
}

/** Пустое поле — это ноль, а не NaN: сервер сам скажет «не меньше 1». */
function toCount(value: string): number {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Департаменты справочника оргструктуры — только они бывают адресатом.
 *
 * Ключ запроса тот же, что у карточки профиля (`core-divisions`): справочник
 * один, и второй ключ означал бы второй запрос за теми же строками.
 */
function useDepartments() {
  const divisions = useQuery<CoreDivision[]>({
    queryKey: ["core-divisions"],
    queryFn: () => apiClient.getCoreDivisions(),
    staleTime: 10 * 60_000,
  });
  const departments = useMemo(
    () =>
      (divisions.data ?? []).filter(
        (division) => division.type_code === "department"
      ),
    [divisions.data]
  );
  return { departments, isLoading: divisions.isPending };
}
