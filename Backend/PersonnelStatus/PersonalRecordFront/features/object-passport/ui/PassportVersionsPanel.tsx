"use client";

// История публикаций паспорта. Публикуется ДЕЙСТВУЮЩАЯ редакция — та, что
// показывает форма выше; секторы в запрос не кладутся, снимок делает сервер
// (иначе можно было бы опубликовать не то, что видно). Опубликованные версии
// только читаются: версия неизменяема после публикации.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoadFailure } from "@/components/load-failure";
import { PassportVersionSnapshot } from "./PassportVersionSnapshot";
import { usePublishPassportVersion } from "@/hooks/use-object-passport";
import type { PassportVersion } from "@/entities/security-object";
import { formatIsoDateTime, formatIsoDate } from "@/shared/lib/date";

export const NOTHING_TO_PUBLISH_TEXT =
  "В паспорте нет ни одного поста — публиковать нечего.";

interface PassportVersionsPanelProps {
  objectId: string;
  versions: PassportVersion[];
  hasPosts: boolean;
  /** object.manage: сервер требует тот же код у POST публикации. */
  canPublish: boolean;
  isCurrentResult?: () => boolean;
  backToRegistry?: string;
  objectName?: string;
  isActive?: boolean;
  readFailure?: { onRetry: () => void; isRetrying: boolean };
}

export function PassportVersionsPanel({
  objectId,
  versions,
  hasPosts,
  canPublish,
  isCurrentResult,
  backToRegistry = "",
  objectName = "Паспорт объекта",
  isActive = true,
  readFailure,
}: PassportVersionsPanelProps) {
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [note, setNote] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = isActive ? versions.find(version => version.id === previewId) : undefined;
  const previewTrigger = useRef<HTMLAnchorElement | null>(null);
  const previewContent = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (previewId !== null && preview === undefined) setPreviewId(null);
  }, [previewId, preview]);
  function versionHref(versionId: string) {
    return `/security-ops/objects/${objectId}/passports/${versionId}${backToRegistry === "" ? "" : `?back=${encodeURIComponent(backToRegistry)}`}`;
  }
  const mutation = usePublishPassportVersion(objectId, () => {
    setEffectiveFrom("");
    setNote("");
  }, isCurrentResult);

  return (
    <Card>
      <CardContent className="p-4">
        <h2 ref={heading} tabIndex={-1} className="mb-2.5 text-sm font-semibold">Версии паспорта</h2>

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
                    href={versionHref(version.id)}
                    aria-haspopup="dialog"
                    onClick={(event) => {
                      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                      event.preventDefault(); previewTrigger.current = event.currentTarget; setPreviewId(version.id);
                    }}
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

        {!canPublish && (
          <p className="mb-3 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            История доступна для просмотра. Публикация доступна только для чтения.
          </p>
        )}

        <fieldset disabled={!canPublish || mutation.isPending} className="flex flex-wrap items-end gap-2">
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
        </fieldset>

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
      <Dialog open={preview !== undefined} onOpenChange={(open) => { if (!open) setPreviewId(null); }}>
        <DialogContent ref={previewContent} className="sm:max-w-3xl"
          onOpenAutoFocus={(event) => { event.preventDefault(); previewContent.current?.focus({ preventScroll: true }); }}
          onCloseAutoFocus={(event) => {
            event.preventDefault(); requestAnimationFrame(() => {
              const trigger = previewTrigger.current;
              if (trigger?.isConnected && trigger.getClientRects().length) trigger.focus();
              else if (heading.current?.getClientRects().length) heading.current.focus();
              else document.querySelector<HTMLElement>('[aria-label="Разделы паспорта"] [role="tab"][aria-selected="true"]')?.focus();
            });
          }}>
          {preview !== undefined && <>
            <DialogHeader>
              <DialogTitle>{objectName} · версия {preview.versionNumber}</DialogTitle>
              <DialogDescription>Действует с {formatIsoDate(preview.effectiveFrom)} · опубликовано {formatIsoDateTime(preview.publishedAt)} · {preview.publishedBy}</DialogDescription>
            </DialogHeader>
            {readFailure !== undefined && <LoadFailure what="опубликованную версию паспорта"
              description="Показан последний загруженный снимок. Черновики сохранены."
              onRetry={readFailure.onRetry} isRetrying={readFailure.isRetrying} />}
            <PassportVersionSnapshot version={preview} />
            <DialogFooter>
              <Link href={versionHref(preview.id)} target="_blank" rel="noopener noreferrer"
                className="flex min-h-11 items-center justify-center rounded-md border px-3 py-2 text-sm font-semibold text-primary-ink hover:bg-muted">
                Открыть в новой вкладке
              </Link>
              <Button type="button" className="min-h-11" onClick={() => setPreviewId(null)}>Закрыть просмотр</Button>
            </DialogFooter>
          </>}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
