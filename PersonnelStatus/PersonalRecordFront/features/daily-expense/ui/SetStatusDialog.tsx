"use client";

/**
 * Простановка статуса сотруднику на день расхода (Plane №274, Ш-4).
 *
 * ЗАЧЕМ ЭТОТ ЭКРАН ВООБЩЕ. Заказчик описывает первый шаг суточного расхода
 * так: «начальник управления за день вперёд составляет расход по личному
 * составу своего управления: каждому сотруднику проставляет статус». Ручка
 * для этого была всегда, а ЭКРАНА не было ни одного: доска расхода только
 * ПОКАЗЫВАЛА статусы, а панель сдачи получала `dirtyCount={0}` литералом.
 * Сценарий проверялся вызовами API (заход №243) — руками его пройти было
 * негде.
 *
 * ПОЧЕМУ ЗДЕСЬ, А НЕ РЯДОМ С «НА ДЕЖУРСТВЕ». Заказчик писал «этот статус как
 * статус На дежурстве», и буквальное прочтение ведёт не туда: «На дежурстве»
 * живёт на экране «Статусы сотрудников» и пишет в КАДРОВУЮ модель статусов, а
 * расход считается по модели раздела ОМ. Эти две модели не связаны ничем —
 * ни сигналом, ни синком. Статус, записанный рядом с «На дежурстве», расход
 * не увидел бы, и ответственный по департаменту не увидел бы тоже.
 *
 * УЧАСТИЕ В ОМ — не отдельный статус, а дополнение к нему: несколько
 * мероприятий, у каждого свой вид участия (физнаряд либо группа) и роль
 * внутри группы. Блок появляется только у кодов участия: у отпуска
 * мероприятия ни о чём не говорят.
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Trash2 } from "lucide-react";
import { useParticipationCatalog } from "@/hooks/use-participation-catalog";
import { useSecurityEvents } from "@/hooks/use-security-events";
import { STATUS_LABEL_BY_CODE } from "@/entities/daily-grid";

/** Коды участия в ОМ: только у них показывается выбор мероприятий. */
export const PARTICIPATION_CODES = new Set([
  "EVENT_ASSIGNMENT",
  "EVENT_ASSIGNMENT_GROUP",
]);

interface ParticipationDraft {
  eventId: string;
  kindCode: string;
  roleCode: string;
}

export interface SetStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  employeeName: string;
  businessDate: string;
  /** Отправка на сервер: экран решает, какой ручкой писать. */
  onSubmit: (payload: {
    statusCode: string;
    participations: { event_id: number; kind_code: string; role_code?: string }[];
  }) => Promise<void>;
  isSaving: boolean;
  /** Отказ сервера — показывается ЗДЕСЬ, а не тостом за окном. */
  failure: string | null;
}

export function SetStatusDialog({
  open,
  onOpenChange,
  employeeId,
  employeeName,
  businessDate,
  onSubmit,
  isSaving,
  failure,
}: SetStatusDialogProps) {
  const [statusCode, setStatusCode] = useState("");
  const [rows, setRows] = useState<ParticipationDraft[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const needsParticipation = PARTICIPATION_CODES.has(statusCode);
  const catalog = useParticipationCatalog(open && needsParticipation);
  // Мероприятия нужны ТОЛЬКО когда их выбирают: реестр ОМ закрыт своим правом,
  // и запрашивать его у всех подряд значило бы ловить 403 на каждом открытии.
  const events = useSecurityEvents(
    // Отбор пустой намеренно: человека привлекают и на новое ОМ, и на идущее,
    // и сузить список стадией значило бы спрятать половину мероприятий от
    // того, кто ставит статус.
    { search: "", stage: "ALL", from: "", to: "", owner: "", page: 1, pageSize: 100 },
    { enabled: open && needsParticipation }
  );

  const eventList = events.data?.results ?? [];

  useEffect(() => {
    if (!open) {
      setStatusCode("");
      setRows([]);
      setFormError(null);
    }
  }, [open]);

  // Смена статуса на «не участие» снимает выбранные мероприятия: держать их
  // у отпуска значило бы отправить на сервер заведомо бессмысленное тело.
  useEffect(() => {
    if (!needsParticipation) setRows([]);
  }, [needsParticipation]);

  const statuses = useMemo(
    () => [...STATUS_LABEL_BY_CODE.entries()].map(([code, label]) => ({ code, label })),
    []
  );

  const kindOf = (code: string) =>
    catalog.data?.find((kind) => kind.code === code) ?? null;

  function addRow(): void {
    setRows((current) => [...current, { eventId: "", kindCode: "", roleCode: "" }]);
  }

  function patchRow(index: number, patch: Partial<ParticipationDraft>): void {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  }

  async function save(): Promise<void> {
    if (statusCode === "") {
      setFormError("Выберите статус.");
      return;
    }
    if (needsParticipation && rows.length === 0) {
      // Статус участия без единого мероприятия — «привлечён неизвестно куда»:
      // расход его посчитает, а департамент не увидит, на какое ОМ человек
      // отдан.
      setFormError("Укажите хотя бы одно мероприятие.");
      return;
    }
    for (const [index, row] of rows.entries()) {
      if (row.eventId === "" || row.kindCode === "") {
        setFormError(`Строка ${index + 1}: выберите мероприятие и вид участия.`);
        return;
      }
      const kind = kindOf(row.kindCode);
      if (kind !== null && kind.roles.length > 0 && row.roleCode === "") {
        setFormError(`Строка ${index + 1}: у группы «${kind.label}» выберите роль.`);
        return;
      }
    }
    setFormError(null);
    await onSubmit({
      statusCode,
      participations: rows.map((row) => ({
        event_id: Number(row.eventId),
        kind_code: row.kindCode,
        role_code: row.roleCode === "" ? undefined : row.roleCode,
      })),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>Статус на {businessDate}</DialogTitle>
          <DialogDescription>{employeeName}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="space-y-1">
            <Label htmlFor={`status-${employeeId}`}>Статус</Label>
            <Select value={statusCode} onValueChange={setStatusCode}>
              <SelectTrigger id={`status-${employeeId}`} aria-label="Статус">
                <SelectValue placeholder="Выберите статус" />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((row) => (
                  <SelectItem key={row.code} value={row.code}>
                    {row.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {needsParticipation && (
            <div className="flex flex-col gap-3 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">Мероприятия</h3>
                  <p className="text-xs text-muted-foreground">
                    Человек может быть причастен к нескольким ОМ, и на каждом
                    идти по-своему.
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addRow}>
                  + Мероприятие
                </Button>
              </div>

              {events.isError && (
                <p className="text-sm text-destructive-ink" role="alert">
                  Реестр мероприятий не ответил — выбирать не из чего.
                </p>
              )}

              {rows.map((row, index) => {
                const kind = kindOf(row.kindCode);
                return (
                  <div
                    key={index}
                    /* ЯЧЕЙКИ СЖИМАЕМЫЕ (`min-w-0` у каждой): без этого
                       длинное название ОМ («ОМ-2026-10 · Сценарий 2 — полный
                       прогон») распирает колонку по своему содержимому, строка
                       выходит за 720px окна, и содержимое обрезается С ОБЕИХ
                       СТОРОН — вместе с заголовком и кнопкой «Проставить».
                       Поймано снимком экрана; ассерты «текст на месте» этого
                       не видят. */
                    className="grid min-w-0 gap-2 md:grid-cols-[1fr_1fr_1fr_auto]"
                  >
                    <Select
                      value={row.eventId}
                      onValueChange={(value) => patchRow(index, { eventId: value })}
                    >
                      <SelectTrigger className="w-full min-w-0" aria-label={`Мероприятие ${index + 1}`}>
                        <SelectValue placeholder="Мероприятие" />
                      </SelectTrigger>
                      <SelectContent>
                        {/* ЗАГРУЗКА И ПУСТОТА — РАЗНЫЕ СОСТОЯНИЯ, и молчать
                            нельзя ни в одном: пустой список читается как
                            «мероприятий нет» и тогда, когда запрос ещё идёт.
                            Поймано собственной пробой в полном прогоне —
                            под нагрузкой реестр отвечал не сразу, и окно
                            показывало пустоту как факт. */}
                        {events.isPending && (
                          <div className="px-2 py-1.5 text-sm text-muted-foreground">
                            Загружаем мероприятия…
                          </div>
                        )}
                        {!events.isPending && eventList.length === 0 && (
                          <div className="px-2 py-1.5 text-sm text-muted-foreground">
                            Мероприятий нет — привлекать не на что
                          </div>
                        )}
                        {eventList.map((event) => (
                          <SelectItem key={event.id} value={String(event.id)}>
                            {event.code} · {event.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={row.kindCode}
                      onValueChange={(value) =>
                        // Смена вида СБРАСЫВАЕТ роль: роль принадлежит группе,
                        // и оставленная от прежней группы она была бы отвергнута
                        // сервером — но человек увидел бы отказ вместо подсказки.
                        patchRow(index, { kindCode: value, roleCode: "" })
                      }
                    >
                      <SelectTrigger className="w-full min-w-0" aria-label={`Вид участия ${index + 1}`}>
                        <SelectValue placeholder="Вид участия" />
                      </SelectTrigger>
                      <SelectContent>
                        {(catalog.data ?? []).map((item) => (
                          <SelectItem key={item.code} value={item.code}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {kind !== null && kind.roles.length > 0 ? (
                      <Select
                        value={row.roleCode}
                        onValueChange={(value) => patchRow(index, { roleCode: value })}
                      >
                        <SelectTrigger className="w-full min-w-0" aria-label={`Роль в группе ${index + 1}`}>
                          <SelectValue placeholder="Роль в группе" />
                        </SelectTrigger>
                        <SelectContent>
                          {kind.roles.map((role) => (
                            <SelectItem key={role.code} value={role.code}>
                              {role.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="flex items-center">
                        <Badge variant="outline" className="text-xs font-normal">
                          {kind === null ? "выберите вид" : "ролей внутри нет"}
                        </Badge>
                      </div>
                    )}

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Убрать мероприятие ${index + 1}`}
                      onClick={() =>
                        setRows((current) => current.filter((_, i) => i !== index))
                      }
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {(formError !== null || failure !== null) && (
            <Alert variant="destructive">
              <AlertDescription>{formError ?? failure}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Отмена
          </Button>
          <Button type="button" onClick={() => void save()} disabled={isSaving}>
            {isSaving ? "Сохранение…" : "Проставить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
