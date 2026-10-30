"use client";

import { useRef, useState } from "react";
import { useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";

interface Freshness { status: "FRESH" | "STALE"; can_rebuild?: boolean }

/** Callers key this control by date/division, never by version: an accepted
 * write must keep its read-retry state when a new current version arrives. */
export function SummaryCorrection({ divisionId, businessDate, workspaceReady = true, dataReady = true }: {
  divisionId: number; businessDate: string; workspaceReady?: boolean; dataReady?: boolean;
}) {
  const client = useQueryClient();
  const access = useOpsPermissions();
  const permissionsFetching = useIsFetching({ queryKey: ["ops-me"], exact: true }) > 0;
  const canRead = workspaceReady && !access.isLoading && !access.error && access.hasPermission("status.view");
  const freshness = useQuery<Freshness, OpsApiFailure>({
    queryKey: ["summary-freshness", divisionId, businessDate],
    queryFn: () => opsApiClient.get(`/api/operations/daily-summaries/freshness/?division_id=${divisionId}&business_date=${encodeURIComponent(businessDate)}`),
    enabled: canRead,
    staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: "always", retry: false,
  });
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [sanction, setSanction] = useState("");
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshLock = useRef(false);
  const [refreshError, setRefreshError] = useState(false);
  const [allowIncomplete, setAllowIncomplete] = useState(false);
  const canConfirmPartial = canRead && access.hasPermission("daily_report.override_block");
  const authorized = canRead && access.hasPermission("daily_report.correct") && dataReady && !permissionsFetching && freshness.isSuccess && !freshness.isFetching && freshness.data.can_rebuild === true;
  const canSubmit = authorized && !refreshRequired && !pending && (!allowIncomplete || canConfirmPartial);

  const refresh = async () => {
    if (refreshLock.current || !canRead) return;
    refreshLock.current = true; setRefreshing(true); setRefreshError(false);
    const outcomes = await Promise.allSettled([
      client.invalidateQueries({ queryKey: ["daily-expense-board"] }, { throwOnError: true }),
      client.invalidateQueries({ queryKey: ["service-summary"] }, { throwOnError: true }),
      freshness.refetch({ throwOnError: true }),
    ]);
    const failed = outcomes.some(result => result.status === "rejected");
    setRefreshError(failed); setRefreshRequired(failed);
    refreshLock.current = false; setRefreshing(false);
  };
  const submit = async () => {
    if (saving.current || !canSubmit || !reason.trim() || !sanction.trim()) return;
    saving.current = true; setPending(true); setWriteError(null);
    try {
      await opsApiClient.post("/api/operations/daily-summaries/rebuild/", {
        division_id: divisionId, business_date: businessDate, reason: reason.trim(), sanction: sanction.trim(),
        ...(allowIncomplete ? { allow_incomplete: true } : {}),
      });
    } catch (error) {
      setWriteError(error instanceof Error ? error.message : "Не удалось исправить свод");
      saving.current = false; setPending(false); return;
    }
    // The mutation is accepted. A subsequent read failure must never keep
    // the write form available for resubmission.
    setOpen(false); setReason(""); setSanction(""); setAllowIncomplete(false); setAccepted(true); setRefreshRequired(true);
    saving.current = false; setPending(false);
    await refresh();
  };

  return <div className="space-y-2 text-sm" role="region" aria-label="Исправление свода">
    {freshness.isSuccess && !freshness.isFetching && freshness.data.status === "STALE" && <p className="text-amber-800 dark:text-amber-300">Свод устарел: состав сдач подразделений изменился.</p>}
    {authorized && !refreshRequired && <Button type="button" size="sm" variant="outline" onClick={() => { if (canSubmit) { setWriteError(null); setOpen(true); } }}>Исправить свод</Button>}
    {accepted && <p role="status">Исправленная версия сохранена.</p>}
    {refreshing && <p role="status">Обновляем свод…</p>}
    {(freshness.isError || refreshError || !dataReady) && <div role="alert">
      <p>{accepted ? "Версия сохранена, но обновить данные не удалось." : "Не удалось проверить актуальность и право исправления свода."}</p>
      <Button type="button" size="sm" variant="outline" disabled={!canRead || refreshing || pending} onClick={() => void refresh()}>Повторить загрузку свода</Button>
    </div>}
    {freshness.isSuccess && !freshness.isFetching && freshness.data.can_rebuild !== true && <p className="text-muted-foreground">Исправление свода за это подразделение недоступно.</p>}
    <Dialog open={open && workspaceReady} onOpenChange={next => { if (!saving.current) setOpen(next); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Исправить свод</DialogTitle><DialogDescription>Будет создана новая версия из действующих сдач подразделений. Предыдущая версия сохранится в истории. Новая версия не отправляется автоматически.</DialogDescription></DialogHeader>
        <label className="space-y-1">Причина исправления<textarea aria-label="Причина исправления" className="min-h-20 w-full rounded border bg-background p-2" maxLength={1000} required value={reason} disabled={pending || !authorized} onChange={event => setReason(event.target.value)} /></label>
        <label className="space-y-1">Санкция на исправление<input aria-label="Санкция на исправление" className="w-full rounded border bg-background p-2" maxLength={255} required value={sanction} disabled={pending || !authorized} onChange={event => setSanction(event.target.value)} /></label>
        {(canConfirmPartial || allowIncomplete) && <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" aria-label="Подтверждаю пересборку неполного свода" checked={allowIncomplete} disabled={pending || !authorized || !canConfirmPartial} onChange={event => setAllowIncomplete(event.target.checked)} />
          <span>Подтверждаю пересборку неполного свода. Несдавшие подразделения останутся в списке; причина и санкция будут сохранены.</span>
        </label>}
        {allowIncomplete && !canConfirmPartial && <p role="alert">Право на пересборку неполного свода не подтверждено. Обновите доступ.</p>}
        {!authorized && <p role="alert">Нет подтверждённого права исправления. Черновик сохранён до проверки доступа.</p>}
        {writeError && <p role="alert" className="text-destructive-ink">{writeError}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => { if (!saving.current) setOpen(false); }}>Отмена</Button><Button type="button" disabled={!canSubmit || !reason.trim() || !sanction.trim()} onClick={() => void submit()}>{pending ? "Сохраняем…" : "Создать исправленную версию"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
