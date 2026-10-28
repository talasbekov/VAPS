'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { browserUuid } from '@/lib/browser-uuid';
import { opsApiClient } from '@/lib/ops-api';
import { OpsApiError } from '@/lib/ops-errors';
import type { DutyKind } from '@/entities/duty-register';
import { dutyInput } from './DutyRegisterFilters';
import { projectDutyTemplate, readDutyTemplates, templateFromDraft, serverTemplatePayload, type DutyTemplate, type DutyTemplateDraft, type DutyTemplateList } from '../model/templates';

type Props = { actor: string; scope: string; zone: string; enabled: boolean; kinds: DutyKind[]; draft: DutyTemplateDraft; defaultDate: string; onApply(draft: DutyTemplateDraft): void };
type Write = { method: 'post' | 'put'; endpoint: string; body: unknown; id: string; removing?: boolean };
const endpoint = '/api/ops/duty-templates/';

export function DutyTemplates(props: Props) {
  return <TemplateEditor key={JSON.stringify([props.actor, props.scope, props.zone])} {...props} />;
}

function TemplateEditor({ actor, scope, zone, enabled, kinds, draft, defaultDate, onApply }: Props) {
  const client = useQueryClient();
  const key = ['duty-templates', actor, scope, zone];
  const query = useQuery({ queryKey: key, queryFn: () => opsApiClient.get<DutyTemplateList>(endpoint), enabled: enabled && Boolean(actor && scope && zone), retry: false });
  const [selected, setSelected] = useState('');
  const [date, setDate] = useState(draft.planned_start.slice(0, 10) || defaultDate);
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [pending, setPending] = useState(false);
  const writing = useRef(false);
  const [retry, setRetry] = useState<Write | null>(null);
  const [local, setLocal] = useState<DutyTemplate[]>([]);
  const [localError, setLocalError] = useState('');
  const [localSelected, setLocalSelected] = useState('');
  useEffect(() => {
    try { setLocal(readDutyTemplates(localStorage, actor, scope, zone)); }
    catch { setLocalError('Не удалось прочитать прежние шаблоны браузера. Серверные шаблоны доступны отдельно.'); }
  }, [actor, scope, zone]);
  const data = enabled && !query.isError ? query.data : undefined;
  const rows = data?.results ?? [];
  const chosen = rows.find(row => row.id === selected);
  const canUse = enabled && Boolean(data) && !pending && !retry && data?.time_zone === zone;
  const canCreate = canUse && data?.can_create === true;
  const kindAvailable = Boolean(chosen && kinds.some(row => row.code === chosen.kind && row.is_active));
  let capturable = false;
  try { templateFromDraft('preview', name || 'Черновик', draft); capturable = kinds.some(row => row.code === draft.service_duty_code && row.is_active); } catch { /* Incomplete form. */ }
  let preview: DutyTemplateDraft | null = null;
  try { if (chosen && date) preview = projectDutyTemplate(chosen, date); } catch { /* Invalid date blocks application. */ }

  async function write(operation: Write) {
    if (!enabled || writing.current) return;
    writing.current = true;
    setPending(true); setRetry(operation); setError(''); setNotice('');
    try {
      if (operation.method === 'put') await opsApiClient.put(operation.endpoint, operation.body);
      else await opsApiClient.post(operation.endpoint, operation.body);
      setRetry(null); setDeleting(false); setSelected(operation.removing ? '' : operation.id); setName('');
      setNotice(operation.removing ? 'Шаблон удалён. Созданные по нему дежурства сохранены.' : 'Шаблон сохранён на сервере и доступен с других компьютеров.');
      await client.invalidateQueries({ queryKey: key });
    } catch (failure) {
      if (failure instanceof OpsApiError && failure.status < 500) { setRetry(null); await client.invalidateQueries({ queryKey: key }); }
      setError(failure instanceof Error ? failure.message : 'Не удалось сохранить шаблон.');
    } finally { writing.current = false; setPending(false); }
  }

  function save(replace = false) {
    if (!canUse || !capturable || (replace ? !chosen?.can_manage : !canCreate || !name.trim())) return;
    try {
      const row = templateFromDraft(replace && chosen ? chosen.id : browserUuid(), replace && chosen ? chosen.name : name, draft);
      const body = serverTemplatePayload(row, replace && chosen ? chosen.owner_division_id : owner || null, replace && chosen ? chosen.revision : 0);
      void write({ method: replace ? 'put' : 'post', endpoint: replace ? endpoint + row.id + '/' : endpoint, body, id: row.id });
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Проверьте параметры шаблона.'); }
  }

  function importLocal() {
    const row = local.find(item => item.id === localSelected);
    if (!row || !canCreate) return;
    try {
      const imported = { ...row, id: browserUuid() };
      void write({ method: 'post', endpoint, body: serverTemplatePayload(imported, null), id: imported.id });
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось подготовить перенос.'); }
  }

  return <details className="min-w-0 rounded-lg border bg-muted/30 p-3">
    <summary className="cursor-pointer text-sm font-semibold">Шаблоны дежурств{rows.length > 0 ? ` · ${rows.length}` : ''}</summary>
    <div className="mt-3 min-w-0 space-y-3">
      <p className="text-xs text-muted-foreground">Личные шаблоны доступны вам с любого компьютера. Общие — сотрудникам с доступом к выбранному подразделению. Сотрудник и фактические отметки в шаблон не входят.</p>
      {query.isLoading && <p role="status" className="text-sm">Загружаем шаблоны…</p>}
      {query.isError && <div role="alert" className="space-y-2 text-sm"><p>Не удалось загрузить серверные шаблоны. Запись можно заполнить вручную.</p><Button type="button" size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Повторить загрузку</Button></div>}
      {data && data.time_zone !== zone && <p role="alert" className="text-sm">Часовой пояс журнала изменился. Обновите страницу перед применением шаблона.</p>}
      {data && rows.length === 0 && <p className="text-sm text-muted-foreground">Сохранённых шаблонов пока нет.</p>}
      {rows.length > 0 && <>
        <label className="grid min-w-0 gap-1 text-sm">Сохранённый шаблон<select className={dutyInput} value={selected} disabled={!canUse} onChange={event => { setSelected(event.target.value); setDeleting(false); setNotice(''); setError(''); }}><option value="">Выберите шаблон</option>{rows.map(row => <option key={row.id} value={row.id}>{row.name} · {row.owner_division_id === null ? 'Личный' : row.owner_division_name}{kinds.some(value => value.code === row.kind && value.is_active) ? '' : ' · вид недоступен'}</option>)}</select></label>
        {chosen && <>
          <label className="grid min-w-0 gap-1 text-sm">Дата смены по шаблону<input type="date" className={dutyInput} value={date} disabled={!canUse} onChange={event => setDate(event.target.value)} /></label>
          <div className="min-w-0 space-y-1 rounded-md bg-background p-3 text-sm"><p className="break-words font-medium">{kinds.find(row => row.code === chosen.kind)?.label || 'Вид недоступен'}</p><p>{preview ? `${preview.planned_start.replace('T', ' ')} — ${preview.planned_end.replace('T', ' ')}` : 'Выберите корректную дату для расчёта времени.'}</p>{chosen.location_label && <p className="break-words">Место: {chosen.location_label}</p>}{chosen.document_basis && <p className="break-words">Основание: {chosen.document_basis}</p>}{chosen.note && <p className="whitespace-pre-wrap break-words">{chosen.note}</p>}</div>
          {!kindAvailable && <p className="text-sm text-amber-700">Вид недоступен для новых записей. Заполните запись действующим видом вручную.</p>}
          <p className="text-xs text-muted-foreground">«Подставить» заменит вид, плановое время, место, основание и примечание. Выбранный сотрудник сохранится.</p>
          <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={!canUse || !kindAvailable || !preview} onClick={() => { if (preview) { onApply(preview); setNotice('Параметры подставлены. Проверьте сотрудника и время перед сохранением дежурства.'); } }}>Подставить в запись</Button>{chosen.can_manage && <Button type="button" size="sm" variant="outline" disabled={!canUse} onClick={() => setDeleting(value => !value)}>Удалить шаблон</Button>}</div>
          {chosen.can_manage && <details className="text-sm"><summary className="cursor-pointer">Изменить сохранённый шаблон</summary><p className="my-2">Заменит параметры шаблона «{chosen.name}» значениями из формы дежурства. Название и доступ сохранятся; созданные записи не изменятся.</p><Button type="button" size="sm" variant="outline" disabled={!canUse || !capturable} onClick={() => save(true)}>Обновить шаблон из формы</Button></details>}
          {deleting && chosen.can_manage && <div className="space-y-2 rounded-md border p-3 text-sm"><p className="break-words">Удалить шаблон «{chosen.name}»{chosen.owner_division_id !== null ? ' для всех сотрудников подразделения' : ''}?</p><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="destructive" disabled={!canUse} onClick={() => void write({ method: 'post', endpoint: endpoint + chosen.id + '/remove/', body: { expected_revision: chosen.revision }, id: chosen.id, removing: true })}>Да, удалить шаблон</Button><Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setDeleting(false)}>Оставить</Button></div></div>}
        </>}
      </>}
      {data?.can_create && <div className="min-w-0 space-y-2 border-t pt-3">
        <label className="grid min-w-0 gap-1 text-sm">Название нового шаблона<input maxLength={120} className={dutyInput} value={name} disabled={!canCreate} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); save(); } }} placeholder="Например: ГБР · ночная смена" /></label>
        <label className="grid min-w-0 gap-1 text-sm">Кому доступен<select className={dutyInput} value={owner} disabled={!canCreate} onChange={event => setOwner(event.target.value)}><option value="">Только мне</option>{data.owner_choices.map(row => <option key={row.id} value={String(row.id)}>Подразделению: {row.name}</option>)}</select></label>
        <p className="text-xs text-muted-foreground">Заполните вид и плановое время дежурства ниже, затем сохраните параметры под своим названием.</p>
        <Button type="button" size="sm" variant="outline" disabled={!canCreate || !capturable || !name.trim()} onClick={() => save()}>Сохранить шаблон</Button>
      </div>}
      {(local.length > 0 || localError) && <details className="text-sm"><summary className="cursor-pointer">Прежние шаблоны этого браузера</summary><p className="my-2 text-muted-foreground">Перенос выполняется только по кнопке. Исходные шаблоны браузера сохранятся.</p>{localError ? <p>{localError}</p> : <div className="space-y-2"><select aria-label="Прежний шаблон для переноса" className={dutyInput} value={localSelected} disabled={!canCreate} onChange={event => setLocalSelected(event.target.value)}><option value="">Выберите шаблон</option>{local.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select><Button type="button" size="sm" variant="outline" disabled={!canCreate || !localSelected} onClick={importLocal}>Перенести в мои серверные шаблоны</Button></div>}</details>}
      {pending && <p role="status" className="text-sm">Сохраняем шаблон…</p>}
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      {retry && !pending && <div className="space-y-2 text-sm"><p>Результат не подтверждён. Повтор использует тот же запрос.</p><Button type="button" size="sm" onClick={() => void write(retry)}>Повторить сохранение</Button></div>}
      {notice && <p role="status" className="break-words text-sm">{notice}</p>}
    </div>
  </details>;
}
