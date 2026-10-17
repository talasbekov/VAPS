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
 * расход считается по модели раздела ОМ. Кадровые статусы проецируются
 * в ОМ сервером (personnel_mirror.py). Обратной проекции нет: эта короткая
 * форма изменяет только статус расхода ОМ.
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
import { useOpsStatusTypes } from "@/hooks/use-ops-status-types";
import { formatIsoDateLong } from "@/shared/lib/date";
// Блок мероприятий — ОБЩИЙ с портальным окном статуса (Plane №367): те же
// три списка и те же правила («роль принадлежит своей группе», «у физнаряда
// ролей нет») понадобились там дословно, и вторая копия разошлась бы с этой.
import { EVENT_PARTICIPATION_STATUS_CODES } from "@/entities/daily-grid";

/** Коды участия в ОМ: только у них показывается выбор мероприятий.
 * Список — общий на всю систему, см. `entities/daily-grid`. */
export const PARTICIPATION_CODES = EVENT_PARTICIPATION_STATUS_CODES;

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
  canSubmit?: boolean;
  permissionMessage?: string;
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
  canSubmit = true,
  permissionMessage = "Недостаточно прав для изменения статуса.",
  failure,
}: SetStatusDialogProps) {
  const [selection, setSelection] = useState<{ code: string; label: string } | null>(null);
  const statusCode = selection?.code ?? "";
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSelection(null);
      setFormError(null);
    }
  }, [open]);

  // Каталог статусов — СПРАВОЧНИК СЕРВЕРА, а не список в коде (Plane №342):
  // типы заводит администратор, и константа на клиенте не узнаёт о новом типе
  // никогда. Порядок — тот, в котором отдаёт ручка (сервер сортирует по
  // приоритету): «важность» статуса — свойство справочника, и пересортировка
  // на клиенте была бы вторым мнением о ней.
  const catalogTypes = useOpsStatusTypes(open);
  // «Участие в ОМ» из списка снято (Plane №427, `[СТА-04]`): такой статус
  // ставится только из запроса на сбор сил — чекбоксами на «Статусах
  // сотрудников» — и всегда с мероприятием и датами объекта. Ручной ввод
  // был вторым источником правды о привлечении.
  const statuses = useMemo(
    () =>
      catalogTypes.types
        .filter((type) => !PARTICIPATION_CODES.has(type.code))
        .map((type) => ({ code: type.code, label: type.name })),
    [catalogTypes.types]
  );
  const catalogReady = !catalogTypes.isLoading && !catalogTypes.isFetching && !catalogTypes.isError;
  const selectedType = statuses.find(type => type.code === statusCode);
  const selectionAvailable = selectedType !== undefined;

  async function save(): Promise<void> {
    if (isSaving || !canSubmit) return;
    if (!catalogReady) {
      setFormError("Дождитесь загрузки доступных типов статусов.");
      return;
    }
    if (!selectionAvailable) {
      setFormError("Выберите доступный активный статус.");
      return;
    }
    setFormError(null);
    // Участий окно больше не шлёт (Plane №427): «Участие в ОМ» ставится из
    // запроса на сбор сил, а не отсюда.
    await onSubmit({ statusCode, participations: [] });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>Статус на {businessDate}</DialogTitle>
          <DialogDescription>{employeeName}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">Статус будет действовать один день: {formatIsoDateLong(businessDate)}</p>
          <div className="space-y-1">
            <Label htmlFor={`status-${employeeId}`}>Статус</Label>
            <Select value={statusCode} onValueChange={(value) => {
              const type = statuses.find(item => item.code === value);
              if (type) {
                setSelection(type);
                setFormError(null);
              }
            }} disabled={isSaving || !catalogReady}>
              <SelectTrigger id={`status-${employeeId}`} aria-label="Статус">
                <SelectValue placeholder="Выберите статус">{selectedType?.label ?? selection?.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {/* ЗАГРУЗКА, ПУСТОТА И ОТКАЗ — ТРИ РАЗНЫХ СОСТОЯНИЯ, и
                    молчать нельзя ни в одном: пустой список читается как
                    «статусов нет» и когда запрос ещё идёт, и когда справочник
                    не ответил. Тот же приём, что у списка мероприятий ниже. */}
                {catalogTypes.isLoading && (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    Загружаем справочник статусов…
                  </div>
                )}
                {!catalogTypes.isLoading &&
                  !catalogTypes.isError &&
                  statuses.length === 0 && (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      Нет доступных статусов для ручной простановки
                    </div>
                  )}
                {statuses.map((row) => (
                  <SelectItem key={row.code} value={row.code}>
                    {row.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(catalogTypes.isLoading || catalogTypes.isFetching) && (
              <p role="status" className="text-sm text-muted-foreground">Обновляем справочник статусов…</p>
            )}
            {catalogReady && selection !== null && !selectionAvailable && (
              <p role="alert" className="text-sm text-destructive-ink">Выбранный тип больше недоступен. Выберите другой активный статус.</p>
            )}
            {catalogTypes.isError && (
              <p className="text-sm text-destructive-ink" role="alert">
                Не удалось подтвердить доступные типы статусов.{" "}
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={catalogTypes.refetch}
                  disabled={catalogTypes.isFetching || isSaving}
                >
                  {catalogTypes.isFetching ? "Повторяем…" : "Повторить"}
                </button>
              </p>
            )}
          </div>

          {!canSubmit && <Alert><AlertDescription>{permissionMessage}</AlertDescription></Alert>}
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
          <Button type="button" onClick={() => void save()} disabled={isSaving || !canSubmit || !catalogReady || !selectionAvailable}>
            {isSaving ? "Сохранение…" : "Проставить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
