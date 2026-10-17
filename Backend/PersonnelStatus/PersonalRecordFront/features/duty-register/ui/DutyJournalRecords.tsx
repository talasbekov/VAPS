'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { OpsAccessDenied } from '@/components/ops-access-denied';
import { OpsPermissionsUnavailable, isPermissionsCheckFailure } from '@/components/ops-permissions-unavailable';
import { LoadFailure } from '@/components/load-failure';
import { Button } from '@/components/ui/button';
import { DUTY_REGISTER_HREF, DUTY_REGISTER_PATH, dutyRegisterQuery, dutyDateTime, dutyLocalInput, type DutyRecord, type DutyRegisterSnapshot } from '@/entities/duty-register';
import { useDutyRegister, useDutyRegisterAccess, useDutyKinds, useInvalidateDutyRegister } from '@/hooks/use-duty-register';
import { opsApiClient } from '@/lib/ops-api';
import { friendlyOpsErrorMessage } from '@/lib/ops-errors';
import { DutyRegisterFilters } from './DutyRegisterFilters';
import { DutyRegisterAppliedFilters } from './DutyRegisterAppliedFilters';
import { DutyRegisterRows, DutyRegisterSummary } from './DutyRegisterResults';
import { DutyRegisterGroups } from './DutyRegisterGroups';
import { DutyLogForm } from './DutyLogForm';
import { DutyRecordDialog } from './DutyRecordDialog';
import { PENDING_DUTY_CREATION_EVENT, readPendingCreation } from '../model/pending-creation';
import { dutySummaryCsv } from '../model/summary-csv';
import { projectDutyTemplate, templateFromDraft, type DutyTemplateDraft } from '../model/templates';

const emptyData = (params: URLSearchParams): DutyRegisterSnapshot => ({ period: { from: params.get('from') ?? '', to: params.get('to') ?? '' }, generated_at: '', time_zone: 'Asia/Qyzylorda',
  rows: [], summary: { record_count: 0, employee_count: 0, completed_count: 0, active_count: 0, cancelled_count: 0, unconfirmed_count: 0, attention_count: 0,
    overlap_count: 0, missing_kind_count: 0, unknown_planned_count: 0, unknown_actual_count: 0, confirmed_actual_count: 0, planned_minutes: 0, actual_record_minutes: 0, actual_minutes: 0 },
  by_kind: [], by_employee: [], filters: { divisions: [], employees: [] }, pagination: { count: 0, page: 1, pages: 1, page_size: 25 } });

export function DutyJournalRecords() {
  const access = useDutyRegisterAccess();
  const params = useSearchParams();
  const router = useRouter();
  const [routePending, startNavigation] = useTransition();
  const client = useQueryClient();
  const search = new URLSearchParams(params);
  const queryString = dutyRegisterQuery(search);
  const query = useDutyRegister(queryString, access.allowed, access.scope);
  const data = query.visibleData;
  const kinds = useDutyKinds(access.allowed, access.scope);
  const refresh = useInvalidateDutyRegister();
  const [create, setCreate] = useState(false);
  const [initialDraft, setInitialDraft] = useState<DutyTemplateDraft | null>(null);
  const [pendingCreation, setPendingCreation] = useState(false);
  useEffect(() => {
    const check = () => {
      if (!access.actor) { setPendingCreation(false); return; }
      try { setPendingCreation(Boolean(readPendingCreation(access.actor))); }
      catch { setPendingCreation(true); }
    };
    check(); window.addEventListener(PENDING_DUTY_CREATION_EVENT, check);
    return () => window.removeEventListener(PENDING_DUTY_CREATION_EVENT, check);
  }, [access.actor, access.scope]);
  const [editing, setEditing] = useState<DutyRecord | null>(null);
  const [notice, setNotice] = useState('');
  const [exporting, setExporting] = useState<'records' | 'summary' | null>(null);
  const [exportError, setExportError] = useState('');
  const exportLock = useRef(false);
  const results = useRef<HTMLDivElement>(null);
  const currentScope = useRef(access.scope);
  currentScope.current = access.scope;
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const committedScope = useRef(access.scope);
  useEffect(() => {
    // Suspense reconnects effects after a temporary permissions outage. A
    // reconnect in the same scope must keep the user's unsaved form intact.
    if (committedScope.current === access.scope) return;
    committedScope.current = access.scope;
    setCreate(false); setInitialDraft(null); setEditing(null); setNotice(''); setExportError('');
  }, [access.scope]);
  const view = ['kinds', 'employees'].includes(params.get('view') ?? '') ? params.get('view')! : 'records';
  const exportContext = JSON.stringify([access.scope, queryString, view, access.allowed, query.blocked]);
  const exportGeneration = useRef({ context: exportContext, version: 0 });
  if (exportGeneration.current.context !== exportContext) {
    exportGeneration.current = { context: exportContext, version: exportGeneration.current.version + 1 };
  }
  const rawGroupPage = Number(params.get('group_page') ?? '1');
  const groupPage = Number.isSafeInteger(rawGroupPage) && rawGroupPage >= 1 ? rawGroupPage : 1;
  const recordId = params.get('record') ?? '';
  const recordValid = /^(LOG|PLAN|DISPATCH):[1-9]\d{0,18}$/.test(recordId);
  const busy = query.isFetching || Boolean(exporting) || routePending;
  const writable = access.allowed && Boolean(data) && !query.isError && !busy;
  function navigate(values: Record<string, string>, resetPage = true) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) value ? next.set(key, value) : next.delete(key);
    if (resetPage) { next.delete('page'); next.delete('group_page'); }
    startNavigation(() => router.replace(DUTY_REGISTER_HREF + (next.size ? '?' + next : ''), { scroll: false }));
    setNotice(''); setExportError('');
  }
  // The first server response pins the default period in the shareable URL.
  useEffect(() => {
    if (data && !params.has('from') && !params.has('to')) {
      const next = new URLSearchParams(params);
      next.set('from', data.period.from); next.set('to', data.period.to);
      startNavigation(() => router.replace(DUTY_REGISTER_HREF + '?' + next, { scroll: false }));
    }
  }, [data, params, router]);
  function filter(values: Record<string, string>) { navigate({ ...values, view: 'records', record: '' }); }
  function page(next: number) {
    navigate({ page: String(next) }, false);
    requestAnimationFrame(() => { results.current?.focus({ preventScroll: true }); results.current?.scrollIntoView({ block: 'start' }); });
  }
  async function saved(row: DutyRecord) {
    setCreate(false); setInitialDraft(null); setEditing(null); setNotice('Запись сохранена.');
    navigate({ record: row.id }, false);
    setNotice('Запись сохранена.');
  }
  function copyRecord(row: DutyRecord) {
    if (!writable || !access.canCreate || pendingCreation || !data) return;
    const draft: DutyTemplateDraft = { service_duty_code: row.service_duty_code ?? '',
      planned_start: dutyLocalInput(row.planned_start, data.time_zone), planned_end: dutyLocalInput(row.planned_end, data.time_zone),
      location_label: row.location_label, document_basis: row.document_basis, note: row.note };
    const defaultDate = data.period.from;
    try { setInitialDraft(projectDutyTemplate(templateFromDraft('copy', 'Параметры записи', draft), defaultDate)); }
    catch { setInitialDraft({ ...draft, planned_start: '', planned_end: '' }); }
    navigate({ record: '' }, false); setEditing(null); setCreate(true);
  }
  async function download(summary = false) {
    if (!access.allowed || query.blocked || exportLock.current || !data || query.isError || busy || (summary && view === 'records')) return;
    exportLock.current = true; setExporting(summary ? 'summary' : 'records'); setExportError('');
    const scope = access.scope;
    const generation = exportGeneration.current.version;
    const stillCurrent = () => active.current && currentScope.current === scope && exportGeneration.current.version === generation;
    try {
      let file: { blob: Blob; filename?: string | null };
      if (summary) {
        const refreshed = await query.refetch();
        if (refreshed.isError || !refreshed.data) throw refreshed.error ?? new Error('Не удалось обновить сводку.');
        if (!stillCurrent()) return;
        const csv = dutySummaryCsv(refreshed.data, view === 'employees' ? 'employees' : 'kinds', new URLSearchParams(params));
        file = { blob: new Blob([csv.content], { type: 'text/csv;charset=utf-8' }), filename: csv.filename };
      } else file = await opsApiClient.download(DUTY_REGISTER_PATH + 'export/?' + dutyRegisterQuery(new URLSearchParams(params), true));
      if (!stillCurrent()) return;
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement('a'); link.href = url; link.download = file.filename ?? 'Журнал дежурств.csv';
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      if (stillCurrent()) { setExportError(friendlyOpsErrorMessage(failure, 'Выгрузка больше недоступна.')); if (!summary) await query.refetch(); }
    } finally { exportLock.current = false; if (active.current) setExporting(null); }
  }
  if (isPermissionsCheckFailure(access.error)) return <OpsPermissionsUnavailable onRetry={() => void client.invalidateQueries({ queryKey: ['ops-me'] })} isRetrying={access.isLoading} />;
  if (!access.isLoading && !access.allowed) return <OpsAccessDenied what="журнала дежурств" />;
  const filterKey = dutyRegisterQuery(new URLSearchParams([...search].filter(([key]) => key !== 'page' && key !== 'page_size')));
  return <div className="min-w-0 space-y-5 pb-12">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Журнал и контроль</h2><p className="text-sm text-muted-foreground">План, фактические отметки и история за выбранный период</p></div><div className="flex flex-wrap gap-2">{access.hasPermission('dictionary.view') && <Button asChild variant="outline"><Link href="/security-ops/dictionaries/SERVICE_DUTY_KINDS/">Виды дежурств</Link></Button>}{(access.canCreate || pendingCreation) && <Button disabled={!writable} onClick={() => { setInitialDraft(null); setCreate(true); setNotice(''); }}>{pendingCreation ? 'Проверить предыдущее сохранение' : 'Добавить запись'}</Button>}</div></div>
    {access.isLoading && <p role="status">Проверяем доступ к журналу…</p>}
    {access.allowed && <>
      <DutyRegisterFilters key={access.scope + filterKey} params={search} data={data ?? emptyData(search)} kinds={kinds.visibleData?.results ?? []} busy={busy} onApply={values => filter(values)} />
      {kinds.isError && <p className="text-sm text-muted-foreground">Не удалось обновить виды дежурств. <Button variant="link" size="sm" disabled={kinds.isFetching} onClick={() => void kinds.refetch()}>Повторить виды</Button></p>}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden"><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void refresh()}>Обновить</Button><Button variant="outline" disabled={!data || query.isError || busy} onClick={() => void download()}>{exporting === 'records' ? 'Выгрузка…' : 'Выгрузить CSV'}</Button>{view !== 'records' && <Button variant="outline" disabled={!data || query.isError || busy} onClick={() => void download(true)}>{exporting === 'summary' ? 'Обновляем сводку…' : 'Выгрузить сводку CSV'}</Button>}<Button variant="ghost" disabled={!data || query.isError || busy} onClick={() => window.print()}>Печать</Button></div>{data && <p className="text-xs text-muted-foreground">Обновлено: {dutyDateTime(data.generated_at, data.time_zone)}</p>}</div>
      {(query.isLoading || (query.isFetching && !data)) && <p role="status">Загрузка журнала и показателей…</p>}
      {query.isError && <LoadFailure what="журнал дежурств" onRetry={() => void query.refetch()} isRetrying={query.isFetching} />}
      {query.isError && data && <p role="status" className="rounded-lg border border-amber-300 p-3 text-sm">Показаны ранее загруженные данные. Выгрузка и изменения доступны после успешного обновления.</p>}
      {exportError && <p role="alert" className="text-sm text-destructive">{exportError}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{notice}</p>}
      {data && <>
        <p className="text-sm text-muted-foreground">Период: {data.period.from} — {data.period.to}. Часы обрезаны границами периода. Время: {data.time_zone}.</p>
        <DutyRegisterAppliedFilters params={search} data={data} kinds={kinds.visibleData?.results ?? []} />
        <DutyRegisterSummary data={data} busy={busy || query.isError} onFilter={filter} />
        <div className="flex flex-wrap gap-2 print:hidden" role="group" aria-label="Представление журнала">{[{ value: 'records', label: 'Записи' }, { value: 'kinds', label: 'По видам' }, { value: 'employees', label: 'По сотрудникам' }].map(tab => <Button key={tab.value} variant={view === tab.value ? 'default' : 'outline'} aria-pressed={view === tab.value} disabled={busy} onClick={() => navigate({ view: tab.value, group_page: '' }, false)}>{tab.label}</Button>)}</div>
        <div ref={results} tabIndex={-1} className="min-w-0 scroll-mt-24 outline-none" role="region" aria-label="Результаты журнала">
          {view === 'records' ? <><DutyRegisterRows rows={data.rows} zone={data.time_zone} busy={busy} onOpen={row => navigate({ record: row.id }, false)} />{data.pagination.count > 0 && <nav className="mt-4 flex flex-wrap items-center justify-between gap-3" aria-label="Страницы журнала"><p className="text-sm text-muted-foreground">Показано {(data.pagination.page - 1) * data.pagination.page_size + 1}–{Math.min(data.pagination.page * data.pagination.page_size, data.pagination.count)} из {data.pagination.count}</p>{data.pagination.pages > 1 && <div className="flex items-center gap-2 print:hidden"><Button size="sm" variant="outline" disabled={busy || data.pagination.page <= 1} onClick={() => page(data.pagination.page - 1)}>Назад</Button><span className="text-sm">{data.pagination.page} / {data.pagination.pages}</span><Button size="sm" variant="outline" disabled={busy || data.pagination.page >= data.pagination.pages} onClick={() => page(data.pagination.page + 1)}>Далее</Button></div>}</nav>}</> : <DutyRegisterGroups data={data} view={view} requestedPage={groupPage} onPage={next => navigate({ group_page: String(next) }, false)} onFilter={filter} busy={busy || query.isError} />}
        </div>
        <p className="text-xs text-muted-foreground">Отметки контроля показывают состояние учёта. Отсутствие отметки не означает неявку сотрудника. Отменённые записи сохранены в истории и исключены из часов.</p>
      </>}
      {recordId && !recordValid && <p role="alert" className="text-sm">Адрес записи некорректен. <Button variant="link" onClick={() => navigate({ record: '' }, false)}>Закрыть запись</Button></p>}
      {recordValid && !query.blocked && <DutyRecordDialog key={access.scope + recordId} id={recordId} scope={access.scope} allowed={access.allowed} onClose={() => navigate({ record: '' }, false)} onEdit={row => { navigate({ record: '' }, false); setEditing(row); }} onCopy={access.canCreate && !pendingCreation ? copyRecord : undefined} onSaved={() => setNotice('Отметка сохранена.')} />}
      {(create || editing) && data && !query.blocked && <DutyLogForm key={access.scope + (editing?.id ?? 'new')} actor={access.actor} record={editing ?? undefined} initialDraft={initialDraft ?? undefined} scope={access.scope} allowed={writable && (Boolean(editing) || access.canCreate || pendingCreation)} zone={data.time_zone} defaultDate={data.period.from} onClose={() => { setCreate(false); setInitialDraft(null); setEditing(null); }} onSaved={row => void saved(row)} onSavedUnavailable={() => { setCreate(false); setInitialDraft(null); setNotice('Запись сохранена. Просмотр в текущей области доступа недоступен.'); }} />}
    </>}
  </div>;
}
