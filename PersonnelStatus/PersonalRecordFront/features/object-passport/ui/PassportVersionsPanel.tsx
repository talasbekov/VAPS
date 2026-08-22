"use client";

// История публикаций паспорта. Публикуется ДЕЙСТВУЮЩАЯ редакция — та, что
// показывает форма выше; секторы в запрос не кладутся, снимок делает сервер
// (иначе можно было бы опубликовать не то, что видно). Опубликованные версии
// только читаются: версия неизменяема после публикации.
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePublishPassportVersion } from "@/hooks/use-object-passport";
import type { PassportVersion } from "@/entities/security-object";
import { formatIsoDateTime, formatIsoDate } from "@/shared/lib/date";

export const NOTHING_TO_PUBLISH_TEXT =
  "В паспорте нет ни одного поста — публиковать нечего.";

interface PassportVersionsPanelProps {
  objectId: string;
  versions: PassportVersion[];
  hasPosts: boolean;
}

export function PassportVersionsPanel({
  objectId,
  versions,
  hasPosts,
}: PassportVersionsPanelProps) {
  const mutation = usePublishPassportVersion(objectId);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [note, setNote] = useState("");

  return (
    <Card>
      <CardContent className="p-4">
        <h2 className="mb-2.5 text-sm font-semibold">Версии паспорта</h2>

        {versions.length === 0 ? (
          <p className="mb-3 text-xs text-muted-foreground">
            Паспорт ещё не публиковался. Дежурства и расстановки опираются на
            опубликованную версию, а не на черновик.
          </p>
        ) : (
          <ul className="mb-3 flex flex-col gap-1.5">
            {[...versions]
              .sort((a, b) => b.versionNumber - a.versionNumber)
              .map((version) => (
                <li key={version.id} className="rounded-md border p-2.5 text-xs">
                  <Link
                    href={`/security-ops/objects/${objectId}/passports/${version.id}`}
                    className="font-semibold text-primary-ink"
                  >
                    Версия {version.versionNumber}
                  </Link>{" "}
                  <span className="text-muted-foreground">
                    действует с {formatIsoDate(version.effectiveFrom)} · опубликовано{" "}
                    {formatIsoDateTime(version.publishedAt)}
                    {version.note !== "" ? ` · ${version.note}` : ""}
                  </span>
                </li>
              ))}
          </ul>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="passport-version-effective-from">Действует с *</Label>
            <Input
              id="passport-version-effective-from"
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </div>
          <div className="min-w-56 flex-1 space-y-1">
            <Label htmlFor="passport-version-note">Примечание к публикации</Label>
            <Input
              id="passport-version-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Button
            type="button"
            disabled={effectiveFrom === "" || !hasPosts || mutation.isPending}
            title={hasPosts ? undefined : NOTHING_TO_PUBLISH_TEXT}
            onClick={() => mutation.mutate({ effectiveFrom, note })}
          >
            {mutation.isPending ? "Публикация…" : "Опубликовать версию"}
          </Button>
        </div>

        {!hasPosts && (
          <p className="mt-2 text-xs text-muted-foreground">
            {NOTHING_TO_PUBLISH_TEXT}
          </p>
        )}
        {mutation.error !== null && (
          <p className="mt-2 text-sm text-destructive-ink" role="alert">
            Не удалось опубликовать версию: на эту дату версия уже есть либо
            паспорт пуст.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
