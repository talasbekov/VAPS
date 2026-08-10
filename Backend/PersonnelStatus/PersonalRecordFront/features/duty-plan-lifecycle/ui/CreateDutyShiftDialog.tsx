"use client";

// Создание дежурства: дата → вид → объект (разрешённый на дату, с причиной
// блокировки) → сектор → пост из действующей версии паспорта → кандидат
// (занятость видна в списке) → примечание. Пересечение — жёсткий отказ;
// нарушение отдыха при SOFT_OVERRIDE — 409 → общий ConflictDialog.
import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConflictDialog } from "@/features/ops-conflict-override";
import { useDutyTypes } from "@/hooks/use-duty-plan";
import {
  useCreateDutyShift,
  useDutyCandidates,
  useDutyPlanObjects,
} from "@/hooks/use-duty-shifts";

export interface CreateDutyShiftDialogProps {
  open: boolean;
  defaultDate: string;
  onClose: () => void;
}

export function CreateDutyShiftDialog({
  open,
  defaultDate,
  onClose,
}: CreateDutyShiftDialogProps) {
  if (!open) return null;
  return <OpenDialog defaultDate={defaultDate} onClose={onClose} />;
}

function OpenDialog({
  defaultDate,
  onClose,
}: {
  defaultDate: string;
  onClose: () => void;
}) {
  const [businessDate, setBusinessDate] = useState(defaultDate);
  const [dutyTypeCode, setDutyTypeCode] = useState("");
  const [objectId, setObjectId] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [postId, setPostId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [note, setNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, unknown> | null>(
    null
  );

  const types = useDutyTypes();
  const objects = useDutyPlanObjects(businessDate);
  const candidates = useDutyCandidates(businessDate);

  const create = useCreateDutyShift({
    onFormError: (details) => setFieldErrors(details),
    onSuccess: () => onClose(),
  });

  const selectedObject = useMemo(
    () => objects.data?.results.find((o) => o.objectId === objectId) ?? null,
    [objects.data, objectId]
  );
  const selectedSector = useMemo(
    () => selectedObject?.sectors.find((s) => s.sectorId === sectorId) ?? null,
    [selectedObject, sectorId]
  );

  function submit(): void {
    setFieldErrors(null);
    create.mutate({
      businessDate,
      dutyTypeCode,
      objectId,
      sectorId,
      postId,
      employeeId,
      note: note.trim() === "" ? null : note.trim(),
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        // пока открыт вложенный ConflictDialog, внешний закрываться не должен:
        // Radix считает взаимодействие с ним «кликом снаружи»
        if (!isOpen && create.conflict === null) onClose();
      }}
    >
      <DialogContent
        className="max-w-lg"
        onInteractOutside={(e) => {
          if (create.conflict !== null) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (create.conflict !== null) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Добавить дежурство</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="space-y-1">
            <Label htmlFor="duty-date">Дата *</Label>
            <Input
              id="duty-date"
              type="date"
              value={businessDate}
              onChange={(e) => {
                setBusinessDate(e.target.value);
                setObjectId("");
                setSectorId("");
                setPostId("");
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="duty-type">Вид дежурства *</Label>
            <select
              id="duty-type"
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={dutyTypeCode}
              onChange={(e) => setDutyTypeCode(e.target.value)}
            >
              <option value="">— выберите вид —</option>
              {(types.data?.results ?? []).map((type) => (
                <option key={type.dutyTypeCode} value={type.dutyTypeCode}>
                  {type.safeLabel} (отдых {Math.round(type.restAfterMinutes / 60)}{" "}
                  ч)
                </option>
              ))}
            </select>
            {types.data && (
              <p className="text-[11px] text-muted-foreground">
                Режим отдыха:{" "}
                {types.data.conflictPolicy.restAfterDutyMode === "HARD_BLOCK"
                  ? "жёсткая блокировка"
                  : "обход с обоснованием"}{" "}
                ({types.data.conflictPolicy.conflictPolicyVersion})
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="duty-object">Объект *</Label>
            <select
              id="duty-object"
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={objectId}
              onChange={(e) => {
                setObjectId(e.target.value);
                setSectorId("");
                setPostId("");
              }}
            >
              <option value="">— выберите объект —</option>
              {(objects.data?.results ?? []).map((object) => (
                <option
                  key={object.objectId}
                  value={object.objectId}
                  disabled={object.blockReason !== null}
                >
                  {object.objectCode} · {object.objectName}
                  {object.blockReason !== null ? ` — ${object.blockReason}` : ""}
                </option>
              ))}
            </select>
          </div>
          {selectedObject !== null && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="duty-sector">Сектор *</Label>
                <select
                  id="duty-sector"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={sectorId}
                  onChange={(e) => {
                    setSectorId(e.target.value);
                    setPostId("");
                  }}
                >
                  <option value="">— сектор —</option>
                  {selectedObject.sectors.map((sector) => (
                    <option key={sector.sectorId} value={sector.sectorId}>
                      {sector.sectorName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="duty-post">Пост *</Label>
                <select
                  id="duty-post"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={postId}
                  onChange={(e) => setPostId(e.target.value)}
                >
                  <option value="">— пост —</option>
                  {(selectedSector?.posts ?? []).map((post) => (
                    <option key={post.postId} value={post.postId}>
                      {post.postName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="duty-employee">Сотрудник *</Label>
            <select
              id="duty-employee"
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">— выберите сотрудника —</option>
              {(candidates.data?.results ?? []).map((candidate) => (
                <option key={candidate.employeeId} value={candidate.employeeId}>
                  {candidate.employeeName} · {candidate.unitName}
                  {candidate.busyOnRequestedDate
                    ? " — занят в этот день"
                    : candidate.nearestDutyDate !== null
                      ? ` — ближайшее дежурство ${candidate.nearestDutyDate}`
                      : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="duty-note">Примечание</Label>
            <Input
              id="duty-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {fieldErrors !== null && Object.keys(fieldErrors).length > 0 && (
            <ul className="list-disc pl-5 text-xs text-destructive" role="alert">
              {Object.entries(fieldErrors).map(([field, value]) => (
                <li key={field}>
                  {field}: {Array.isArray(value) ? String(value[0]) : String(value)}
                </li>
              ))}
            </ul>
          )}
          {create.error !== null && (
            <p className="text-sm text-destructive" role="alert">
              {create.error.message}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            type="button"
            disabled={
              create.isPending ||
              businessDate === "" ||
              dutyTypeCode === "" ||
              objectId === "" ||
              employeeId === ""
            }
            onClick={submit}
          >
            {create.isPending ? "Создание…" : "Создать смену"}
          </Button>
        </DialogFooter>

        {/* нарушение отдыха при SOFT_OVERRIDE: причина уходит повтором с override */}
        <ConflictDialog
          conflict={create.conflict}
          onOverride={(reason) => create.confirmOverride(reason)}
          onCancel={() => create.dismissConflict()}
        />
      </DialogContent>
    </Dialog>
  );
}
