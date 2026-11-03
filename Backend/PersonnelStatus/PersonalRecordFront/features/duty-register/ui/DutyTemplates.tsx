'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { browserUuid } from '@/lib/browser-uuid';
import type { DutyKind } from '@/entities/duty-register';
import { dutyInput } from './DutyRegisterFilters';
import { DutyTemplateError, dutyTemplateStorageKey, projectDutyTemplate, readDutyTemplates, removeDutyTemplate, saveDutyTemplate, templateFromDraft, type DutyTemplate, type DutyTemplateDraft } from '../model/templates';

function message(error: unknown) {
  return error instanceof DutyTemplateError ? error.message : 'Хранилище браузера недоступно или заполнено. Шаблоны не изменены; запись можно заполнить вручную.';
}

export function DutyTemplates({ actor, scope, zone, enabled, kinds, draft, defaultDate, onApply }: {
  actor: string; scope: string; zone: string; enabled: boolean; kinds: DutyKind[];
  draft: DutyTemplateDraft; defaultDate: string; onApply(draft: DutyTemplateDraft): void;
}) {
  const [rows, setRows] = useState<DutyTemplate[]>([]);
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [selected, setSelected] = useState('');
  const [date, setDate] = useState(draft.planned_start.slice(0, 10) || defaultDate);
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const load = useCallback(() => {
    try { setRows(readDutyTemplates(localStorage, actor, scope, zone)); setBlocked(false); setError(''); }
    catch (failure) { setRows([]); setBlocked(true); setError(message(failure)); }
    setReady(true);
  }, [actor, scope, zone]);
  useEffect(() => {
    load();
    const changed = (event: StorageEvent) => { if (event.key === null || event.key === dutyTemplateStorageKey(actor, scope, zone)) { load(); setNotice(''); setDeleting(false); } };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [load, actor, scope, zone]);
  const chosen = rows.find(row => row.id === selected);
  const kindAvailable = Boolean(chosen && kinds.some(row => row.code === chosen.kind && row.is_active));
  const canUse = enabled && ready && !blocked;
  let capturable = false;
  try { templateFromDraft('preview', name || 'Черновик', draft); capturable = kinds.some(row => row.code === draft.service_duty_code && row.is_active); } catch { /* Incomplete drafts remain editable. */ }
  let preview: DutyTemplateDraft | null = null;
  try { if (chosen && date) preview = projectDutyTemplate(chosen, date); } catch { /* The apply action gives the validation message. */ }

  function apply() {
    if (!canUse || !selected) return;
    try {
      const fresh = readDutyTemplates(localStorage, actor, scope, zone);
      setRows(fresh);
      const row = fresh.find(value => value.id === selected);
      if (!row) throw new DutyTemplateError('Шаблон удалён в другом окне. Выберите другой.');
      if (!kinds.some(value => value.code === row.kind && value.is_active)) throw new DutyTemplateError('Вид дежурства недоступен для новых записей. Выберите действующий вид вручную.');
      onApply(projectDutyTemplate(row, date)); setError(''); setDeleting(false);
      setNotice('Параметры подставлены. Проверьте сотрудника и плановое время перед сохранением записи.');
    } catch (failure) { setError(message(failure)); setNotice(''); }
  }
  function save() {
    if (!canUse || !capturable || !name.trim()) return;
    try {
      const row = templateFromDraft(browserUuid(), name, draft);
      setRows(saveDutyTemplate(localStorage, actor, scope, zone, row)); setSelected(row.id); setName(''); setError(''); setDeleting(false);
      setDate(draft.planned_start.slice(0, 10)); setNotice('Шаблон сохранён. Он доступен при следующем создании записи в этом браузере.');
    } catch (failure) { setError(message(failure)); setNotice(''); }
  }
  function remove() {
    if (!canUse || !chosen || !deleting) return;
    try { setRows(removeDutyTemplate(localStorage, actor, scope, zone, chosen.id)); setSelected(''); setDeleting(false); setError(''); setNotice('Шаблон удалён. Ранее созданные записи сохранены.'); }
    catch (failure) { setError(message(failure)); setNotice(''); }
  }
  return <details className="min-w-0 rounded-lg border bg-muted/30 p-3" open={rows.length > 0 || Boolean(error)}>
    <summary className="cursor-pointer text-sm font-semibold">Личные шаблоны дежурств{rows.length > 0 ? ` · ${rows.length}` : ''}</summary>
    <div className="mt-3 min-w-0 space-y-3">
      <p className="text-xs text-muted-foreground">Для этой учётки, области доступа и часового пояса в текущем браузере. Сохраняются вид, время, место, основание и примечание. Сотрудник и фактические отметки в шаблон не входят.</p>
      {rows.length > 0 && <>
        <label className="grid min-w-0 gap-1 text-sm">Сохранённый шаблон<select className={dutyInput} value={selected} disabled={!canUse} onChange={event => { setSelected(event.target.value); setDeleting(false); setNotice(''); setError(''); }}><option value="">Выберите шаблон</option>{rows.map(row => <option key={row.id} value={row.id}>{row.name}{kinds.some(value => value.code === row.kind && value.is_active) ? '' : ' · вид недоступен'}</option>)}</select></label>
        {chosen && <>
          <label className="grid min-w-0 gap-1 text-sm">Дата смены по шаблону<input type="date" className={dutyInput} value={date} disabled={!canUse} onChange={event => { setDate(event.target.value); setNotice(''); }} /></label>
          <div className="min-w-0 space-y-1 rounded-md bg-background p-3 text-sm"><p className="break-words font-medium">{kinds.find(row => row.code === chosen.kind)?.label || 'Вид недоступен'}</p><p>{preview ? `${preview.planned_start.replace('T', ' ')} — ${preview.planned_end.replace('T', ' ')}` : 'Выберите корректную дату для расчёта времени.'}</p>{chosen.location_label && <p className="break-words">Место: {chosen.location_label}</p>}{chosen.document_basis && <p className="break-words">Основание: {chosen.document_basis}</p>}{chosen.note && <p className="whitespace-pre-wrap break-words">{chosen.note}</p>}</div>
          {!kindAvailable && <p className="text-sm text-amber-700">Вид недоступен для новых записей. Шаблон сохранён; заполните запись действующим видом вручную.</p>}
          <p className="text-xs text-muted-foreground">«Подставить» заменит вид, плановое время, место, основание и примечание в форме. Выбранный сотрудник сохранится.</p>
          <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={!canUse || !kindAvailable || !preview} onClick={apply}>Подставить в запись</Button><Button type="button" size="sm" variant="outline" disabled={!canUse} onClick={() => setDeleting(value => !value)}>Удалить шаблон</Button></div>
          {deleting && <div className="space-y-2 rounded-md border p-3 text-sm"><p className="break-words">Удалить шаблон «{chosen.name}»?</p><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="destructive" disabled={!canUse} onClick={remove}>Да, удалить шаблон</Button><Button type="button" size="sm" variant="outline" onClick={() => setDeleting(false)}>Оставить</Button></div></div>}
        </>}
      </>}
      <div className="min-w-0 space-y-2 border-t pt-3">
        <label className="grid min-w-0 gap-1 text-sm">Название нового шаблона<input maxLength={120} className={dutyInput} value={name} disabled={!canUse} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); save(); } }} placeholder="Например: ГБР · ночная смена" /></label>
        <p className="text-xs text-muted-foreground">Заполните вид и плановое время ниже, затем сохраните параметры под своим названием. Даты и сотрудник в шаблон не входят.</p>
        <Button type="button" size="sm" variant="outline" disabled={!canUse || !capturable || !name.trim()} onClick={save}>Сохранить шаблон</Button>
      </div>
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      {blocked && <Button type="button" variant="outline" size="sm" onClick={load}>Повторить чтение шаблонов</Button>}
      {notice && <p role="status" className="break-words text-sm">{notice}</p>}
    </div>
  </details>;
}
