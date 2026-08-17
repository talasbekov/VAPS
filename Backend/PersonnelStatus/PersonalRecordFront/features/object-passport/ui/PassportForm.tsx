"use client";

import { X } from "lucide-react";

// Форма действующей редакции паспорта: секторы и постоянные посты.
// Черновик правится локально и сохраняется целиком (PATCH sectors);
// «Сохранить» активна только при изменениях.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  /** Своё сохранение прошло — родитель может пересобрать форму. */
  onSaved?: () => void;
}

export function PassportForm({
  objectId,
  sectors: initial,
  onSaved,
}: PassportFormProps) {
  const mutation = useUpdatePassport(objectId, onSaved);
  const [sectors, setSectors] = useState<ObjectSector[]>(initial);

  const dirty = JSON.stringify(sectors) !== JSON.stringify(initial);

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
      <div className="mb-4 flex flex-col gap-4">
        {sectors.map((sector) => (
          <Card key={sector.id}>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <Input
                  className="flex-1 font-semibold"
                  placeholder="Название сектора"
                  aria-label="Название сектора"
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
                      value={post.name}
                      onChange={(e) =>
                        updatePost(sector.id, post.id, { name: e.target.value })
                      }
                    />
                    <Input
                      className="h-8 text-xs"
                      placeholder="Задача"
                      aria-label="Задача поста"
                      value={post.task}
                      onChange={(e) =>
                        updatePost(sector.id, post.id, { task: e.target.value })
                      }
                    />
                    <Input
                      className="h-8 text-xs"
                      placeholder="Требования к назначению"
                      aria-label="Требования к назначению"
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
            onClick={() => mutation.mutate({ sectors })}
          >
            {mutation.isPending ? "Сохранение…" : "Сохранить паспорт"}
          </Button>
        </div>
      </div>
    </>
  );
}
