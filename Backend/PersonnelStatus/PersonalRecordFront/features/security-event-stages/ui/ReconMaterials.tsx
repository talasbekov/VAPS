"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ReconChecklistItem } from "@/entities/security-event";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import {
  type ReconMaterial,
  useDownloadReconMaterial,
  useReconMaterials,
  useRemoveReconMaterial,
  useUploadReconMaterial,
} from "@/hooks/use-recon-materials";
import { StageError } from "./StageErrors";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_MATERIALS = 30;

export function ReconMaterials({
  eventId,
  visitObjectId,
  checklist,
  canManage,
}: {
  eventId: string;
  visitObjectId: string | null;
  checklist: ReconChecklistItem[];
  canManage: boolean;
}) {
  const { hasPermission } = useOpsPermissions();
  const canRead = hasPermission("event.view");
  const query = useReconMaterials(eventId, visitObjectId, canRead);
  const selected = { eventId, visitObjectId };
  const upload = useUploadReconMaterial(selected);
  const remove = useRemoveReconMaterial(selected);
  const download = useDownloadReconMaterial(selected);
  const targetStamp = JSON.stringify(query.readKey);
  const [localTarget, setLocalTarget] = useState(targetStamp);
  const [checklistItemId, setChecklistItemId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const activeTarget = useRef("");
  const mounted = useRef(false);
  activeTarget.current = targetStamp;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    setLocalTarget(targetStamp);
    setChecklistItemId("");
    setFile(null);
    setLocalError(null);
    if (fileInput.current !== null) fileInput.current.value = "";
    upload.reset();
    remove.reset();
    download.reset();
  }, [targetStamp, upload.reset, remove.reset, download.reset]);

  const localCurrent = localTarget === targetStamp;
  const currentFile = localCurrent ? file : null;
  const known = query.data !== undefined && !query.isError && !query.readAccessBlocked;
  const sourceForbidden = query.error !== null && "status" in query.error && query.error.status === 403;
  const downloadForbidden = download.error !== null && "status" in download.error && download.error.status === 403;
  const forbidden = sourceForbidden || (query.readAccessBlocked && (query.error === null || downloadForbidden));
  const materials = known ? query.data!.results : [];
  const canEdit = canManage && canRead && visitObjectId !== null && query.canAct;
  const limitReached = materials.length >= MAX_MATERIALS;
  const busy = upload.isPending || remove.isPending;
  const labels = new Map(checklist.map((item) => [item.id, item.label]));
  const groups = new Map<string, ReconMaterial[]>();
  for (const row of materials) {
    const key = row.checklistItemId ?? "";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  async function submitUpload() {
    if (currentFile === null || visitObjectId === null || !canEdit || busy) return;
    if (currentFile.size > MAX_BYTES) {
      setLocalError("Файл больше 10 МБ.");
      return;
    }
    const submittedTarget = activeTarget.current;
    setLocalError(null);
    try {
      await upload.mutateAsync({ eventId, visitObjectId, file: currentFile, checklistItemId: checklistItemId || null });
      if (mounted.current && activeTarget.current === submittedTarget) {
        setFile(null);
        if (fileInput.current !== null) fileInput.current.value = "";
      }
    } catch {
      // The typed server error is shown below; retain the selected file.
    }
  }

  async function saveDownload(row: ReconMaterial) {
    if (visitObjectId === null || !query.canAct) return;
    const submittedTarget = activeTarget.current;
    try {
      const result = await download.mutateAsync({ eventId, visitObjectId, materialId: row.id });
      if (!mounted.current || activeTarget.current !== submittedTarget) return;
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename ?? row.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // Preserve the list and show the download error below it.
    }
  }

  return (
    <section aria-label="Материалы рекогносцировки" data-slot="recon-materials" className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Материалы рекогносцировки</h3>
        <span className="text-xs text-muted-foreground">{known ? `${materials.length} из ${MAX_MATERIALS}` : "Число файлов неизвестно"}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Фото к пунктам чек-листа: JPEG, PNG или WebP. Материалы объекта: изображения или PDF.
        До 10 МБ на файл и 30 файлов на объект. Файлы сохраняются сразу после загрузки.
      </p>
      {visitObjectId === null ? (
        <p className="text-sm text-muted-foreground">Выберите объект посещения, чтобы открыть его материалы.</p>
      ) : !canRead ? (
        <p className="text-sm text-muted-foreground">Для просмотра материалов требуется право просмотра мероприятия.</p>
      ) : forbidden ? (
        <div role="status" className="text-sm">
          <p className="font-medium">Нет доступа к материалам выбранного объекта</p>
          <p className="mt-1 text-xs text-muted-foreground">Доступ к мероприятию не всегда открывает его файлы. Материалы доступны уполномоченным участникам этого объекта.</p>
        </div>
      ) : (
        <>
          {canManage && <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-52 flex-1 space-y-1 text-xs">
              <span>К чему прикрепить материал</span>
              <select
                aria-label="К чему прикрепить материал"
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={localCurrent ? checklistItemId : ""}
                disabled={!canEdit || busy || limitReached}
                onChange={(event) => {
                  setChecklistItemId(event.target.value);
                  setFile(null);
                  setLocalError(null);
                  upload.reset();
                  if (fileInput.current !== null) fileInput.current.value = "";
                }}
              >
                <option value="">Материалы объекта</option>
                {checklist.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label className="min-w-52 flex-1 space-y-1 text-xs">
              <span>Файл материала</span>
              <Input
                key={targetStamp}
                ref={fileInput}
                aria-label="Файл материала"
                type="file"
                accept={checklistItemId ? "image/jpeg,image/png,image/webp" : "image/jpeg,image/png,image/webp,application/pdf"}
                disabled={!canEdit || busy || limitReached}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setLocalError(null);
                  upload.reset();
                }}
              />
            </label>
            <Button type="button" size="sm" disabled={!canEdit || currentFile === null || busy || limitReached} onClick={() => { void submitUpload(); }}>
              {upload.isPending ? "Загрузка…" : "Загрузить"}
            </Button>
          </div>}
          {!canManage && known && <p className="text-xs text-muted-foreground">Загрузку и удаление ведёт старший объекта на этапе рекогносцировки.</p>}
          {limitReached && <p className="text-xs text-muted-foreground">Достигнут лимит: 30 материалов на объект.{canEdit ? " Удалите ненужный файл перед загрузкой нового." : ""}</p>}
          {localCurrent && localError !== null && <p className="text-sm text-destructive-ink" role="alert">{localError}</p>}
          <StageError error={upload.error} />
          <StageError error={remove.error} />
          <StageError error={downloadForbidden ? null : download.error} />
          {query.isError && <p className="text-sm text-destructive-ink" role="alert">Не удалось загрузить материалы. Повторите попытку.</p>}
          {query.isError && <Button type="button" variant="outline" size="sm" onClick={() => { void query.refetch(); }}>Повторить загрузку списка</Button>}
          {query.isPending ? (
            <p className="text-xs text-muted-foreground">Загрузка материалов…</p>
          ) : known && materials.length === 0 ? (
            <p className="text-xs text-muted-foreground">Материалы для выбранного объекта пока не загружены.</p>
          ) : known ? (
            <div className="space-y-3">
              {[...groups.entries()].map(([itemId, rows]) => (
                <div key={itemId} className="space-y-1">
                  <h4 className="text-xs font-semibold">{itemId ? `Фото: ${labels.get(itemId) ?? "Пункт чек-листа"}` : "Материалы объекта"}</h4>
                  <ul className="space-y-1">
                    {rows.map((row) => (
                      <li key={row.id} data-slot="recon-material-row" className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 px-2 py-1.5">
                        <div className="min-w-0 text-sm">
                          <span className="break-all">{row.name}</span>
                          <p className="text-xs text-muted-foreground">
                            {row.checklistItemId ? labels.get(row.checklistItemId) ?? "Пункт чек-листа" : "Материалы объекта"}
                            {" · "}{(row.size / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} КБ
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <Button type="button" variant="outline" size="sm" disabled={!query.canAct || download.isPending} onClick={() => { void saveDownload(row); }}>
                            {download.isPending && download.variables?.materialId === row.id ? "Скачивание…" : "Скачать"}
                          </Button>
                          {canManage && <Button type="button" variant="ghost" size="sm" disabled={!canEdit || busy} onClick={() => {
                            if (visitObjectId !== null) remove.mutate({ eventId, visitObjectId, materialId: row.id });
                          }}>
                            {remove.isPending && remove.variables?.materialId === row.id ? "Удаление…" : "Удалить"}
                          </Button>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
