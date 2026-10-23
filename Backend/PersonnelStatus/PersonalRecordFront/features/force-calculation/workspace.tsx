"use client";

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { opsApiClient } from '@/lib/ops-api';
import { OpsApiError } from '@/lib/ops-errors';
import { hasCurrentOpsReadAuthority, useOpsReadAccess, type OpsReadAccess } from '@/hooks/use-ops-protected-read';
import { useOpsPermissions } from '@/hooks/use-ops-permissions';
import { formatIsoDate } from '@/shared/lib/date';
import { availableGroups, cloneDocument, completionIssues, POSITION_LABELS, removeRoute, removeRow, segmentRouteCount, selectedRouteId, summarize, VEHICLE_LABELS } from './model';
import type { CalculationDocument, CalculationResponse, Group, Issue, Position, Route, RouteRow, Segment, VehicleType } from './model';
import styles from './workspace.module.css';

const id = () => crypto.randomUUID();
const endpoint = (eventId: string) => `/api/ops/security-events/${encodeURIComponent(eventId)}/resource-calculation/`;
const isoDate = (date: string | null) => date ? formatIsoDate(date) : 'не указана';

function Field({ label, value, onChange, type = 'text', maxLength = 200, min, max }: {
  label: string; value: string; onChange: (value: string) => void; type?: string; maxLength?: number; min?: string; max?: string;
}) {
  return <label className={styles.field}><span>{label}</span><input type={type} value={value} onChange={event => onChange(event.target.value)} maxLength={maxLength} min={min} max={max} /></label>;
}
function Selection({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return <label className={styles.field}><span>{label}</span><select value={value} onChange={event => onChange(event.target.value)}>{children}</select></label>;
}
function Issues({ issues }: { issues: Issue[] }) {
  return issues.length ? <div className={styles.notice}><strong>Для печати и Word осталось заполнить</strong><ul>{issues.map((issue, index) => <li key={`${issue.path}-${index}`}>{issue.message}</li>)}</ul><p>Неполный черновик можно сохранить. JSON доступен для любой сохранённой версии.</p></div> : null;
}

export function ForceCalculationWorkspace({ eventId }: { eventId: string }) {
  const reader = useOpsReadAccess('resource_calculation.view');
  const manager = useOpsReadAccess('resource_calculation.manage');
  const permissions = useOpsPermissions();
  const client = useQueryClient();
  const access = manager.allowed ? manager : reader;
  if (!access.allowed) return <DashboardLayout><section className={styles.workspace} aria-label="Расчёт сил и средств"><h1>Расчёт сил и средств</h1><p role={permissions.isLoading ? 'status' : 'alert'}>{permissions.isLoading ? 'Проверка доступа…' : 'Доступ к расчёту закрыт. Обратитесь к администратору для проверки полномочий и подразделения.'}</p></section></DashboardLayout>;
  return <AuthorizedWorkspace key={`${eventId}:${access.scope}`} eventId={eventId} access={access} client={client} />;
}

function AuthorizedWorkspace({ eventId, access, client }: { eventId: string; access: OpsReadAccess; client: QueryClient }) {
  const [saved, setSaved] = useState<CalculationResponse | null>(null);
  const [draft, setDraft] = useState<CalculationDocument | null>(null);
  const [owner, setOwner] = useState('');
  const [activeRoute, setActiveRoute] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [reloadDialog, setReloadDialog] = useState(false);
  const [printSnapshot, setPrintSnapshot] = useState<CalculationResponse | null>(null);
  const [groupSearch, setGroupSearch] = useState('');
  const [segmentSearch, setSegmentSearch] = useState('');
  const [status, setStatus] = useState('');
  const [pickerFor, setPickerFor] = useState('');
  const [recentSegments, setRecentSegments] = useState<string[]>([]);
  const generation = useRef(0);
  const mounted = useRef(true);
  const current = (request: number) => mounted.current && request === generation.current && hasCurrentOpsReadAuthority(client, access);

  function handleFailure(failure: unknown) {
    if (failure instanceof OpsApiError && [401, 403, 404].includes(failure.status)) {
      generation.current += 1;
      setSaved(null); setDraft(null); setPrintSnapshot(null); setDenied(true); setConflict(false);
      setPickerFor(''); setRecentSegments([]); setBusy(false); setLoading(false);
      setError('Доступ к расчёту закрыт. Обратитесь к администратору для проверки полномочий и подразделения.');
      return;
    }
    if (failure instanceof OpsApiError && failure.status === 409) {
      setConflict(true);
      setError(`${failure.message || 'Не удалось сохранить расчёт из-за изменения его состояния.'} Ваш черновик сохранён на экране.`);
      return;
    }
    const message = failure instanceof OpsApiError && failure.status < 500 ? failure.message : 'Не удалось связаться с сервером. Повторите действие — введённые данные остаются на экране.';
    setError(message || 'Не удалось выполнить действие. Введённые данные остаются на экране.');
  }

  async function load() {
    const request = ++generation.current;
    setLoading(true); setError(''); setStatus('');
    try {
      const response = await opsApiClient.get<CalculationResponse>(endpoint(eventId), () => {
        if (!hasCurrentOpsReadAuthority(client, access)) throw new Error('Полномочия изменились.');
      });
      if (!current(request)) return;
      setSaved(response); setDraft(null); setDenied(false); setConflict(false);
      setOwner(response.ownerDivisionId ? String(response.ownerDivisionId) : response.ownerChoices.length === 1 ? String(response.ownerChoices[0].id) : '');
    } catch (failure) { if (current(request)) handleFailure(failure); }
    finally { if (current(request)) setLoading(false); }
  }

  useEffect(() => {
    mounted.current = true;
    setSaved(null); setDraft(null); setDenied(false); setPrintSnapshot(null);
    void load();
    return () => { mounted.current = false; generation.current += 1; };
    // A route change must reset all protected local state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  useEffect(() => {
    if (!draft) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [draft]);

  useEffect(() => {
    if (!printSnapshot) return;
    const after = () => setPrintSnapshot(null);
    window.addEventListener('afterprint', after);
    const timer = window.setTimeout(() => window.print(), 80);
    return () => { window.clearTimeout(timer); window.removeEventListener('afterprint', after); };
  }, [printSnapshot]);

  function edit() {
    if (!saved?.canManage || saved.event.stage === 'CLOSED') return;
    setDraft(cloneDocument(saved.document)); setError(''); setStatus('');
  }
  function update(change: (document: CalculationDocument) => void) {
    setDraft(current => { if (!current) return current; const next = cloneDocument(current); change(next); return next; });
  }
  function changeRoute(routeId: string, change: Partial<Route>) {
    update(document => { const route = document.routes.find(route => route.id === routeId); if (route) Object.assign(route, change); });
  }
  function changeRow(routeId: string, rowId: string, change: Partial<RouteRow>) {
    update(document => {
      const row = document.routes.find(route => route.id === routeId)?.rows.find(row => row.id === rowId);
      if (row) Object.assign(row, change);
    });
  }
  async function save() {
    if (!draft || !saved || busy || !saved.canManage || saved.event.stage === 'CLOSED' || !hasCurrentOpsReadAuthority(client, access)) return;
    if (!saved.exists && !owner) { setError('Выберите подразделение — владельца расчёта.'); return; }
    const request = generation.current;
    setBusy(true); setError(''); setStatus('');
    try {
      const response = await opsApiClient.put<CalculationResponse>(endpoint(eventId), {
        expectedVersion: saved.version, ...(!saved.exists ? { ownerDivisionId: Number(owner) } : {}), document: draft,
      });
      if (!current(request)) return;
      setSaved(response); setDraft(null); setConflict(false); setStatus('Расчёт сохранён.');
    } catch (failure) { if (current(request)) handleFailure(failure); }
    finally { if (current(request)) setBusy(false); }
  }
  async function exportSaved(format: 'docx' | 'json' | 'print') {
    if (!saved?.exists || draft || busy || !hasCurrentOpsReadAuthority(client, access)) return;
    const request = generation.current;
    setBusy(true); setError(''); setStatus('');
    try {
      if (format === 'print') {
        // Authorize again before displaying a retained snapshot for printing.
        const fresh = await opsApiClient.get<CalculationResponse>(endpoint(eventId));
        if (!current(request)) return;
        setSaved(fresh);
        if (!fresh.exists || fresh.issues.length || completionIssues(fresh.document).length) {
          setError('Заполните маршруты и назначения, сохраните расчёт и повторите печать.'); return;
        }
        setPrintSnapshot(fresh);
      } else {
        const download = await opsApiClient.download(`${endpoint(eventId)}export/?format=${format}`);
        if (!current(request)) return;
        const url = URL.createObjectURL(download.blob);
        const anchor = window.document.createElement('a');
        anchor.href = url; anchor.download = download.filename ?? `resource-calculation-${eventId}.${format}`;
        window.document.body.appendChild(anchor); anchor.click(); anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (failure) { if (current(request)) handleFailure(failure); }
    finally { if (current(request)) setBusy(false); }
  }

  const document = draft ?? saved?.document;
  const selected = document ? selectedRouteId(document, activeRoute) : '';
  const route = document?.routes.find(route => route.id === selected);
  const editing = draft !== null;
  const canEdit = saved?.canManage && saved.event.stage !== 'CLOSED';
  const savedIssues = saved ? [...saved.issues, ...completionIssues(saved.document)] : [];

  return <DashboardLayout><section className={styles.workspace} aria-label="Расчёт сил и средств">
    <div className={styles.screen}>
      <Link className={styles.back} href={`/security-ops/events/${encodeURIComponent(eventId)}`} onClick={event => {
        if (draft && !window.confirm('Изменения не сохранены. Выйти из расчёта?')) event.preventDefault();
      }}>← К мероприятию</Link>
      <header className={styles.header}><div><p className={styles.eyebrow}>Планирование</p><h1>Расчёт сил и средств</h1>
        {saved && <><h2>{saved.event.title}</h2><p>{isoDate(saved.event.dateFrom)}{saved.event.dateTo ? ` — ${isoDate(saved.event.dateTo)}` : ' · дата окончания не указана'}</p></>}
      </div>{saved?.exists && <div className={styles.version}>Версия {saved.version}<br />{saved.ownerDivisionName}{saved.updatedAt && <><br />Сохранено: {new Date(saved.updatedAt).toLocaleString('ru-RU')}</>}</div>}</header>
      {loading && <p role="status" className={styles.panel}>Загрузка расчёта…</p>}
      {error && <div role="alert" className={styles.error}><p>{error}</p>{conflict && <Button variant="outline" onClick={() => setReloadDialog(true)} disabled={busy}>Загрузить сохранённую версию</Button>}{!saved && !denied && <Button variant="outline" onClick={() => void load()}>Повторить загрузку</Button>}</div>}
      {status && <p role="status" className={styles.success}>{status}</p>}
      {!loading && saved && document && <>
        {saved.event.stage === 'CLOSED' && <p className={styles.notice}>Мероприятие закрыто. Расчёт доступен для чтения и выгрузки.</p>}
        {saved.snapshot && (saved.snapshot.title !== saved.event.title || saved.snapshot.dateFrom !== saved.event.dateFrom || saved.snapshot.dateTo !== saved.event.dateTo) && <p className={styles.notice}>Сведения мероприятия изменились. Печать и выгрузки используют название и даты из сохранённой версии расчёта: {saved.snapshot.title}, {isoDate(saved.snapshot.dateFrom)}{saved.snapshot.dateTo ? ` — ${isoDate(saved.snapshot.dateTo)}` : ' · дата окончания не указана'}.</p>}
        {!canEdit && saved.event.stage !== 'CLOSED' && <p className={styles.notice}>Расчёт доступен только для чтения.</p>}
        {!saved.exists && !editing ? <section className={`${styles.panel} ${styles.empty}`}><h2>Расчёт ещё не создан</h2><p>Добавьте маршруты, участки и плановые группы. Назначения сотрудников и транспорта ведутся отдельно.</p>{canEdit && <Button onClick={edit}>Создать расчёт</Button>}</section> : <>
          <div className={styles.toolbar}>{editing ? <><Button onClick={() => void save()} disabled={busy || conflict}>{busy ? 'Сохранение…' : 'Сохранить'}</Button><Button variant="outline" disabled={busy} onClick={() => { setDraft(null); setError(''); setConflict(false); setStatus('Изменения отменены.'); }}>Отмена</Button><span>Единый черновик маршрутов, групп и участков</span></> : canEdit && <Button onClick={edit} disabled={busy}>Редактировать</Button>}
            <div className={styles.exports}><Button variant="outline" disabled={editing || busy || !saved.exists || savedIssues.length > 0} onClick={() => void exportSaved('print')}>Печать</Button><Button variant="outline" disabled={editing || busy || !saved.exists || savedIssues.length > 0} onClick={() => void exportSaved('docx')}>Word</Button><Button variant="outline" disabled={editing || busy || !saved.exists} onClick={() => void exportSaved('json')}>JSON</Button></div>
          </div>
          {editing && <p className={styles.hint}>Для печати и выгрузки сначала сохраните изменения или нажмите «Отмена».</p>}
          {editing && !saved.exists && <section className={styles.panel}><Selection label="Подразделение — владелец расчёта" value={owner} onChange={setOwner}><option value="">Выберите подразделение</option>{saved.ownerChoices.map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}</Selection><p className={styles.hint}>После сохранения владелец не меняется.</p></section>}
          <Catalogs document={document} editing={editing} busy={busy} groupSearch={groupSearch} setGroupSearch={setGroupSearch} segmentSearch={segmentSearch} setSegmentSearch={setSegmentSearch} update={update} />
          <section className={styles.panel} aria-label="Маршруты"><div className={styles.sectionHeader}><h2>Маршруты <span>{document.routes.length}</span></h2>{editing && <Button variant="outline" disabled={busy || document.routes.length >= 50} onClick={() => {
            const routeId = id(); update(document => document.routes.push({ id: routeId, name: '', start: '', end: '', date: '', time: '', rows: [] })); setActiveRoute(routeId);
          }}>Добавить маршрут</Button>}</div>
            {!document.routes.length ? <p className={styles.hint}>{editing ? 'Добавьте первый маршрут. Группы и участки можно заполнить в справочниках выше.' : 'В сохранённом черновике пока нет маршрутов.'}</p> : <>
              <label className={styles.field}><span>Выбранный маршрут</span><select value={selected} onChange={event => setActiveRoute(event.target.value)}>{document.routes.map((item, index) => <option value={item.id} key={item.id}>{item.name || `Маршрут ${index + 1}`}</option>)}</select></label>
              {route && <div className={styles.route}>
                {editing ? <fieldset disabled={busy} className={styles.fields}><Field label="Название маршрута" value={route.name} onChange={name => changeRoute(route.id, { name })} /><Field label="Начало маршрута" value={route.start} onChange={start => changeRoute(route.id, { start })} /><Field label="Конец маршрута" value={route.end} onChange={end => changeRoute(route.id, { end })} /><Field label="Дата маршрута" type="date" value={route.date} min={saved.event.dateFrom} max={saved.event.dateTo ?? saved.event.dateFrom} onChange={date => changeRoute(route.id, { date })} /><Field label="Время маршрута" type="time" value={route.time} onChange={time => changeRoute(route.id, { time })} /></fieldset> : <div className={styles.routeContext}><h3>{route.name || 'Маршрут без названия'}</h3><p>{route.start || 'Начало не указано'} → {route.end || 'Конец не указан'} · {isoDate(route.date)} {route.time}</p></div>}
                <div className={styles.rows}>{route.rows.map((row, index) => {
                  const segment = document.segments.find(segment => segment.id === row.segmentId);
                  const shared = segmentRouteCount(document, row.segmentId);
                  const group = document.groups.find(group => group.id === document.assignments[row.segmentId]);
                  return <article className={styles.row} key={row.id} aria-label={`Участок маршрута ${index + 1}`}><div className={styles.sectionHeader}><h3>{index + 1}. {segment?.name ?? 'Участок не выбран'}</h3>{editing && <Button variant="ghost" disabled={busy} aria-label={`Удалить строку ${index + 1}`} onClick={() => setDraft(current => current ? removeRow(current, route.id, row.id) : current)}>Удалить строку</Button>}</div>
                    {shared > 1 && <p className={styles.shared}>Общий участок · маршрутов: {shared}. Группа меняется во всех этих маршрутах.</p>}
                    <p>{row.reversed ? segment?.pointB : segment?.pointA} → {row.reversed ? segment?.pointA : segment?.pointB}</p>
                    {editing ? <fieldset disabled={busy} className={styles.fields}><Selection label={`Участок маршрута ${index + 1}`} value={row.segmentId} onChange={segmentId => {
                      update(document => { const target = document.routes.find(item => item.id === route.id)?.rows.find(item => item.id === row.id); if (!target) return; const previous = target.segmentId; target.segmentId = segmentId; if (!document.routes.some(item => item.rows.some(item => item.segmentId === previous))) delete document.assignments[previous]; });
                    }}><option value="">Выберите участок</option>{document.segments.filter(item => item.id === row.segmentId || !route.rows.some(row => row.segmentId === item.id)).map(item => <option key={item.id} value={item.id}>{item.name || 'Участок без названия'}</option>)}</Selection>
                      <Selection label={`Группа участка ${index + 1}`} value={document.assignments[row.segmentId] ?? ''} onChange={groupId => update(document => { if (!row.segmentId) return; if (groupId) document.assignments[row.segmentId] = groupId; else delete document.assignments[row.segmentId]; })}><option value="">Без назначения</option>{availableGroups(document, row.segmentId).map(group => <option key={group.id} value={group.id}>{group.callsign || 'Без позывного'} · {group.organization}</option>)}</Selection>
                      <Selection label={`Положение ${index + 1}`} value={row.position} onChange={position => changeRow(route.id, row.id, { position: position as Position })}>{Object.entries(POSITION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Selection>
                      <label className={styles.checkbox}><input type="checkbox" checked={row.reversed} onChange={event => changeRow(route.id, row.id, { reversed: event.target.checked })} />Обратное направление {index + 1}</label>
                      <label className={`${styles.field} ${styles.wide}`}><span>Примечание {index + 1}</span><textarea maxLength={1000} value={row.note} onChange={event => changeRow(route.id, row.id, { note: event.target.value })} /></label>
                    </fieldset> : <><p><strong>{group ? `${group.callsign} · ${group.organization}` : 'Группа не назначена'}</strong>{group && ` · ${group.vehicle} (${VEHICLE_LABELS[group.vehicleType]})`}</p><p>{POSITION_LABELS[row.position]}{row.note && ` · ${row.note}`}</p></>}
                  </article>;
                })}</div>
                {editing && <div className={styles.routeActions}><Button variant="outline" disabled={busy || document.routes.reduce((sum, route) => sum + route.rows.length, 0) >= 500} onClick={() => setPickerFor(route.id)}>Добавить участок</Button><Button variant="ghost" disabled={busy} onClick={() => setDraft(current => current ? removeRoute(current, route.id) : current)}>Удалить маршрут</Button></div>}
                {editing && !document.segments.length && <p className={styles.hint}>Нажмите «Добавить участок», чтобы создать его, или заполните справочник «Участки» выше.</p>}
                {document.routes.length > 1 && <Summary document={document} routeId={route.id} compact />}
              </div>}
            </>}
          </section>
          <Summary document={document} />
          <Issues issues={editing ? completionIssues(document) : savedIssues.filter((issue, index, issues) => issues.findIndex(item => item.message === issue.message) === index)} />
        </>}
      </>}
      <Dialog open={reloadDialog} onOpenChange={setReloadDialog}><DialogContent><DialogHeader><DialogTitle>Загрузить сохранённую версию?</DialogTitle><DialogDescription>Текущий черновик будет заменён данными с сервера, включая изменения групп и участков.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setReloadDialog(false)}>Оставить черновик</Button><Button onClick={() => { setReloadDialog(false); void load(); }}>Заменить черновик</Button></DialogFooter></DialogContent></Dialog>
      {document && <SegmentPicker key={pickerFor} open={!!pickerFor} document={document} recent={recentSegments} routeId={pickerFor} onClose={() => setPickerFor('')} onChoose={(segmentId, created) => {
        update(document => {
          const target = document.routes.find(route => route.id === pickerFor);
          if (!target || target.rows.some(row => row.segmentId === segmentId)) return;
          if (created) document.segments.push(created);
          target.rows.push({ id: id(), segmentId, reversed: false, position: 'RIGHT', note: '' });
        });
        setRecentSegments(previous => [segmentId, ...previous.filter(item => item !== segmentId)].slice(0, 5)); setPickerFor('');
      }} />}
    </div>
    {printSnapshot && <PrintView saved={printSnapshot} />}
  </section></DashboardLayout>;
}

function Catalogs({ document, editing, busy, groupSearch, setGroupSearch, segmentSearch, setSegmentSearch, update }: {
  document: CalculationDocument; editing: boolean; busy: boolean; groupSearch: string; setGroupSearch: (value: string) => void;
  segmentSearch: string; setSegmentSearch: (value: string) => void; update: (change: (document: CalculationDocument) => void) => void;
}) {
  const groupField = (groupId: string, change: Partial<Group>) => update(document => { const group = document.groups.find(group => group.id === groupId); if (group) Object.assign(group, change); });
  const segmentField = (segmentId: string, change: Partial<Segment>) => update(document => { const segment = document.segments.find(segment => segment.id === segmentId); if (segment) Object.assign(segment, change); });
  return <div className={styles.catalogs}>
    <details className={styles.panel}><summary>Группы ({document.groups.length})</summary><div className={styles.catalogBody}>
      <p className={styles.hint}>Одна группа — одна единица техники. Численность сотрудников здесь не рассчитывается.</p>
      {document.groups.length > 0 && <Field label="Поиск групп" value={groupSearch} onChange={setGroupSearch} />}
      {document.groups.map((group, index) => <div key={group.id} hidden={!!groupSearch && !`${group.callsign} ${group.organization} ${group.vehicle}`.toLocaleLowerCase().includes(groupSearch.toLocaleLowerCase())} className={styles.catalogItem}>
        {editing ? <fieldset disabled={busy} className={styles.fields}><Field label={`Организация ${index + 1}`} value={group.organization} onChange={organization => groupField(group.id, { organization })} /><Field label={`Позывной ${index + 1}`} value={group.callsign} onChange={callsign => groupField(group.id, { callsign })} /><Field label={`Техника ${index + 1}`} value={group.vehicle} onChange={vehicle => groupField(group.id, { vehicle })} /><Selection label={`Категория техники ${index + 1}`} value={group.vehicleType} onChange={vehicleType => groupField(group.id, { vehicleType: vehicleType as VehicleType })}>{Object.entries(VEHICLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Selection>
          <div><Button variant="ghost" disabled={Object.values(document.assignments).includes(group.id)} onClick={() => update(document => { document.groups = document.groups.filter(item => item.id !== group.id); })} aria-label={`Удалить группу ${index + 1}`}>Удалить группу</Button>{Object.values(document.assignments).includes(group.id) && <p className={styles.hint}>Сначала снимите назначение с участка.</p>}</div>
        </fieldset> : <p><strong>{group.callsign || 'Без позывного'}</strong> · {group.organization} · {group.vehicle} · {VEHICLE_LABELS[group.vehicleType]}</p>}
      </div>)}
      {!document.groups.length && <p className={styles.hint}>Групп пока нет.</p>}
      {editing && <Button variant="outline" disabled={busy || document.groups.length >= 200} onClick={() => { setGroupSearch(''); update(document => document.groups.push({ id: id(), callsign: '', organization: '', vehicle: '', vehicleType: 'PASSENGER' })); }}>Добавить группу</Button>}
    </div></details>
    <details className={styles.panel}><summary>Участки ({document.segments.length})</summary><div className={styles.catalogBody}>
      <p className={styles.hint}>Физический участок можно использовать в нескольких маршрутах. Его группа будет общей.</p>
      {document.segments.length > 0 && <Field label="Поиск участков" value={segmentSearch} onChange={setSegmentSearch} />}
      {document.segments.map((segment, index) => {
        const uses = segmentRouteCount(document, segment.id);
        return <div key={segment.id} hidden={!!segmentSearch && !`${segment.name} ${segment.type} ${segment.tags}`.toLocaleLowerCase().includes(segmentSearch.toLocaleLowerCase())} className={styles.catalogItem}>
          {editing ? <fieldset disabled={busy} className={styles.fields}><Field label={`Название участка ${index + 1}`} value={segment.name} onChange={name => segmentField(segment.id, { name })} /><Field label={`Тип участка ${index + 1}`} value={segment.type} onChange={type => segmentField(segment.id, { type })} /><Field label={`Теги участка ${index + 1}`} value={segment.tags} onChange={tags => segmentField(segment.id, { tags })} /><Field label={`Точка А ${index + 1}`} value={segment.pointA} onChange={pointA => segmentField(segment.id, { pointA })} /><Field label={`Точка Б ${index + 1}`} value={segment.pointB} onChange={pointB => segmentField(segment.id, { pointB })} /><div><Button variant="ghost" disabled={uses > 0} onClick={() => update(document => { document.segments = document.segments.filter(item => item.id !== segment.id); })} aria-label={`Удалить участок ${index + 1}`}>Удалить участок</Button>{uses > 0 && <p className={styles.hint}>Используется в маршрутах: {uses}. Сначала удалите строки маршрутов.</p>}</div></fieldset> : <p><strong>{segment.name || 'Без названия'}</strong> · {segment.pointA} → {segment.pointB}{segment.type && ` · ${segment.type}`}{segment.tags && ` · ${segment.tags}`} · маршрутов: {uses}</p>}
        </div>;
      })}
      {!document.segments.length && <p className={styles.hint}>Участков пока нет.</p>}
      {editing && <Button variant="outline" disabled={busy || document.segments.length >= 500} onClick={() => { setSegmentSearch(''); update(document => document.segments.push({ id: id(), name: '', type: '', tags: '', pointA: '', pointB: '' })); }}>Создать участок</Button>}
    </div></details>
  </div>;
}

function SegmentPicker({ open, document, routeId, recent, onClose, onChoose }: {
  open: boolean; document: CalculationDocument; routeId: string; recent: string[];
  onClose: () => void; onChoose: (segmentId: string, created?: Segment) => void;
}) {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<Omit<Segment, 'id'>>({ name: '', type: '', tags: '', pointA: '', pointB: '' });
  const used = new Set(document.routes.find(route => route.id === routeId)?.rows.map(row => row.segmentId) ?? []);
  const choices = document.segments.filter(segment => !used.has(segment.id));
  const types = [...new Set(choices.map(segment => segment.type).filter(Boolean))].sort();
  const visible = choices.filter(segment => (!type || segment.type === type) && `${segment.name} ${segment.type} ${segment.tags} ${segment.pointA} ${segment.pointB}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  function choice(segment: Segment) {
    const group = document.groups.find(group => group.id === document.assignments[segment.id]);
    const count = segmentRouteCount(document, segment.id);
    return <button type="button" className={styles.pickerChoice} key={segment.id} onClick={() => onChoose(segment.id)}><strong>{segment.name || 'Без названия'}</strong><span>{segment.pointA} → {segment.pointB} · {segment.type || 'Тип не указан'}</span><span>{count > 0 ? `В маршрутах: ${count}. ` : ''}{group ? `Группа: ${group.callsign} · ${group.organization}` : 'Группа не назначена'}</span></button>;
  }
  return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}><DialogContent className={styles.picker}><DialogHeader><DialogTitle>Выбрать участок</DialogTitle><DialogDescription>Выберите физический участок. Его назначенная группа будет общей для всех маршрутов.</DialogDescription></DialogHeader>
    {creating ? <><div className={styles.fields}>{(['name', 'type', 'tags', 'pointA', 'pointB'] as const).map((key, index) => <Field key={key} label={['Название нового участка', 'Тип нового участка', 'Теги нового участка', 'Точка А нового участка', 'Точка Б нового участка'][index]} value={created[key]} onChange={value => setCreated(previous => ({ ...previous, [key]: value }))} />)}</div><DialogFooter><Button variant="outline" onClick={() => setCreating(false)}>К выбору участка</Button><Button disabled={!created.name.trim() || document.segments.some(segment => segment.name.trim().toLocaleLowerCase() === created.name.trim().toLocaleLowerCase())} onClick={() => { const segment = { ...created, id: id() }; onChoose(segment.id, segment); }}>Создать и добавить</Button></DialogFooter></> : <>
      {choices.length > 0 && <div className={styles.fields}><Field label="Поиск участка для маршрута" value={search} onChange={setSearch} /><Selection label="Фильтр по типу участка" value={type} onChange={setType}><option value="">Все типы</option>{types.map(type => <option key={type} value={type}>{type}</option>)}</Selection></div>}
      {!search && !type && recent.some(segmentId => choices.some(segment => segment.id === segmentId)) && <section aria-label="Недавние участки"><h3>Недавние</h3><div className={styles.pickerChoices}>{recent.map(segmentId => choices.find(segment => segment.id === segmentId)).filter((segment): segment is Segment => !!segment).map(choice)}</div></section>}
      <section aria-label="Участки для добавления"><div className={styles.pickerChoices}>{visible.map(choice)}</div>{!visible.length && <p className={styles.hint}>{choices.length ? 'Участки по выбранным условиям не найдены.' : 'Все участки уже добавлены или справочник пуст.'}</p>}</section>
      <DialogFooter><Button variant="outline" onClick={onClose}>Закрыть</Button><Button disabled={document.segments.length >= 500} onClick={() => setCreating(true)}>Создать новый участок</Button></DialogFooter>
    </>}
  </DialogContent></Dialog>;
}

function Summary({ document, routeId, compact = false, expanded = false }: { document: CalculationDocument; routeId?: string; compact?: boolean; expanded?: boolean }) {
  const summary = summarize(document, routeId);
  return <section className={compact ? styles.routeSummary : styles.panel} aria-label={compact ? 'Сводка выбранного маршрута' : 'Сводка'}><h2>{compact ? 'Свод по маршруту' : 'Сводка'}</h2>
    {!compact && <p className={styles.hint}>Групп в справочнике: {summary.catalogGroups} · назначено: {summary.groups} · в резерве: {summary.reserveGroups}</p>}
    {(compact || document.routes.length === 1) && <p className={styles.hint}>Участков: {summary.segments} · с группой: {summary.assignedSegments} · без группы: {summary.unassignedSegments}{compact && ` · общих с другими маршрутами: ${summary.sharedSegments}`}</p>}
    <p className={styles.summaryTotal}>Назначено групп: <strong>{summary.groups}</strong> · единиц техники: <strong>{summary.vehicles}</strong></p>{!compact && <p className={styles.hint}>Повторения общих участков в маршрутах не увеличивают итог.</p>}
    <details className={styles.breakdown} open={expanded}><summary>По организациям и технике</summary><div className={styles.summaryGrid}><div><h3>По организациям</h3>{summary.organizations.length ? <ul>{summary.organizations.map(item => <li key={item.name}>{item.name || 'Не указана'}: {item.count}</li>)}</ul> : <p>Назначений пока нет.</p>}</div><div><h3>По категориям техники</h3><ul>{Object.entries(summary.categories).map(([category, count]) => <li key={category}>{VEHICLE_LABELS[category as VehicleType]}: {count}</li>)}</ul></div></div>
    {summary.organizationVehicles.length > 0 && <ul className={styles.vehicleBreakdown}>{summary.organizationVehicles.map(item => <li key={JSON.stringify([item.organization, item.vehicle, item.vehicleType])}>{item.organization || 'Организация не указана'} · {item.vehicle || 'Техника не указана'} ({VEHICLE_LABELS[item.vehicleType]}): {item.count}</li>)}</ul>}</details>
  </section>;
}

function PrintView({ saved }: { saved: CalculationResponse }) {
  const snapshot = saved.snapshot ?? saved.event;
  return <section className={styles.printArea} data-force-print><h1>Расчёт сил и средств</h1><h2>{snapshot.title}</h2><p>{isoDate(snapshot.dateFrom)}{snapshot.dateTo ? ` — ${isoDate(snapshot.dateTo)}` : ' · дата окончания не указана'}</p><p>{saved.ownerDivisionName} · версия {saved.version} · сохранено {saved.updatedAt ? new Date(saved.updatedAt).toLocaleString('ru-RU') : '—'}</p>
    {saved.document.routes.map(route => <section key={route.id}><h2>{route.name}</h2><p>{route.start} → {route.end} · {isoDate(route.date)} {route.time}</p><table><thead><tr><th>№</th><th>Участок / направление</th><th>Группа / организация</th><th>Техника</th><th>Положение / примечание</th></tr></thead><tbody>{route.rows.map((row, index) => {
      const segment = saved.document.segments.find(segment => segment.id === row.segmentId);
      const group = saved.document.groups.find(group => group.id === saved.document.assignments[row.segmentId]);
      return <tr key={row.id}><td>{index + 1}</td><td>{segment?.name}<br />{row.reversed ? segment?.pointB : segment?.pointA} → {row.reversed ? segment?.pointA : segment?.pointB}</td><td>{group?.callsign}<br />{group?.organization}</td><td>{group?.vehicle}<br />{group && VEHICLE_LABELS[group.vehicleType]}</td><td>{POSITION_LABELS[row.position]}<br />{row.note}</td></tr>;
    })}</tbody></table></section>)}
    <Summary document={saved.document} expanded />
  </section>;
}
