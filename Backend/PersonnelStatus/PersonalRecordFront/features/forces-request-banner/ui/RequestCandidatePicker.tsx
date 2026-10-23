"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useRequestCandidates, useRequestCandidateReview, useSelectForRequest, type DirectorateForcesRequest, type RequestCandidate } from "@/hooks/use-forces-request-banner";
import { assertOpsReadAuthority } from "@/hooks/use-ops-protected-read";
import { blockReadAccess } from "@/lib/query-read-access";
import { formatIsoDate } from "@/shared/lib/date";

const eligible = (row: RequestCandidate) => row.assessment === "AVAILABLE" || row.assessment === "RESERVE_ELIGIBLE";

/** This draft belongs to one request/kind/authority, keyed by its parent. */
export function RequestCandidatePicker({ request, kindCode, roleCode, incomplete, onSelected }: {
  request: DirectorateForcesRequest; kindCode: string; roleCode: string; incomplete: boolean; onSelected?: () => void;
}) {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [chosen, setChosen] = useState<RequestCandidate[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [sendError, setSendError] = useState("");
  const candidates = useRequestCandidates(request.allocationId, kindCode, roleCode, query, page, !incomplete);
  const ids = chosen.map(row => row.employeeId);
  const review = useRequestCandidateReview(request.allocationId, kindCode, roleCode, ids, reviewOpen);
  const select = useSelectForRequest(request.allocationId);
  const resetReport = select.reset;
  useEffect(() => { const timer = setTimeout(() => { setQuery(search); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  const failedRead = candidates.isError || candidates.readAccessBlocked || !review.access.allowed;
  useEffect(() => { if (failedRead) { setReviewOpen(false); setChosen([]); setReason(""); resetReport(); } }, [failedRead, resetReport]);
  const data = !failedRead ? candidates.data : undefined;
  const current = data?.request ?? request;
  const need = current.needByKind?.[kindCode] ?? (kindCode === "PHYSICAL_SQUAD" ? current.directorates.reduce((sum, row) => sum + row.need, 0) : 0);
  const assigned = current.assignedByKind?.[kindCode] ?? (current.assignedByKind ? 0 : kindCode === "PHYSICAL_SQUAD" ? current.directorates.reduce((sum, row) => sum + row.assigned, 0) : 0);
  const remaining = Math.max(0, need - assigned - chosen.length);
  const rows = data?.results ?? [];
  const checked = new Set(ids);
  const reviewData = review.isError || review.readAccessBlocked ? undefined : review.data;
  const reviewed = reviewData?.results ?? [];
  const missing = reviewData !== undefined && (reviewed.length !== chosen.length || ids.some(id => !reviewed.some(row => row.employeeId === id)));
  const blocked = reviewed.some(row => row.assessment === "BLOCKED");
  const needsReason = reviewed.some(row => row.assessment === "REQUIRES_REASON");
  const canSend = review.canAct && !missing && !blocked && (!needsReason || reason.trim() !== "") && !select.isPending && ids.length > 0;
  const reviewRequest = reviewData?.request ?? current;
  const context = `${reviewRequest.code} · ${formatIsoDate(reviewRequest.businessDate)}${reviewRequest.businessDateEnd && reviewRequest.businessDateEnd !== reviewRequest.businessDate ? ` — ${formatIsoDate(reviewRequest.businessDateEnd)}` : ""} · ${reviewRequest.location || "Объект назначит Штаб"}`;
  const changeSelection = (rows: RequestCandidate[]) => { setChosen(rows); setReviewOpen(false); setReason(""); setSendError(""); };

  return <section data-slot="request-candidate-picker" className="space-y-3 rounded-lg border bg-background p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="font-semibold">Выбор сотрудников</h3><p className="text-sm" aria-live="polite">{remaining > 0 ? `Выберите ещё ${remaining}` : "Состав набран — проверьте выбранных"}</p></div>
      <p className="text-sm tabular-nums">Нужно {need} · уже выделено {assigned} · выбрано {chosen.length}</p>
    </div>
    <p className="text-xs text-muted-foreground">{kindCode === "PHYSICAL_SQUAD" ? "Предлагаем людей в общий резерв. Занятость на даты и объект проверит Штаб при распределении." : "Проверяем ограничения на весь период мероприятия. Специальность выбирает ответственный; проверка не подтверждает навыки сотрудника."}</p>
    {incomplete ? <p>Выберите группу и специальность выше.</p> : <>
      <Label htmlFor="request-candidate-search">Поиск сотрудника по всему доступному составу</Label>
      <Input id="request-candidate-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="ФИО, подразделение, табельный номер" disabled={select.isPending} />
      <p className="text-xs text-muted-foreground">Сначала подходящие среди показанных. Проверка и предложение состава относятся только к этой странице (до 50 сотрудников).</p>
      {candidates.isPending && <p role="status">Проверяем кандидатов…</p>}
      {failedRead && <div role="alert"><p>Не удалось проверить кандидатов. Состав скрыт до успешной повторной проверки.</p><Button variant="outline" onClick={() => void candidates.refetch()}>Повторить проверку</Button></div>}
      {data && <>
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {rows.map(row => <li key={row.employeeId} className="rounded-md border p-2">
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" aria-label={row.name} className="mt-1 h-5 w-5" checked={checked.has(row.employeeId)} disabled={row.assessment === "BLOCKED" || !candidates.canAct || select.isPending}
                onChange={event => changeSelection(event.target.checked ? [...chosen.filter(item => item.employeeId !== row.employeeId), row] : chosen.filter(item => item.employeeId !== row.employeeId))} />
              <span className="min-w-0"><strong className="block">{row.name}</strong><span className="block text-muted-foreground">{[row.rankLabel, row.unit].filter(Boolean).join(" · ")}</span><span className="block">{row.message}</span></span>
            </label>
          </li>)}
        </ul>
        {rows.length === 0 && <p>По запросу сотрудников не найдено. Измените поиск.</p>}
        <div className="flex flex-wrap items-center gap-2 text-sm"><span>Найдено {data.count}</span>
          {(page > 1 || data.count > data.pageSize) && <><span>· страница {page}</span>
          <Button variant="outline" disabled={page === 1 || candidates.isFetching || select.isPending} onClick={() => setPage(value => value - 1)}>Назад</Button>
          <Button variant="outline" disabled={!data.hasNext || candidates.isFetching || select.isPending} onClick={() => setPage(value => value + 1)}>Дальше</Button></>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal py-2 text-center" disabled={!candidates.canAct || remaining === 0 || !rows.some(row => eligible(row) && !checked.has(row.employeeId)) || select.isPending}
            onClick={() => changeSelection([...chosen, ...rows.filter(row => eligible(row) && !checked.has(row.employeeId)).slice(0, remaining)])}>Предложить состав из показанных</Button>
          <Button className="h-auto min-h-11 max-w-full whitespace-normal py-2 text-center" disabled={chosen.length === 0 || !candidates.canAct || select.isPending} onClick={() => { setSendError(""); setReviewOpen(true); }}>Проверить выбранных: {chosen.length}</Button>
          {chosen.length > 0 && <Button variant="ghost" disabled={select.isPending} onClick={() => changeSelection([])}>Снять выбор</Button>}
        </div>
      </>}
    </>}
    {!failedRead && candidates.canAct && select.data && <div role="status" data-slot="select-report" className="text-sm"><p>Выделено: {select.data.selected.length}</p>{select.data.refused.map(row => <p key={row.employeeId}>{row.name} — {row.message}</p>)}</div>}
    <Dialog open={reviewOpen && !failedRead} onOpenChange={value => { if (!select.isPending) setReviewOpen(value); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Проверьте состав перед отправкой</DialogTitle><DialogDescription>{context}</DialogDescription></DialogHeader>
        <p className="text-sm">{kindCode === "PHYSICAL_SQUAD" ? "Общий резерв; финальные даты и объект назначит Штаб." : "Специальная группа; после отправки будет создано участие на период мероприятия."}</p>
        {review.isFetching && <p role="status">Повторно проверяем выбранных…</p>}
        {review.isError && <p role="alert">Проверка не завершена. Закройте окно и повторите проверку.</p>}
        {reviewData && <ul className="space-y-2">{reviewed.map(row => <li key={row.employeeId}><strong>{row.name}</strong><p className="text-sm">{row.message}</p></li>)}</ul>}
        {missing && <p role="alert">Часть выбранных сотрудников больше недоступна. Вернитесь к подбору и обновите состав.</p>}
        {blocked && <p role="alert">В составе есть ограничения. Вернитесь к подбору и уберите недоступных сотрудников.</p>}
        {needsReason && <div className="space-y-1"><Label htmlFor="candidate-override-reason">Обоснование выделения несмотря на занятость</Label><Input id="candidate-override-reason" value={reason} onChange={event => setReason(event.target.value)} disabled={select.isPending} /></div>}
        {(sendError || select.isError) && <p role="alert">{sendError || select.error?.message}</p>}
        <DialogFooter><Button variant="outline" disabled={select.isPending} onClick={() => setReviewOpen(false)}>Вернуться к выбору</Button><Button disabled={!canSend} onClick={() => {
          try { assertOpsReadAuthority(client, review.access, "ops-request-candidates", review.readKey); }
          catch (error) { setSendError(error instanceof Error ? error.message : "Проверьте доступ повторно."); return; }
          if (!canSend) return;
          select.mutate({ employeeIds: ids, kindCode, roleCode: roleCode || undefined, override: needsReason, override_reason: needsReason ? reason.trim() : undefined }, {
            onSuccess: () => { setReviewOpen(false); setChosen([]); setReason(""); void client.invalidateQueries({ queryKey: ["ops-request-candidates"] }); onSelected?.(); },
            onError: error => {
              if ("status" in error && [401, 403, 404].includes(error.status ?? 0)) {
                blockReadAccess(client, candidates.readKey, true);
                blockReadAccess(client, review.readKey, true);
                setChosen([]); setReviewOpen(false); setReason("");
              }
            },
          });
        }}>{select.isPending ? "Отправляем…" : kindCode === "PHYSICAL_SQUAD" ? "Отправить в резерв" : "Отправить состав"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
