"use client";

// Сотрудник в состав ГВО — из кадрового списка (Plane №951).
//
// Заказчик: «Состав ГВО должен выбираться из списка сотрудников». До этого
// участник группы набирался строкой «Фамилия | позывной | роль» и ни с кем в
// кадрах связан не был: тёзка, опечатка в позывном, смена позывного в кадрах —
// всё это сводка не замечала. Теперь участник — ссылка на кадровую запись;
// фамилию и позывной по ней подставляет сервер при каждой сборке, а роль в
// группе остаётся текстом здесь же.
//
// Подбор — тот же `PersonnelPicker`, что у старшего наряда и расстановки:
// поиск и страницы на сервере, а не снимок кадров целиком на клиенте.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PersonnelPicker } from "@/features/personnel-picker";
import type { PersonnelSummarySnapshot } from "@/entities/security-event";
import type { GvoMember } from "@/entities/gvo-summary";

export function GvoMemberPickerDialog({
  open,
  groupName,
  takenIds,
  onPick,
  onClose,
}: {
  open: boolean;
  groupName: string;
  /** Кто уже в составе (любой группы): второй раз в ГВО не ставят. */
  takenIds: Set<string>;
  onPick: (member: GvoMember) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<PersonnelSummarySnapshot | null>(null);
  const [role, setRole] = useState("");
  useEffect(() => {
    if (open) {
      setPicked(null);
      setRole("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Сотрудник в состав ГВО</DialogTitle>
          <DialogDescription>
            {groupName === "" ? "Группа ГВО" : groupName}. Фамилия и позывной берутся
            из кадровой записи; роль в группе — ниже.
          </DialogDescription>
        </DialogHeader>

        <PersonnelPicker
          value={picked?.id ?? null}
          onPick={() => undefined}
          onPickRow={setPicked}
          disabledIds={takenIds}
          disabledNote="уже в составе"
          resetKey={open}
        />

        <div className="space-y-1">
          <label htmlFor="gvo-member-role" className="text-[11.5px] font-bold text-muted-foreground">
            Роль в группе
          </label>
          <Input
            id="gvo-member-role"
            placeholder="старший ГВО, прикреплённый, водитель…"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            type="button"
            disabled={picked === null}
            onClick={() => {
              if (picked === null) return;
              onPick({
                employeeId: picked.id,
                name: picked.name,
                callsign: picked.callsign ?? "",
                role: role.trim(),
              });
              onClose();
            }}
          >
            Добавить в состав
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
