"use client";

import { X } from "lucide-react";

// Форма действующей редакции паспорта: секторы и постоянные посты.
// Черновик правится локально и сохраняется целиком (PATCH sectors);
// «Сохранить» активна только при изменениях.
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUpdatePassport } from "@/hooks/use-object-passport";
import type { GeoPoint, ObjectSector, SecurityPost } from "@/entities/security-object";
import { ObjectLocationMap } from "@/features/object-map/ui/ObjectLocationMap";
import { PostLocationEditor } from "./PostLocationEditor";
import { PassportPostsMap } from "./PassportPostsMap";
import { isGeoPoint } from "@/features/object-map/model/location";

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
  isActive?: boolean;
  objectLocation?: GeoPoint | null;
  /** Своё сохранение прошло — родитель может пересобрать форму. */
  onSaved?: () => void;
  /** Ignore results from a form closed by navigation or access loss. */
  isCurrentResult?: () => boolean;
}

export function PassportForm({
  objectId,
  sectors: initial,
  canEdit,
  isActive = true,
  objectLocation = null,
  onSaved,
  isCurrentResult,
}: PassportFormProps) {
  const mutation = useUpdatePassport(objectId, onSaved, isCurrentResult);
  const [sectors, setSectors] = useState<ObjectSector[]>(initial);
  const [selectedPost, setSelectedPost] = useState<{ sectorId: string; postId: string } | null>(null);
  const initialSnapshot = JSON.stringify(initial);
  const [baseSnapshot, setBaseSnapshot] = useState(initialSnapshot);
  const [confirmation, setConfirmation] = useState<{
    action: "reload" | "save";
    serverSnapshot: string;
    sectors: ObjectSector[];
    isCurrentResult?: () => boolean;
  } | null>(null);
  const fieldset = useRef<HTMLFieldSetElement>(null);
  const postFields = useRef(new Map<string, HTMLInputElement>());
  const confirmationTrigger = useRef<HTMLButtonElement | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const context = useMemo(() => ({}), [objectId, canEdit, isActive]);
  const latest = useRef({ context, isCurrentResult, selectedPost, pending: mutation.isPending, confirmation });
  latest.current = { context, isCurrentResult, selectedPost, pending: mutation.isPending, confirmation };
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const canMutate = () => mounted.current && latest.current.context === context && canEdit && isActive &&
    !latest.current.pending && latest.current.confirmation === null && latest.current.isCurrentResult?.() !== false;
  const selected = selectedPost && sectors.find(sector => sector.id === selectedPost.sectorId)?.posts.find(post => post.id === selectedPost.postId);
  useEffect(() => { if (selectedPost && !selected) setSelectedPost(null); }, [selectedPost, selected]);

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
    if (!canMutate()) return;
    setSectors((prev) => [...prev, { id: nextLocalId(), name: "", posts: [] }]);
  }

  function updateSector(sectorId: string, patch: Partial<ObjectSector>): void {
    if (!canMutate()) return;
    setSectors((prev) =>
      prev.map((s) => (s.id === sectorId ? { ...s, ...patch } : s))
    );
  }

  function removeSector(sectorId: string): void {
    if (!canMutate()) return;
    setSelectedPost(previous => previous?.sectorId === sectorId ? null : previous);
    setSectors((prev) => prev.filter((s) => s.id !== sectorId));
  }

  function addPost(sectorId: string): void {
    if (!canMutate()) return;
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

  function addPostAt(sectorId: string | null, point: GeoPoint): void {
    if (!canMutate() || latest.current.selectedPost || !isGeoPoint(point)) return;
    const postId = nextLocalId();
    const firstSectorId = nextLocalId();
    setSectors(previous => {
      if (previous.length && !previous.some(s => s.id === sectorId)) return previous;
      if (!previous.length && sectorId !== null) return previous;
      const allPosts = previous.flatMap(s => s.posts);
      let number = allPosts.length + 1;
      while (allPosts.some(p => p.name === `Пост ${number}`)) number++;
      const post = { id: postId, name: `Пост ${number}`, task: "", requirements: "", location: point };
      if (!previous.length) return [{ id: firstSectorId, name: "Основной сектор", posts: [post] }];
      return previous.map(s => s.id === sectorId ? { ...s, posts: [...s.posts, post] } : s);
    });
  }

  function updatePost(
    sectorId: string,
    postId: string,
    patch: Partial<SecurityPost>
  ): void {
    if (!canMutate()) return;
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
    if (!canMutate()) return;
    setSelectedPost(previous => previous?.sectorId === sectorId && previous.postId === postId ? null : previous);
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
      {canEdit ? <PassportPostsMap location={objectLocation} sectors={sectors}
        canEdit={isActive && !mutation.isPending && confirmation === null && !selected && isCurrentResult?.() !== false}
        onAddPost={addPostAt} onSelectPost={(sectorId, postId) => {
          if (!canMutate() || latest.current.selectedPost) return;
          const input = postFields.current.get(`${sectorId}:${postId}`);
          input?.scrollIntoView({ block: "center", behavior: "smooth" });
          input?.focus({ preventScroll: true });
        }} /> : <ObjectLocationMap location={objectLocation} sectors={sectors} title="Карта постов паспорта" />}
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
      <fieldset ref={fieldset} disabled={!canEdit || !isActive || mutation.isPending || confirmation !== null} className="contents">
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
                      ref={element => {
                        const key = `${sector.id}:${post.id}`;
                        if (element) postFields.current.set(key, element);
                        else postFields.current.delete(key);
                      }}
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
                    <div className="md:col-span-4">
                      <Button type="button" size="sm" variant="outline" aria-label={`Местоположение поста: ${post.name || "Без названия"}`}
                        disabled={Boolean(selected)}
                        aria-expanded={selectedPost?.sectorId === sector.id && selectedPost.postId === post.id}
                        onClick={() => { if (canMutate() && !latest.current.selectedPost) setSelectedPost({ sectorId: sector.id, postId: post.id }); }}>
                        Местоположение поста
                      </Button>
                    </div>
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

      {selected && selectedPost && <PostLocationEditor key={`${selectedPost.sectorId}:${selectedPost.postId}`} post={selected}
        canEdit={canEdit && !mutation.isPending && confirmation === null} isActive={isActive} isCurrentResult={isCurrentResult}
        onCancel={() => setSelectedPost(null)} onApply={location => {
          if (!canMutate() || latest.current.selectedPost !== selectedPost) return;
          updatePost(selectedPost.sectorId, selectedPost.postId, { location }); setSelectedPost(null);
        }} />}
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
            disabled={mutation.isPending || !dirty || Boolean(selected)}
            onClick={(event) => {
              if (!canMutate() || selected) return;
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
