"use client";

import { X } from "lucide-react";

// Форма действующей редакции паспорта: секторы и постоянные посты.
// Черновик правится локально и сохраняется целиком (PATCH sectors);
// «Сохранить» активна только при изменениях.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUpdatePassport } from "@/hooks/use-object-passport";
import type { ObjectSector, SecurityPost } from "@/entities/security-object";

let localSeq = 0;
function nextLocalId(): string {
  localSeq += 1;
  return `local-${localSeq}`;
}

interface PassportFormProps {
  objectId: string;
  sectors: ObjectSector[];
  /** object.manage: сервер требует тот же код у PATCH /passport/. */
  canEdit: boolean;
  /** Своё сохранение прошло — родитель может пересобрать форму. */
  onSaved?: () => void;
  /** Ignore results from a form closed by navigation or access loss. */
  isCurrentResult?: () => boolean;
}

export function PassportForm({
  objectId,
  sectors: initial,
  canEdit,
  onSaved,
  isCurrentResult,
}: PassportFormProps) {
  const mutation = useUpdatePassport(objectId, onSaved, isCurrentResult);
  const [sectors, setSectors] = useState<ObjectSector[]>(initial);
  const initialSnapshot = JSON.stringify(initial);
  const [baseSnapshot, setBaseSnapshot] = useState(initialSnapshot);
  const [confirmation, setConfirmation] = useState<{
    action: "reload" | "save";
    serverSnapshot: string;
    sectors: ObjectSector[];
    isCurrentResult?: () => boolean;
  } | null>(null);
  const fieldset = useRef<HTMLFieldSetElement>(null);
  const confirmationTrigger = useRef<HTMLButtonElement | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  const draftSnapshot = JSON.stringify(sectors);
  const dirty = draftSnapshot !== baseSnapshot && draftSnapshot !== initialSnapshot;
  const serverChanged = initialSnapshot !== baseSnapshot;
  const confirmationValid = confirmation !== null && canEdit && !mutation.isPending &&
    confirmation.serverSnapshot === initialSnapshot && confirmation.isCurrentResult?.() !== false;

  useEffect(() => {
    if (serverChanged && !mutation.isPending && (!dirty || draftSnapshot === initialSnapshot)) {
      setSectors(initial);
      setBaseSnapshot(initialSnapshot);
    }
  }, [dirty, draftSnapshot, serverChanged, mutation.isPending, initial, initialSnapshot]);

  useEffect(() => {
    if (confirmation !== null && !confirmationValid) setConfirmation(null);
  }, [confirmation, confirmationValid]);

  function ask(action: "reload" | "save", trigger: HTMLButtonElement): void {
    if (!canEdit || mutation.isPending || isCurrentResult?.() === false) return;
    confirmationTrigger.current = trigger;
    setConfirmation({ action, serverSnapshot: initialSnapshot, sectors, isCurrentResult });
  }

  function confirm(): void {
    if (!confirmationValid || confirmation === null) {
      setConfirmation(null);
      return;
    }
    const chosen = confirmation;
    setConfirmation(null);
    if (chosen.action === "reload") {
      setSectors(initial);
      setBaseSnapshot(initialSnapshot);
    } else {
      mutation.mutate({ sectors: chosen.sectors });
    }
  }

  function addSector(): void {
    setSectors((prev) => [...prev, { id: nextLocalId(), name: "", posts: [] }]);
  }

  function updateSector(sectorId: string, patch: Partial<ObjectSector>): void {
    setSectors((prev) =>
      prev.map((s) => (s.id === sectorId ? { ...s, ...patch } : s))
    );
  }

  function removeSector(sectorId: string): void {
    setSectors((prev) => prev.filter((s) => s.id !== sectorId));
  }

  function addPost(sectorId: string): void {
    setSectors((prev) =>
      prev.map((s) =>
        s.id === sectorId
          ? {
              ...s,
              posts: [
                ...s.posts,
                { id: nextLocalId(), name: "", task: "", requirements: "" },
              ],
            }
          : s
      )
    );
  }

  function updatePost(
    sectorId: string,
    postId: string,
    patch: Partial<SecurityPost>
  ): void {
    setSectors((prev) =>
      prev.map((s) =>
        s.id === sectorId
          ? {
              ...s,
              posts: s.posts.map((p) => (p.id === postId ? { ...p, ...patch } : p)),
            }
          : s
      )
    );
  }

  function removePost(sectorId: string, postId: string): void {
    setSectors((prev) =>
      prev.map((s) =>
        s.id === sectorId
          ? { ...s, posts: s.posts.filter((p) => p.id !== postId) }
          : s
      )
    );
  }

  return (
    <>
      {!canEdit && (
        <p
          className="mb-4 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground"
          data-slot="passport-readonly-reason"
        >
          Паспорт доступен для просмотра. Форма доступна только для чтения.
        </p>
      )}
      {dirty && serverChanged && (
        <div role="alert" className="mb-4 space-y-2 rounded-md border p-3 text-sm">
          <p className="font-semibold">Посты и секторы изменились на сервере.</p>
          <p>Ваш черновик сохранён. Перед сохранением проверьте новую редакцию: он заменит весь состав постов и секторов.</p>
          <Button variant="outline" type="button" className="h-auto min-h-11 whitespace-normal text-left"
            disabled={!canEdit || mutation.isPending || confirmation !== null}
            onClick={(event) => ask("reload", event.currentTarget)}>
            Загрузить новую редакцию
          </Button>
        </div>
      )}
      <fieldset ref={fieldset} disabled={!canEdit || mutation.isPending || confirmation !== null} className="contents">
      <div className="mb-4 flex flex-col gap-4">
        {sectors.map((sector) => (
          <Card key={sector.id}>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <Input
                  className="flex-1 font-semibold"
                  placeholder="Название сектора"
                  aria-label="Название сектора"
                  maxLength={255}
                  value={sector.name}
                  onChange={(e) => updateSector(sector.id, { name: e.target.value })}
                />
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => removeSector(sector.id)}
                >
                  Удалить сектор
                </Button>
              </div>

              <div className="flex flex-col gap-2">
                {sector.posts.map((post) => (
                  <div
                    key={post.id}
                    className="grid grid-cols-1 gap-2 border-b py-2.5 last:border-0 md:grid-cols-[1fr_1.3fr_1.3fr_auto]"
                  >
                    <Input
                      className="h-8 text-xs"
                      placeholder="Название поста"
                      aria-label="Название поста"
                      maxLength={255}
                      value={post.name}
                      onChange={(e) =>
                        updatePost(sector.id, post.id, { name: e.target.value })
                      }
                    />
                    <Input
                      className="h-8 text-xs"
                      placeholder="Задача"
                      aria-label="Задача поста"
                      maxLength={1000}
                      value={post.task}
                      onChange={(e) =>
                        updatePost(sector.id, post.id, { task: e.target.value })
                      }
                    />
                    <Input
                      className="h-8 text-xs"
                      placeholder="Требования к назначению"
                      aria-label="Требования к назначению"
                      maxLength={1000}
                      value={post.requirements}
                      onChange={(e) =>
                        updatePost(sector.id, post.id, {
                          requirements: e.target.value,
                        })
                      }
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      aria-label="Удалить пост"
                      onClick={() => removePost(sector.id, post.id)}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  className="w-fit"
                  onClick={() => addPost(sector.id)}
                >
                  + Пост
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mb-4 flex justify-between">
        <Button variant="outline" type="button" onClick={addSector}>
          + Сектор
        </Button>
        <div className="flex flex-col items-end gap-2">
          {mutation.error !== null && (
            <p className="text-sm text-destructive-ink" role="alert">
              Не удалось сохранить паспорт.
            </p>
          )}
          <Button
            type="button"
            disabled={mutation.isPending || !dirty}
            onClick={(event) => {
              if (!canEdit || mutation.isPending || isCurrentResult?.() === false) return;
              if (serverChanged) ask("save", event.currentTarget);
              else mutation.mutate({ sectors });
            }}
          >
            {mutation.isPending ? "Сохранение…" : "Сохранить паспорт"}
          </Button>
        </div>
      </div>
      </fieldset>
      <Dialog open={confirmationValid} onOpenChange={(open) => { if (!open) setConfirmation(null); }}>
        <DialogContent role="alertdialog" showCloseButton={false}
          onOpenAutoFocus={(event) => { event.preventDefault(); cancelButton.current?.focus(); }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            requestAnimationFrame(() => {
              const trigger = confirmationTrigger.current;
              if (trigger?.isConnected && !trigger.disabled) trigger.focus();
              else fieldset.current?.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled)")?.focus();
            });
          }}>
          <DialogHeader>
            <DialogTitle>{confirmation?.action === "reload" ? "Заменить черновик новой редакцией?" : "Сохранить поверх новой редакции?"}</DialogTitle>
            <DialogDescription>
              {confirmation?.action === "reload"
                ? "Несохранённые изменения постов и секторов будут потеряны. Форма покажет загруженную редакцию целиком."
                : "Ваш черновик заменит все посты и секторы загруженной редакции, включая чужие добавления и удаления."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button ref={cancelButton} type="button" variant="outline" onClick={() => setConfirmation(null)}>Отмена</Button>
            <Button type="button" className="h-auto min-h-11 whitespace-normal" disabled={!confirmationValid} onClick={confirm}>
              {confirmation?.action === "reload" ? "Заменить черновик" : "Сохранить мой черновик"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
