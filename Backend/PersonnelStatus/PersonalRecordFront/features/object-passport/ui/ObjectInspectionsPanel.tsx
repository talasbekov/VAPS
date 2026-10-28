'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOpsPermissions } from '@/hooks/use-ops-permissions';
import { opsApiClient } from '@/lib/ops-api';
import { browserUuid } from '@/lib/browser-uuid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadFailure } from '@/components/load-failure';
import { formatIsoDate, formatIsoDateTime } from '@/shared/lib/date';
import { inspectionDraft, inspectionCompletionIssue, type InspectionDraft, type InspectionItemDraft,
  type ObjectInspection, type InspectionList, type InspectionUser } from '../model/inspections';

const BASE = '/api/ops/object-inspections/';
const selectStyle = 'min-h-11 w-full rounded-md border bg-background px-3 text-sm';
const answerLabels = { yes: 'Да', no: 'Нет — есть замечание', na: 'Не применимо', '': 'Ответ не указан' };
function errorStatus(error: unknown) { return typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0; }

export function ObjectInspectionsPanel({objectId, active}: {objectId: string; active: boolean}) {
  const access = useOpsPermissions();
  const {data: session} = useSession();
  if (access.isLoading) return <p role="status">Проверяем доступ к обследованиям…</p>;
  if (access.error) return <p role="alert">Не удалось проверить права. Повторите проверку доступа.</p>;
  if (!access.hasGlobalPermission('object.view')) return <p className="rounded-lg border p-4">
    Для обследований нужен доступ к объектам без ограничения департаментом. Обратитесь к администратору:
    у объектов пока нет подразделения-владельца, по которому можно ограничить обследования.
  </p>;
  const scope = JSON.stringify([session?.user, [...(access.globalPermissions ?? [])].sort(), access.roles]);
  return <InspectionWorkspace key={objectId + scope} objectId={objectId} active={active} scope={scope}
    allowedWrite={access.hasGlobalPermission('object.manage')} />;
}

function InspectionWorkspace({objectId, active, scope, allowedWrite}: {objectId: string; active: boolean; scope: string; allowedWrite: boolean}) {
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const key = ['object-inspections', scope, objectId, page];
  const query = useQuery<InspectionList>({queryKey: key, enabled: active,
    queryFn: () => opsApiClient.get(BASE + '?objectId=' + encodeURIComponent(objectId) + '&page=' + page)});
  const [editor, setEditor] = useState<{row: ObjectInspection | null; draft: InspectionDraft; requestKey: string} | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retryable, setRetryable] = useState(false);
  const [writeDenied, setWriteDenied] = useState(false);
  const pending = useRef<null | (() => Promise<ObjectInspection>)>(null);
  const mountedContext = useRef(true);
  useEffect(() => { mountedContext.current = true; return () => { mountedContext.current = false; }; }, []);
  // A remounted permission/actor context cannot display the prior context's result.
  const canManage = allowedWrite && query.data?.canManage === true && !writeDenied && !query.isError && !query.isFetching;
  const frozen = busy || retryable || !canManage;

  async function perform(action: () => Promise<ObjectInspection>) {
    if (busy || !canManage) return;
    pending.current = action; setBusy(true); setError(''); setNotice('');
    try {
      const saved = await action();
      if (!mountedContext.current) return;
      setEditor(null); pending.current = null; setRetryable(false);
      setNotice(saved.state === 'completed' ? 'Обследование сохранено. Незакрытые замечания остаются в работе.' : 'Черновик обследования сохранён.');
      await client.invalidateQueries({queryKey: ['object-inspections', scope, objectId]});
    } catch (failure) {
      if (!mountedContext.current) return;
      const status = errorStatus(failure);
      if (status === 401 || status === 403 || status === 404) {
        setWriteDenied(true); setEditor(null); pending.current = null; setRetryable(false);
        await client.invalidateQueries({queryKey: ['object-inspections', scope, objectId]});
      } else if (status === 409 || status === 400) {
        pending.current = null; setRetryable(false);
        if (status === 409) await client.invalidateQueries({queryKey: ['object-inspections', scope, objectId]});
      } else {
        setRetryable(true);
      }
      setError(failure instanceof Error ? failure.message : 'Не удалось сохранить обследование.');
    } finally { if (mountedContext.current) setBusy(false); }
  }

  function start(row: ObjectInspection | null) {
    if (!query.data || !canManage) return;
    setError(''); setNotice('');
    setEditor({row, requestKey: browserUuid(), draft: row ? inspectionDraft(row) : {inspectedOn: query.data.today, items: []}});
  }
  function cancel() {
    if (busy || retryable) return;
    if (editor && !window.confirm('Отменить несохранённые изменения обследования?')) return;
    setEditor(null); setError('');
  }
  function save() {
    if (!editor || frozen) return;
    const {row, draft, requestKey} = editor;
    void perform(() => row ? opsApiClient.patch<ObjectInspection>(BASE + row.id + '/', {...draft, revision: row.revision})
      : opsApiClient.post<ObjectInspection>(BASE, {objectId, requestKey, ...draft}));
  }

  if (!active && !query.data) return null;
  if (query.isLoading) return <p role="status">Загружаем обследования…</p>;
  if (query.isError) return <LoadFailure what="обследования объекта" onRetry={() => void query.refetch()} isRetrying={query.isFetching} />;
  if (!query.data) return null;
  return <section className="space-y-4" aria-label="Обследования объекта">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Обследования объекта</h2><p className="text-sm text-muted-foreground">
        Дата, результаты проверки и устранение замечаний. Публикация паспорта не заменяет обследование.
      </p></div>
      {!editor && canManage && <Button onClick={() => start(null)} disabled={busy || retryable}>Начать обследование</Button>}
    </div>
    {error && <div role="alert" className="rounded-lg border border-destructive p-3 text-sm">{error}
      {!editor && !retryable && <Button className="ml-2" variant="outline" disabled={busy || query.isFetching} onClick={() => void query.refetch()}>Обновить обследования</Button>}
      {retryable && <div className="mt-2"><p>Результат записи пока не подтверждён. Повтор использует прежний запрос.</p>
        <Button variant="outline" disabled={busy} onClick={() => { if (pending.current) void perform(pending.current); }}>Повторить сохранение</Button></div>}
    </div>}
    {notice && <p role="status" className="rounded-lg border p-3 text-sm">{notice}</p>}
    {writeDenied && <p role="alert">Право изменения больше недоступно. Обновите страницу после проверки прав.</p>}
    {editor ? <div className="rounded-lg border p-4">
      <InspectionEditor draft={editor.draft} onChange={draft => setEditor({...editor, draft})} frozen={frozen}
        today={query.data.today} currentUser={query.data.currentUser} scope={scope} />
      <div className="mt-4 flex flex-wrap gap-2"><Button disabled={frozen} onClick={save}>{busy ? 'Сохраняем…' : 'Сохранить черновик'}</Button>
        <Button variant="outline" disabled={busy || retryable} onClick={cancel}>Отмена</Button></div>
      {editor.row && <p className="mt-2 text-xs text-muted-foreground">Если запись изменил другой сотрудник, сохранение будет остановлено. Ваш ввод останется на экране.</p>}
      {editor.row && error && !retryable && <Button variant="outline" className="mt-2" disabled={busy} onClick={async () => {
        if (!editor.row || !window.confirm('Заменить несохранённый ввод последней сохранённой версией?')) return;
        setBusy(true);
        try {
          const latest = await opsApiClient.get<ObjectInspection>(BASE + editor.row.id + '/');
          if (!mountedContext.current) return;
          if (latest.state === 'completed') { setEditor(null); await query.refetch(); }
          else setEditor({...editor, row: latest, draft: inspectionDraft(latest)});
          setError('');
        } catch (failure) { if (mountedContext.current) setError(failure instanceof Error ? failure.message : 'Не удалось загрузить версию.'); }
        finally { if (mountedContext.current) setBusy(false); }
      }}>Загрузить сохранённую версию</Button>}
    </div> : <>
      {!query.data.results.length ? <p className="rounded-lg border p-5">Обследований пока нет.{!canManage && ' Первое обследование создаёт ответственный за объект.'}</p>
        : query.data.results.map(row => <InspectionCard key={row.id + ':' + row.revision} row={row}
          canManage={canManage && !busy && !retryable} edit={() => start(row)}
          complete={() => void perform(() => opsApiClient.post<ObjectInspection>(BASE + row.id + '/complete/', {revision: row.revision}))}
          resolve={(itemId, resolution) => void perform(() => opsApiClient.post<ObjectInspection>(BASE + row.id + '/resolve/', {revision: row.revision, itemId, resolution}))} />)}
      {(page > 1 || query.data.hasNext) && <nav className="flex items-center gap-3" aria-label="Страницы обследований">
        <Button variant="outline" disabled={page === 1 || busy || retryable} onClick={() => setPage(page - 1)}>Назад</Button>
        <span>Страница {page}</span><Button variant="outline" disabled={!query.data.hasNext || busy || retryable} onClick={() => setPage(page + 1)}>Далее</Button>
      </nav>}
    </>}
  </section>;
}

function InspectionEditor({draft, onChange, frozen, today, currentUser, scope}: {
  draft: InspectionDraft; onChange: (draft: InspectionDraft) => void; frozen: boolean; today: string; currentUser: InspectionUser; scope: string;
}) {
  function update(index: number, patch: Partial<InspectionItemDraft>) {
    onChange({...draft, items: draft.items.map((item, i) => i === index ? {...item, ...patch} : item)});
  }
  return <fieldset disabled={frozen} className="space-y-4">
    <label className="block max-w-xs text-sm font-medium">Дата обследования
      <Input type="date" max={today} value={draft.inspectedOn} onChange={e => onChange({...draft, inspectedOn: e.target.value})} />
    </label>
    <p className="text-sm text-muted-foreground">Проверяющий фиксируется по учётной записи создателя. Добавьте вопросы из принятого у вас порядка проверки.</p>
    {draft.items.map((item, index) => <div key={item.id} className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Пункт {index + 1}</h3>
        <Button type="button" variant="ghost" onClick={() => onChange({...draft, items: draft.items.filter((_, i) => i !== index)})}>Убрать пункт {index + 1}</Button></div>
      <label className="block text-sm">Вопрос<Input value={item.question} maxLength={1000} onChange={e => update(index, {question: e.target.value})} /></label>
      <label className="block text-sm">Результат<select className={selectStyle} value={item.answer} onChange={e => {
        const answer = e.target.value as InspectionItemDraft['answer'];
        update(index, answer === 'no' ? {answer, responsibleUsername: item.responsibleUsername || currentUser.username}
          : {answer, finding: '', responsibleUsername: '', dueOn: null});
      }}>{Object.entries(answerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {item.answer === 'no' && <div className="space-y-3">
        <label className="block text-sm">Замечание<textarea className={selectStyle + ' py-2'} value={item.finding} maxLength={2000} rows={2} onChange={e => update(index, {finding: e.target.value})} /></label>
        <AssigneeInput value={item.responsibleUsername} onChange={responsibleUsername => update(index, {responsibleUsername})} scope={scope} id={item.id} />
        <label className="block max-w-xs text-sm">Срок устранения<Input type="date" min={draft.inspectedOn} value={item.dueOn ?? ''} onChange={e => update(index, {dueOn: e.target.value || null})} /></label>
      </div>}
    </div>)}
    <Button type="button" variant="outline" disabled={frozen || draft.items.length >= 100} onClick={() => onChange({...draft, items: [...draft.items,
      {id: browserUuid(), question: '', answer: '', finding: '', responsibleUsername: '', dueOn: null}]})}>Добавить вопрос</Button>
    <p className="text-xs text-muted-foreground">Черновик можно сохранить незаполненным. Завершение доступно после ответа на все вопросы.</p>
  </fieldset>;
}

function AssigneeInput({value, onChange, scope, id}: {value: string; onChange: (value: string) => void; scope: string; id: string}) {
  const query = useQuery<{results: InspectionUser[]}>({queryKey: ['inspection-assignees', scope, value], staleTime: 30000,
    queryFn: () => opsApiClient.get(BASE + 'assignees/?q=' + encodeURIComponent(value))});
  return <label className="block text-sm">Ответственный за устранение
    <Input value={value} list={'inspection-assignees-' + id} maxLength={150} placeholder="Начните вводить логин или фамилию" onChange={e => onChange(e.target.value)} />
    <datalist id={'inspection-assignees-' + id}>{!query.isError && query.data?.results.map(user => <option key={user.id} value={user.username}>{user.name}</option>)}</datalist>
    <span className="text-xs text-muted-foreground">Выберите действующую учётную запись из подсказок.</span>
  </label>;
}

function InspectionCard({row, canManage, edit, complete, resolve}: {row: ObjectInspection; canManage: boolean;
  edit: () => void; complete: () => void; resolve: (id: string, text: string) => void}) {
  const issue = inspectionCompletionIssue(row);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  return <article className="break-words rounded-lg border p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0">
      <h3 className="font-semibold">{formatIsoDate(row.inspectedOn)} · {row.state === 'draft' ? 'Черновик' : 'Обследование завершено'}</h3>
      <p className="text-sm text-muted-foreground">Проверяющий: {row.reviewer.name} · Сохранено {formatIsoDateTime(row.updatedAt)}</p>
      <p className="mt-1 text-sm">{row.openFindings ? 'Открытых замечаний: ' + row.openFindings : row.state === 'draft' ? 'Результаты ещё не подтверждены' : 'Открытых замечаний нет'}
        {row.overdueFindings > 0 && ' · Просрочено: ' + row.overdueFindings}</p>
    </div>{canManage && row.state === 'draft' && <Button variant="outline" onClick={edit}>Продолжить заполнение</Button>}</div>
    <details className="mt-3" open={row.openFindings > 0}><summary className="cursor-pointer text-sm font-medium">Результаты проверки · {row.items.length}</summary>
      <ol className="mt-3 space-y-3">{row.items.map(item => <li key={item.id} className="rounded-md bg-muted/40 p-3 text-sm">
        <p className="font-medium">{item.question || 'Вопрос не заполнен'}</p><p>{answerLabels[item.answer]}</p>
        {item.answer === 'no' && <div className="mt-2 space-y-1"><p>{item.finding || 'Замечание не заполнено'}</p>
          <p>Ответственный: {item.responsible?.name || 'не назначен'} · Срок: {item.dueOn ? formatIsoDate(item.dueOn) : 'не указан'}</p>
          {item.resolvedAt ? <p>Устранено {formatIsoDateTime(item.resolvedAt)} · {item.resolvedBy?.name}: {item.resolution}</p>
            : canManage && row.state === 'completed' && <div className="pt-2">
              <label className="block">Что сделано для устранения<Input value={resolutions[item.id] ?? ''} maxLength={2000} onChange={e => setResolutions({...resolutions, [item.id]: e.target.value})} /></label>
              <Button variant="outline" className="mt-2" disabled={!resolutions[item.id]?.trim()} onClick={() => resolve(item.id, resolutions[item.id])}>Подтвердить устранение</Button>
            </div>}
        </div>}
      </li>)}</ol>
    </details>
    {canManage && row.state === 'draft' && <div className="mt-3">
      {issue && <p className="mb-2 text-sm text-muted-foreground">{issue}</p>}
      <Button disabled={Boolean(issue)} onClick={complete}>Завершить обследование</Button>
    </div>}
  </article>;
}

