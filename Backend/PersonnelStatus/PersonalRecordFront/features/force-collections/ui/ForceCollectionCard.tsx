"use client";

/**
 * Карточка сбора — вид ШТАБА (Plane №271, Ш-2; по документации — Plane №944).
 *
 * Три блока спецификации `RAW/README.md`, раздел 7.1:
 *   1. «Потребность» по объектам (`[СБС-11]`);
 *   2. «Разбивка по департаментам» (`[СБС-12]`) — таблица с полем «Запрошено»
 *      В СТРОКЕ, «Отправить запросы», после отправки цифры заперты и меняются
 *      только «Довыделить недобор →»;
 *   3. «Собранные сотрудники → объекты» (`[СБС-13]`) — с первым присланным
 *      списком.
 *
 * 🔴 ЧУЖИХ ЗВЕНЬЕВ НА ЭКРАНЕ ШТАБА БОЛЬШЕ НЕТ (Plane №944). До этого под
 * таблицей стояла форма «Правка раскладки» (`ForcesSplitPanel`) с кнопками
 * «Оповестить управления», «Выделить людей», «Отправить список в штаб»,
 * «Принять в мероприятие» — действия ДЕПАРТАМЕНТА и УПРАВЛЕНИЙ, у штаба
 * выключенные с пояснениями. Заказчик проверил цепочку под своими учётками
 * и вернул её словами «полностью неправильно работает»: экран показывал
 * кнопки не того, кто на нём работает, а шага «Отправить запросы» не было
 * вовсе — черновик уходил департаменту в момент сохранения. Теперь штаб
 * делает ровно три вещи спецификации, а звенья департамента живут в его
 * карточке (`DepartmentRequestCard`).
 *
 * РАСКРЫТИЕ строки — деталь не косметическая: заказчик просит видеть
 * поимённо, кого департамент уже отдал; без этого «5 из 46» остаётся числом,
 * за которым нельзя проверить, тех ли людей прислали.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, ChevronRight, Plus, X } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ForceAllocationRow } from "@/entities/security-event";
import {
  FieldErrors,
  StageError,
} from "@/features/security-event-stages/ui/StageErrors";
import { FORCES_COMMAND, useChainAccess } from "@/features/forces-split/ui/chain-access";
import {
  useAssignRosterObjects,
  useForceCollection,
  useHandOverToPlacement,
  useSplitCollection,
  useTopUpAllocation,
  type ForceCollectionWithObjects,
} from "@/hooks/use-force-collections";
import { useReturnAllocation } from "@/hooks/use-security-event-stages";
import { apiClient, type CoreDivision } from "@/lib/api";
import { formatIsoDate, formatIsoDateTime } from "@/shared/lib/date";


/**
 * Окно, в котором сервер разрешает править раскладку (Plane №928).
 *
 * 🔴 СПИСОК СБОРОВ ШИРЕ ЭТОГО ОКНА, и в этом вся причина проверки. Ручка
 * `forces/collections/` отдаёт ВСЕ незакрытые ОМ с ненулевой потребностью, а
 * `split_force_demand`, оповещение управлений и решения по спискам отбиваются
 * 422 вне `_ALLOCATION_STAGES = ("DEMAND", "FORCES", "PLACEMENT")`
 * (`apps/ops/security_events.py`). Снятая лента входящих спрашивала ровно эти
 * три стадии и об этом писала прямо: «лента не должна показывать мероприятие,
 * действия в котором сервер отобьёт». Перенос без проверки подарил бы кнопку,
 * которая всегда отвечает отказом.
 */
const SPLIT_STAGES = ["DEMAND", "FORCES", "PLACEMENT"];

const ALLOCATION_STATUS: Record<string, string> = {
  // Отправленная строка без ответа департамента — «Запрос отправлен»; сам
  // черновик штаба до отправки строкой этой таблицы не является (см.
  // `DraftRow` ниже).
  DRAFT: "Запрос отправлен",
  NOTIFIED: "Отправлен",
  SUBMITTED: "Список прислан",
  ACCEPTED: "Принят",
  RETURNED: "Возвращён",
  DECLINED: "Отказ",
};

/**
 * Строка департамента `[СБС-12]`: Запрошено · Выделяют · Прислано ·
 * Комментарий · Статус · Ответственный; раскрытие — люди и история строк
 * запроса из таблиц `[МД-06]`; «Довыделить недобор → …» — новая строка
 * запроса тому же департаменту (старая не правится).
 */
function DepartmentRow({
  row,
  eventId,
  canCommand,
}: {
  row: ForceAllocationRow;
  eventId: string;
  canCommand: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [count, setCount] = useState("");
  const topUp = useTopUpAllocation(eventId);
  // Возврат присланного списка с ПРИЧИНОЙ — единственное решение штаба по
  // строке, которое осталось на этом экране: принимать список не надо
  // (присланные люди уже в составе, `[СБС-13]`), а вернуть с замечанием
  // бывает нужно. Спецификация о возврате молчит; действие живое и
  // проверенное, оставлено.
  const [returnOpen, setReturnOpen] = useState(false);
  const [reason, setReason] = useState("");
  const back = useReturnAllocation(eventId, row.id);
  const members = row.members ?? [];
  const need = row.need ?? 0;
  const sent = row.sent ?? members.length;
  const allocating = row.allocating ?? null;
  /**
   * НЕДОБОР, ОПРАВДЫВАЮЩИЙ ДОВЫДЕЛЕНИЕ, — это `need − allocating`, а не
   * `need − sent` (Plane №679).
   *
   * 🔴 `sent` — сколько людей ФИЗИЧЕСКИ попало в список; `allocating` — сколько
   * департамент ПООБЕЩАЛ в ответ на запрос. Пока считалось по `sent`, кнопка
   * «Довыделить недобор» вылезала сразу после отправки запроса — до того, как
   * департамент вообще успел ответить, — с подставленным ПОЛНЫМ `need`.
   * Департамент, ответивший «выделяем 5 из 5», но ещё не сдавший список,
   * всё равно показывал недобор 5, и одно нажатие слало второй запрос ещё на
   * пять, удваивая запрошенное.
   *
   * Департамент ещё не ответил (`allocating === null`) — недобора НЕТ:
   * «сколько не хватит» неизвестно, пока не сказано «сколько дадим».
   * Довыделять нечего, и кнопки нет.
   */
  const shortage = allocating === null ? 0 : Math.max(0, need - allocating);
  // Довыделять можно по ОТПРАВЛЕННОМУ запросу (сервер: `top_up` смотрит
  // `sentAt`, Plane №944); в этой таблице все строки отправлены.
  const canTopUp = canCommand && shortage > 0;
  return (
    <>
      <TableRow data-slot="department-row" data-top-up-of={row.topUpOf ?? ""}>
        <TableCell>
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            className="inline-flex items-center gap-2 text-left font-medium"
          >
            {open ? (
              <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
            )}
            {row.departmentName || `Департамент ${row.departmentId}`}
          </button>
          <p className="text-muted-foreground text-xs">
            {row.topUpOf ? "довыделение · " : ""}
            {row.sentAt ? `отправлен ${formatIsoDateTime(row.sentAt)}` : ""}
            {row.dueAt ? ` · срок ${formatIsoDateTime(row.dueAt)}` : ""}
          </p>
        </TableCell>
        <TableCell className="text-right font-semibold tabular-nums">{need}</TableCell>
        <TableCell className="text-right tabular-nums" data-slot="department-allocating">
          {allocating === null ? <span className="text-muted-foreground">—</span> : allocating}
        </TableCell>
        <TableCell className="tabular-nums" data-slot="department-sent">
          {sent} из {need}
        </TableCell>
        <TableCell className="text-muted-foreground max-w-[220px] truncate text-sm">
          {row.answerComment || row.comment || "—"}
        </TableCell>
        <TableCell className="text-sm" data-slot="department-status">
          {ALLOCATION_STATUS[row.status] ?? row.status}
        </TableCell>
        <TableCell className="text-sm" data-slot="department-responsible">
          {row.responsibleName || <span className="text-muted-foreground">не назначен</span>}
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap items-center gap-1">
            {canTopUp && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setCount(String(shortage));
                  setTopUpOpen(true);
                }}
              >
                Довыделить недобор →
              </Button>
            )}
            {canCommand && row.status === "SUBMITTED" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setReturnOpen(true)}
              >
                Вернуть департаменту
              </Button>
            )}
          </div>
          {row.status === "RETURNED" && row.decisionComment !== "" && (
            <p className="text-destructive-ink mt-1 text-xs">
              Возвращено: {row.decisionComment}
            </p>
          )}
        </TableCell>
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={8} className="bg-muted/40">
            <p className="text-muted-foreground mb-2 text-xs tracking-wide uppercase">
              Выделенные сотрудники
            </p>
            {members.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Департамент ещё никого не выделил
              </p>
            ) : (
              <ul className="space-y-1">
                {members.map((member) => (
                  <li
                    key={member.employeeId}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                  >
                    <span className="font-medium">{member.name}</span>
                    <span className="text-muted-foreground">
                      {member.divisionName || "подразделение не указано"}
                    </span>
                    <Badge variant={member.source === "STATUS" ? "secondary" : "outline"}>
                      {member.source === "STATUS" ? "По статусу" : "Выделен штабом"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            {(row.history ?? []).length > 1 && (
              <div className="mt-3" data-slot="department-history">
                <p className="text-muted-foreground mb-1 text-xs tracking-wide uppercase">
                  История запроса
                </p>
                <ul className="space-y-0.5 text-xs">
                  {(row.history ?? []).map((item) => (
                    <li key={item.sequence} className="tabular-nums">
                      №{item.sequence} · запрошено {item.requested}
                      {item.allocating !== null ? ` · выделяют ${item.allocating}` : ""} ·{" "}
                      {ALLOCATION_STATUS[item.status] ?? item.status} ·{" "}
                      {/* Через общий модуль (Plane №932): инлайн терял
                          защиту от `Invalid Date`, и в строке истории вместо
                          момента вставало бы это слово. */}
                      {formatIsoDateTime(item.recordedAt)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </TableCell>
        </TableRow>
      )}
      <Dialog open={topUpOpen} onOpenChange={setTopUpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Довыделить недобор — {row.departmentName}</DialogTitle>
            <DialogDescription>
              Уйдёт новой строкой запроса: прежние цифры не меняются и не удаляются.
              Недобор сейчас — {shortage}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor={`top-up-${row.id}`}>Сколько человек довыделить</Label>
            <Input
              id={`top-up-${row.id}`}
              type="number"
              min={1}
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </div>
          {topUp.error && (
            <p role="alert" className="text-destructive-ink text-sm">
              {topUp.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTopUpOpen(false)}>
              Отмена
            </Button>
            <Button
              type="button"
              disabled={topUp.isPending || Number(count) < 1}
              onClick={() =>
                topUp.mutate(
                  { allocationId: row.id, count: Number(count) },
                  { onSuccess: () => setTopUpOpen(false) }
                )
              }
            >
              {topUp.isPending ? "Отправка…" : "Отправить запрос"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Вернуть список департаменту — {row.departmentName}</DialogTitle>
            <DialogDescription>
              Люди уйдут из состава мероприятия, департамент соберёт список
              заново. Причина обязательна: без неё возврат читается как
              «сделай то же самое ещё раз».
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor={`return-${row.id}`}>Причина возврата</Label>
            <Input
              id={`return-${row.id}`}
              value={reason}
              placeholder="Например: нужны люди с допуском"
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <StageError error={back.error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReturnOpen(false)}>
              Отмена
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={back.isPending || reason.trim() === ""}
              onClick={() => {
                void back
                  .mutateAsync({ reason })
                  .then(() => setReturnOpen(false))
                  .catch(() => undefined);
              }}
            >
              {back.isPending ? "Возвращаю…" : "Вернуть"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Строка ЧЕРНОВИКА штаба — ещё не отправлена департаменту (`[СБС-12]`).
 *  `key` своя: департамент у новой строки ещё не выбран. Срок — в виде
 *  `datetime-local` («ГГГГ-ММ-ДДTЧЧ:ММ», без зоны), как его вводит человек. */
interface DraftRow {
  key: string;
  departmentId: string;
  need: string;
  dueAt: string;
}

/** ISO-момент сервера → значение для `datetime-local`: секунды и зона
 *  отбрасываются намеренно (поле их не принимает), время — местное того, кто
 *  смотрит; обратно уходит момент со смещением (`toISOString`). */
function toLocalInput(value: string | null | undefined): string {
  if (!value) return "";
  const moment = new Date(value);
  if (Number.isNaN(moment.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return (
    `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}` +
    `T${pad(moment.getHours())}:${pad(moment.getMinutes())}`
  );
}

/** Пустое поле — ноль, а не NaN: сервер сам скажет «не меньше 1». */
function toCount(value: string): number {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Департаменты справочника — только они бывают адресатом. Ключ запроса тот
 *  же, что у карточки профиля (`core-divisions`): справочник один. */
function useDepartments() {
  const divisions = useQuery<CoreDivision[]>({
    queryKey: ["core-divisions"],
    queryFn: () => apiClient.getCoreDivisions(),
    staleTime: 10 * 60_000,
  });
  const departments = useMemo(
    () => (divisions.data ?? []).filter((division) => division.type_code === "department"),
    [divisions.data]
  );
  return { departments, isLoading: divisions.isPending };
}

const isSent = (row: ForceAllocationRow) => Boolean(row.sentAt);

/**
 * Редактируемая часть таблицы `[СБС-12]`: черновые строки штаба с полем
 * «Запрошено», «+ Департамент», «Сохранить черновик» и «Отправить запросы».
 *
 * ОТПРАВКА — С ПОДТВЕРЖДЕНИЕМ: после неё цифры заперты навсегда (только
 * довыделение), и один случайный щелчок отбирал бы у штаба право поправить
 * число. Черновик сохраняется без вопросов — он обратим.
 */
function SplitEditor({
  data,
  sentRows,
}: {
  data: ForceCollectionWithObjects;
  sentRows: ForceAllocationRow[];
}) {
  const unsent = useMemo(
    () => data.allocations.filter((row) => !isSent(row) && !row.topUpOf),
    [data.allocations]
  );
  const seed = (): DraftRow[] =>
    unsent.map((row) => ({
      key: row.id,
      departmentId: row.departmentId,
      need: String(row.need),
      dueAt: toLocalInput(row.dueAt),
    }));
  const [rows, setRows] = useState<DraftRow[]>(seed);
  // Черновик перечитывается ИЗ ОТВЕТА, когда сервер прислал другие строки, а
  // не при каждом рефетче: подпись собрана по значениям (тот же приём, что у
  // карточки департамента, №555) — иначе набранное исчезало бы молча.
  const signature = unsent
    .map((row) => `${row.id}:${row.departmentId}:${row.need}:${row.dueAt ?? ""}`)
    .join("|");
  useEffect(() => {
    setRows(seed());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, unknown> | null>(null);
  const [notice, setNotice] = useState<string>("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { departments, isLoading } = useDepartments();
  const split = useSplitCollection(data.eventId);

  const taken = new Set([
    ...sentRows.map((row) => row.departmentId),
    ...rows.map((row) => row.departmentId).filter(Boolean),
  ]);
  const departmentName = (id: string) =>
    departments.find((d) => String(d.id) === id)?.name ?? `Департамент ${id}`;
  const drafted = rows.reduce((sum, row) => sum + toCount(row.need), 0);
  const sentTotal = sentRows.reduce((sum, row) => sum + (row.need ?? 0), 0);
  const requestedTotal = drafted + sentTotal;
  const patch = (key: string, next: Partial<DraftRow>) => {
    setNotice("");
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...next } : row)));
  };

  // Тело запроса: отправленные строки — КАК ЕСТЬ (сервер сверяет, что их
  // цифры не тронуты), черновые — из формы. Пустой срок не отправляется:
  // сервер сохранит прежний либо поставит «за сутки до ОМ».
  const body = (draft: boolean) => ({
    draft,
    rows: [
      ...sentRows
        .filter((row) => !row.topUpOf)
        .map((row) => ({ departmentId: row.departmentId, need: row.need })),
      ...rows.map((row) => ({
        departmentId: row.departmentId,
        need: toCount(row.need),
        ...(row.dueAt === "" ? {} : { dueAt: new Date(row.dueAt).toISOString() }),
      })),
    ],
  });
  const save = (draft: boolean) => {
    setFieldErrors(null);
    setNotice("");
    split.mutate(body(draft), {
      onSuccess: () => {
        setConfirmOpen(false);
        setNotice(draft ? "Черновик сохранён" : "Запросы отправлены департаментам");
      },
      onError: (error) => {
        if (error.kind === "validation") setFieldErrors(error.details);
        // Ошибка формы рисуется ПОД таблицей, а диалог её закрывал собой:
        // человек видел диалог без реакции (ревью №825 по №944). Диалог
        // закрывается, ошибка — на виду.
        setConfirmOpen(false);
      },
    });
  };
  // Неполная строка (департамент не выбран, число меньше единицы) отбивается
  // сервером по позиции — не давать открыть диалог с «— департамент не
  // выбран —» и активной «Отправить» (ревью №825 по №944).
  const incompleteRow = rows.some((row) => row.departmentId === "" || toCount(row.need) < 1);
  // Индекс строки в ТЕЛЕ запроса (после отправленных) — для ошибок формы
  // `rows.<i>.need`, которые сервер адресует по позиции.
  const offset = sentRows.filter((row) => !row.topUpOf).length;

  return (
    <>
      {rows.map((row, index) => (
        <TableRow key={row.key} data-slot="draft-row">
          <TableCell>
            <Label className="sr-only" htmlFor={`draft-department-${row.key}`}>
              Департамент, строка {index + 1}
            </Label>
            <select
              id={`draft-department-${row.key}`}
              aria-label={`Департамент, строка ${index + 1}`}
              className="border-input bg-background h-9 w-full min-w-[12rem] rounded-md border px-2 text-sm"
              value={row.departmentId}
              onChange={(e) => patch(row.key, { departmentId: e.target.value })}
            >
              <option value="">
                {isLoading ? "Загрузка справочника…" : "Выберите департамент"}
              </option>
              {departments
                .filter(
                  (department) =>
                    !taken.has(String(department.id)) || String(department.id) === row.departmentId
                )
                .map((department) => (
                  <option key={department.id} value={String(department.id)}>
                    {department.name}
                  </option>
                ))}
            </select>
            <div className="mt-1 flex items-center gap-1">
              <Label htmlFor={`draft-due-${row.key}`} className="text-muted-foreground text-xs">
                срок
              </Label>
              <Input
                id={`draft-due-${row.key}`}
                type="datetime-local"
                aria-label={`Срок сдачи списка, строка ${index + 1}`}
                title="Срок сдачи списка. Пусто — за сутки до начала мероприятия"
                className="h-8 w-48 text-xs"
                value={row.dueAt}
                onChange={(e) => patch(row.key, { dueAt: e.target.value })}
              />
            </div>
          </TableCell>
          <TableCell className="text-right">
            <Label className="sr-only" htmlFor={`draft-need-${row.key}`}>
              Сколько человек, строка {index + 1}
            </Label>
            <Input
              id={`draft-need-${row.key}`}
              aria-label={`Сколько человек, строка ${index + 1}`}
              className="ml-auto h-9 w-24 text-right tabular-nums"
              inputMode="numeric"
              value={row.need}
              onChange={(e) => patch(row.key, { need: e.target.value })}
            />
          </TableCell>
          <TableCell className="text-muted-foreground text-right">—</TableCell>
          <TableCell className="text-muted-foreground">—</TableCell>
          <TableCell className="text-muted-foreground">—</TableCell>
          <TableCell className="text-sm" data-slot="department-status">
            Черновик
          </TableCell>
          <TableCell className="text-muted-foreground text-sm">—</TableCell>
          <TableCell>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              aria-label={`Убрать департамент, строка ${index + 1}`}
              title="Убрать департамент из черновика"
              onClick={() => {
                setNotice("");
                setRows((current) => current.filter((r) => r.key !== row.key));
              }}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </TableCell>
        </TableRow>
      ))}
      <TableRow data-slot="split-editor">
        <TableCell colSpan={8} className="whitespace-normal">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setNotice("");
                const remainder = data.need - requestedTotal;
                setRows((current) => [
                  ...current,
                  {
                    key: `draft-${current.length}-${Date.now()}`,
                    departmentId: "",
                    need: remainder > 0 ? String(remainder) : "1",
                    dueAt: "",
                  },
                ]);
              }}
            >
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              Департамент
            </Button>
            <div className="flex flex-wrap items-center gap-3">
              {notice !== "" && !split.isPending && (
                <span className="text-muted-foreground text-xs" role="status">
                  {notice}
                </span>
              )}
              <span className="text-muted-foreground text-xs tabular-nums" data-slot="forces-split-total">
                запрошено <b className="text-foreground">{requestedTotal}</b> из {data.need}
                {requestedTotal < data.need && <> · не разложено {data.need - requestedTotal}</>}
                {requestedTotal > data.need && (
                  /* Сверх потребности — НЕ ошибка (`[СБС-12]`: «Блокировки на
                     сумму нет»), но факт, который штаб должен видеть. */
                  <span className="text-amber-800"> · сверх потребности {requestedTotal - data.need}</span>
                )}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={split.isPending || rows.length === 0}
                onClick={() => save(true)}
              >
                Сохранить черновик
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={split.isPending || rows.length === 0 || incompleteRow}
                title={incompleteRow ? "У каждой строки нужен департамент и число не меньше единицы" : undefined}
                onClick={() => setConfirmOpen(true)}
              >
                Отправить запросы
              </Button>
            </div>
          </div>
          <div className="mt-2 space-y-1">
            <StageError error={split.error?.kind === "validation" ? null : split.error ?? null} />
            <FieldErrors
              errors={
                fieldErrors === null
                  ? null
                  : Object.fromEntries(
                      Object.entries(fieldErrors).map(([path, value]) => {
                        // Позиция в теле → номер черновой строки на экране.
                        const match = /^rows\.(\d+)\.(.+)$/.exec(path);
                        if (match === null) return [path, value];
                        const local = Number(match[1]) - offset + 1;
                        return [`строка ${local > 0 ? local : Number(match[1]) + 1}: ${match[2]}`, value];
                      })
                    )
              }
            />
          </div>
        </TableCell>
      </TableRow>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отправить запросы департаментам?</DialogTitle>
            <DialogDescription>
              Ответственные за сбор сил получат уведомление и ответят «Выделяем».
              После отправки цифры заперты: изменить их можно только
              довыделением недобора — новой строкой запроса.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 text-sm">
            {rows.map((row) => (
              <li key={row.key} className="flex justify-between gap-3">
                <span>{row.departmentId === "" ? "— департамент не выбран —" : departmentName(row.departmentId)}</span>
                <b className="tabular-nums">{toCount(row.need)}</b>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-sm">
            Запрошено {requestedTotal} при потребности {data.need}
          </p>
          <StageError error={split.error?.kind === "validation" ? null : split.error ?? null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              Отмена
            </Button>
            <Button type="button" disabled={split.isPending} onClick={() => save(false)}>
              {split.isPending ? "Отправляю…" : "Отправить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ForceCollectionCard({
  eventId,
  onBack,
  enabled = true,
}: {
  eventId: string;
  onBack: () => void;
  /** Гард экрана. До №779 карточка открывалась только нажатием по строке
   *  загруженного списка, и выключенный список молчал за обоих; с переездом
   *  открытого сбора в адрес (`?collection=`) карточка стала достижима прямой
   *  ссылкой — и уходила на сервер мимо гарда (найдено ревью №825). */
  enabled?: boolean;
}) {
  const collection = useForceCollection(eventId, { enabled });
  const data = collection.data;
  const access = useChainAccess();

  if (collection.isPending) {
    return (
      <div className="space-y-3" aria-busy>
        <div className="bg-muted h-8 w-64 animate-pulse rounded" aria-hidden />
        <div className="bg-muted h-40 w-full animate-pulse rounded" aria-hidden />
      </div>
    );
  }

  if (collection.isError || data === undefined) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 size-4" aria-hidden="true" />
          Назад к списку сборов
        </Button>
        <p role="alert" className="text-destructive-ink text-sm">
          {collection.error?.message ?? "Сбор не открылся"}
        </p>
      </div>
    );
  }

  // Сумма СТРОК, напечатанных рядом (Plane №678) — она и есть «Итого» блока
  // «Потребность». `data.need` рядом с ними — другой факт: число, которое штаб
  // получил на завершении рекогносцировки и раскладывает; оно заморожено и
  // после правки расчёта расходится с живой суммой.
  const shownNeed = data.needByObject.reduce((sum, item) => sum + item.need, 0);
  const needDiffers = data.needByObject.length > 0 && shownNeed !== data.need;
  // Таблица `[СБС-12]` показывает ОТПРАВЛЕННЫЕ запросы; черновик штаба живёт
  // строками редактора ниже, и департаменту его не видно (Plane №944).
  const sentRows = data.allocations.filter(isSent);
  const editable = SPLIT_STAGES.includes(data.stage) && access.can(FORCES_COMMAND);

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 size-4" aria-hidden="true" />
          Назад к списку сборов
        </Button>
      </div>

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="font-mono text-[11px]">
            {data.code}
          </Badge>
          <Badge variant="outline" data-slot="collection-status">{data.boardStatus.label}</Badge>
          {data.urgent && (
            <Badge variant="destructive" data-slot="collection-urgent">
              Срочно
            </Badge>
          )}
        </div>
        <h2 className="text-xl font-semibold">{data.title}</h2>
        <p className="text-muted-foreground text-sm">
          {[formatIsoDate(data.businessDate), data.location, data.eventTime]
            .filter((part) => part !== null && part !== "")
            .join(" · ")}
        </p>
      </div>

      {/* Блок 1 «Потребность» (`[СБС-11]`, Plane №426): по объектам посещения
          «„Мейрам“ — 8 (рекогносцировка завершена, Тлесов)» → Итого N.

          🔴 «ИТОГО» СЧИТАЕТСЯ ИЗ СТРОК, КОТОРЫЕ НАПЕЧАТАНЫ РЯДОМ (Plane №678).
          Здесь стояло `data.need` — число, замороженное на завершении
          рекогносцировки и с тех пор не пересчитываемое, тогда как строки
          объектов считаются живьём. Поправили `need` поста после
          рекогносцировки — строки изменились, «Итого» нет; оставили пост без
          объекта на ОМ с двумя объектами — он выпадал из строк, но сидел в
          «Итого». Человек читал «„Мейрам“ — 8 · „Рахат“ — 3 · Итого 12» и не
          мог свести. Теперь сумма верна по построению, а расхождение с тем,
          что получил штаб, названо отдельной строкой — это РАЗНЫЕ факты, и
          прятать второй ради первого нельзя. */}
      <section aria-labelledby="collection-need-heading" className="space-y-2" data-slot="collection-need">
        <h3 id="collection-need-heading" className="font-semibold">
          Потребность
        </h3>
        {data.needByObject.length === 0 ? (
          <p className="text-muted-foreground text-sm">Объектов посещения у мероприятия нет.</p>
        ) : (
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {data.needByObject.map((item) => (
              <li key={item.visitObjectId || "unassigned"} data-slot="need-by-object">
                {/* Строка «без объекта посещения» — не объект, и кавычек ей не
                    полагается: она про посты, которые объекту не отнесены. */}
                {item.visitObjectId === "" ? (
                  <span>{item.objectName} — </span>
                ) : (
                  <span>«{item.objectName}» — </span>
                )}
                <b className="tabular-nums">{item.need}</b>
                <span className="text-muted-foreground">
                  {" "}
                  ({[item.statusLabel.toLowerCase(), item.chiefName].filter((p) => p !== "").join(", ")})
                </span>
              </li>
            ))}
            <li className="font-semibold" data-slot="need-total">
              Итого {shownNeed}
            </li>
          </ul>
        )}
        {/* Расхождение НАЗЫВАЕТСЯ, а не сглаживается (Plane №678). Штаб делит
            число, полученное на завершении рекогносцировки; расчёт постов
            после этого могли поправить. Оба числа — факты, и молчаливое
            выравнивание одного по другому спрятало бы то, что расчёт
            изменился уже после запроса. */}
        {needDiffers && (
          <p className="text-xs text-amber-800" data-slot="need-mismatch">
            Штабу передано {data.need} — расчёт постов изменился после запроса.
          </p>
        )}
      </section>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Требуется по рекогносцировке"
          value={data.need}
          caption="Число, которое делит штаб"
        />
        <StatCard
          label="Распределено квотами"
          value={data.allocated}
          tone={data.allocated > data.need ? "danger" : "neutral"}
          caption={
            data.allocated > data.need
              ? `Больше потребности на ${data.allocated - data.need}`
              : `Ещё не разложено ${data.need - data.allocated}`
          }
        />
        <StatCard
          label="Собрано"
          value={data.gathered}
          tone="success"
          caption="Люди со статусом участия"
        />
        <StatCard
          label="Осталось собрать"
          value={data.remaining}
          tone={data.remaining > 0 ? "info" : "success"}
          caption={data.remaining > 0 ? "До закрытия потребности" : "Потребность закрыта"}
        />
      </div>

      <section aria-labelledby="collection-split-heading" className="space-y-3">
        <div>
          <h3 id="collection-split-heading" className="font-semibold">
            Распределение по департаментам
          </h3>
          <p className="text-muted-foreground text-sm">
            Запрошено [ввод] у черновых строк; после «Отправить запросы» цифры
            заперты, недобор довыделяется новой строкой. Строка раскрывается —
            видно поимённо, кого департамент уже отдал.
          </p>
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {/* Колонки `[СБС-12]` (Plane №426). */}
                <TableHead>Департамент</TableHead>
                <TableHead className="text-right">Запрошено</TableHead>
                <TableHead className="text-right">Выделяют</TableHead>
                <TableHead>Прислано</TableHead>
                <TableHead>Комментарий</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Ответственный</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sentRows.length === 0 && !editable && (
                <TableRow>
                  <TableCell colSpan={8} className="whitespace-normal">
                    <p className="text-muted-foreground text-sm">
                      Запросы департаментам ещё не отправлены.
                    </p>
                  </TableCell>
                </TableRow>
              )}
              {sentRows.map((row) => (
                <DepartmentRow key={row.id} row={row} eventId={data.eventId} canCommand={access.can(FORCES_COMMAND)} />
              ))}
              {/* Черновые строки и кнопки — В ТОЙ ЖЕ ТАБЛИЦЕ (`[СБС-12]`:
                  «Запрошено [ввод]»): раскладка — продолжение той строки, в
                  которой показана. Редактор монтируется по ключу сбора, чтобы
                  черновик одного ОМ не пережил переход к другому. */}
              {editable && <SplitEditor key={data.eventId} data={data} sentRows={sentRows} />}
            </TableBody>
          </Table>
        </div>
        <p className="text-sm" data-slot="collection-totals">
          Итог: потребность <b className="tabular-nums">{data.totals.need}</b> · выделяют{" "}
          <b className="tabular-nums">{data.totals.allocating}</b> · прислано{" "}
          <b className="tabular-nums">{data.totals.sent}</b> · недобор{" "}
          <b className={`tabular-nums ${data.totals.shortage > 0 ? "text-destructive-ink" : ""}`}>
            {data.totals.shortage}
          </b>
        </p>
        {!SPLIT_STAGES.includes(data.stage) && (
          <p className="text-muted-foreground border-t pt-3 text-xs" data-slot="split-closed">
            Раскладку правят после рекогносцировки и до согласования
            расстановки — на этой стадии мероприятия сервер правку уже не
            принимает.
          </p>
        )}
      </section>

      <RosterToObjects data={data} />
    </div>
  );
}

/**
 * Блок 3 «Собранные сотрудники → объекты» (`[СБС-13]`, Plane №390).
 *
 * Появляется с первым принятым списком (состав непуст). Слева — люди состава
 * по департаментам с чекбоксами, справа — объекты посещения с ёмкостью
 * «потребность N / назначено M». Отметил → «На объект…» — люди отданы
 * объекту; «Передать на расстановку» — при недоборе диалог с обязательным
 * комментарием. Перетаскивания нет намеренно: чекбоксы + список делают то же
 * с клавиатуры и на планшете, а drag-and-drop без второго пути был бы
 * недоступен половине пользователей.
 *
 * После передачи блок читается, но не правится: распределение — решение
 * штаба, и менять его после того, как старшие объектов начали расставлять,
 * значило бы менять условия задним числом.
 */
function RosterToObjects({ data }: { data: ForceCollectionWithObjects }) {
  const assign = useAssignRosterObjects(data.eventId);
  const handOver = useHandOverToPlacement(data.eventId);
  const [picked, setPicked] = useState<string[]>([]);
  const [target, setTarget] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [comment, setComment] = useState("");
  const roster = data.roster ?? [];
  const objects = data.objects ?? [];
  const handedOver = Object.keys(data.handover ?? {}).length > 0;
  if (roster.length === 0) return null;

  const objectName = (id: string | null | undefined) =>
    objects.find((o) => o.visitObjectId === id)?.objectName ?? null;
  const unassigned = roster.filter((m) => !m.visitObjectId).length;
  const shortfall = objects.filter(
    (o) => o.need !== null && o.assigned < o.need
  );
  const byDepartment = new Map<string, typeof roster>();
  for (const member of roster) {
    const key = member.departmentName || "Без департамента";
    byDepartment.set(key, [...(byDepartment.get(key) ?? []), member]);
  }
  const togglePicked = (employeeId: string, on: boolean) =>
    setPicked((prev) => (on ? [...prev, employeeId] : prev.filter((id) => id !== employeeId)));

  return (
    <section aria-labelledby="roster-objects-heading" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="roster-objects-heading" className="font-semibold">
            Собранные сотрудники → объекты
          </h3>
          <p className="text-muted-foreground text-sm">
            {handedOver
              ? // 🔴 МОМЕНТ, А НЕ СРЕЗ UTC-МЕТКИ (Plane №581). `handover.at` —
                // метка времени сервера в UTC (`force_collection._now_iso()`),
                // и `.slice(0, 10)` брал из неё календарный день ПО ГРИНВИЧУ.
                // Передача после 19:00 по местному (+05) лежит в базе
                // вчерашним днём, и карточка печатала «Передано на расстановку
                // <вчера>» о том, что сделали вечером. Ровно тот же дефект и
                // та же правка, что в №560 у даты рассылки запроса.
                `Передано на расстановку ${formatIsoDateTime(data.handover.at ?? "")}${
                  data.handover.comment ? ` · ${data.handover.comment}` : ""
                }`
              : `Прислано ${data.gathered} из ${data.need}${
                  unassigned > 0 ? ` · не распределены: ${unassigned}` : ""
                }`}
          </p>
        </div>
        {!handedOver && (
          <Button
            type="button"
            size="sm"
            disabled={handOver.isPending || unassigned > 0}
            title={unassigned > 0 ? "Сначала отдайте объектам всех собранных" : undefined}
            onClick={() => (shortfall.length > 0 ? setDialogOpen(true) : handOver.mutate({ comment: "" }))}
          >
            {handOver.isPending ? "Передаю…" : "Передать на расстановку"}
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Сотрудник</TableHead>
                <TableHead>Управление</TableHead>
                <TableHead>Объект</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...byDepartment.entries()].map(([department, members]) => (
                /* 🔴 `Fragment` С КЛЮЧОМ, А НЕ СОКРАЩЁННЫЙ `<>` (Plane №485).
                   Ключ нужен САМОМУ элементу списка; ключи на внутренних
                   строках его не заменяют — сокращённая запись фрагмента
                   атрибутов не принимает вовсе. React ругался «Each child in
                   a list should have a unique key», а при смене состава
                   департаментов группы перерисовывались лишний раз.

                   Предупреждение в консоли здесь дороже, чем кажется: полный
                   прогон требует смотреть на консоль браузера, и постоянное
                   жёлтое обесценивает эту проверку — туда перестают
                   смотреть. */
                <Fragment key={`dep-${department}`}>
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground bg-muted/30 text-xs font-semibold uppercase tracking-wide">
                      {department}
                    </TableCell>
                  </TableRow>
                  {members.map((member) => (
                    <TableRow key={member.employeeId} data-testid={`roster-${member.employeeId}`}>
                      <TableCell>
                        <Checkbox
                          aria-label={`Отметить ${member.name}`}
                          disabled={handedOver}
                          checked={picked.includes(member.employeeId)}
                          onCheckedChange={(on) => togglePicked(member.employeeId, on === true)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{member.name}</TableCell>
                      <TableCell className="text-muted-foreground">{member.divisionName || "—"}</TableCell>
                      <TableCell>
                        {objectName(member.visitObjectId) ?? (
                          <span className="text-muted-foreground">не распределён</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="space-y-3">
          <ul className="space-y-2">
            {objects.map((object) => {
              const full = object.need !== null && object.assigned >= object.need;
              return (
                <li
                  key={object.visitObjectId}
                  className="rounded-lg border px-3 py-2 text-sm"
                  data-testid={`object-capacity-${object.visitObjectId}`}
                >
                  <div className="font-medium">{object.objectName}</div>
                  <div className={`tabular-nums ${full ? "text-green-700" : "text-muted-foreground"}`}>
                    {object.need === null
                      ? `назначено ${object.assigned} · потребность не размечена`
                      : `потребность ${object.need} / назначено ${object.assigned}`}
                  </div>
                </li>
              );
            })}
          </ul>
          {!handedOver && (
            <div className="space-y-2">
              <label className="text-xs font-semibold" htmlFor="roster-target">
                На объект…
              </label>
              <select
                id="roster-target"
                className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">— выберите объект —</option>
                {objects.map((o) => (
                  <option key={o.visitObjectId} value={o.visitObjectId}>
                    {o.objectName}
                  </option>
                ))}
                <option value="__none__">снять с объекта</option>
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={picked.length === 0 || target === "" || assign.isPending}
                onClick={() =>
                  assign.mutate(
                    {
                      rows: picked.map((employeeId) => ({
                        employeeId,
                        visitObjectId: target === "__none__" ? null : target,
                      })),
                    },
                    { onSuccess: () => setPicked([]) }
                  )
                }
              >
                {assign.isPending
                  ? "Отдаю…"
                  : picked.length === 0
                    ? "Отметьте людей слева"
                    : `Отдать объекту: ${picked.length}`}
              </Button>
              {assign.isError && (
                <p role="alert" className="text-destructive-ink text-xs">
                  {assign.error?.message ?? "Не удалось отдать объекту"}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      {handOver.isError && (
        <p role="alert" className="text-destructive-ink text-sm">
          {handOver.error?.message ?? "Передать не удалось"}
        </p>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Передать на расстановку с недобором?</DialogTitle>
            <DialogDescription>
              {shortfall
                .map((o) => `«${o.objectName}»: ${o.assigned} из ${o.need}`)
                .join(" · ")}
              . Старшие объектов получат состав меньше потребности — укажите,
              почему; комментарий увидят они и штаб.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Комментарий к передаче с недобором"
            placeholder="Например: остальных доберём к среде"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          {handOver.isError && (
            <p role="alert" className="text-destructive-ink text-sm">
              {handOver.error?.message ?? "Передать не удалось"}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={comment.trim() === "" || handOver.isPending}
              onClick={() =>
                handOver.mutate({ comment }, { onSuccess: () => setDialogOpen(false) })
              }
            >
              {handOver.isPending ? "Передаю…" : "Передать с недобором"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
