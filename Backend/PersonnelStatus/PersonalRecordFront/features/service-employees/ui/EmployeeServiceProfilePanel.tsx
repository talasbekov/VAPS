'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadFailure } from '@/components/load-failure';
import { opsApiClient } from '@/lib/ops-api';
import { OpsApiError } from '@/lib/ops-errors';
import { formatIsoDateTime } from '@/shared/lib/date';
import { SERVICE_EMPLOYEES_PATH } from '@/entities/service-employee';
import {
  draftFromProfile, profileFromDraft, INVENTORY_LABELS, SKILL_LABELS, HEALTH_LABELS,
  type InventoryCategory, type SkillKey, type HealthKey, type ServiceProfileDraft, type ServiceProfileResponse,
} from '@/entities/service-employee/service-profile';
import { useServiceEmployeeAuthority } from '../use-service-employee-authority';
import { EmployeeQualificationsPanel } from './EmployeeQualificationsPanel';

const selectClass = 'min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm';
const skillKeys = Object.keys(SKILL_LABELS) as SkillKey[];
const healthKeys = Object.keys(HEALTH_LABELS) as HealthKey[];
const categories = Object.keys(INVENTORY_LABELS) as InventoryCategory[];

export function EmployeeServiceProfilePanel({ employeeId }: { employeeId: string }) {
  const authority = useServiceEmployeeAuthority();
  const client = useQueryClient();
  const queryKey = ['employee-service-profile', authority.key, employeeId];
  const endpoint = `${SERVICE_EMPLOYEES_PATH}${encodeURIComponent(employeeId)}/service-profile/`;
  const query = useQuery({
    queryKey, queryFn: () => opsApiClient.get<ServiceProfileResponse>(endpoint),
    enabled: authority.ready, retry: false,
  });
  const [editing, setEditing] = useState<{ revision: number; draft: ServiceProfileDraft } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  // Failed permission/read refreshes never leave retained medical data visible.
  const data = authority.ready && query.isSuccess ? query.data : undefined;
  const editable = data?.can_edit && authority.hasPermission('orgstructure.manage') && authority.hasPermission('admin.roles');
  const draft = editing?.draft;
  const change = (patch: Partial<ServiceProfileDraft>) => {
    setEditing(current => current ? { ...current, draft: { ...current.draft, ...patch } } : null);
  };
  async function save() {
    if (!editing || !editable || busy || query.isFetching || conflict) return;
    let profile;
    try { profile = profileFromDraft(editing.draft); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Проверьте введённые значения.'); return; }
    setBusy(true); setMessage('');
    try {
      const result = await opsApiClient.put<ServiceProfileResponse>(endpoint, { revision: editing.revision, profile });
      client.setQueryData(queryKey, result);
      // Qualifications share this revision; finish their refresh before allowing
      // another assessment, otherwise the next save would conflict with ourselves.
      await client.invalidateQueries({ queryKey: ['employee-qualifications', authority.key, employeeId] });
      setEditing(null); setMessage('Профиль сохранён.');
    } catch (error) {
      if (error instanceof OpsApiError && error.status === 409) {
        setConflict(true);
        setMessage('Профиль изменён другим пользователем. Ваш ввод сохранён в форме. Отмените правки и обновите карточку, чтобы увидеть текущие данные.');
      } else if (error instanceof OpsApiError && [401, 403, 404].includes(error.status)) {
        setEditing(null);
        client.removeQueries({ queryKey, exact: true });
        await client.invalidateQueries({ queryKey: ['ops-me'], exact: true });
        setMessage('Доступ изменился. Обновите карточку.');
      } else {
        setMessage('Сохранить не удалось. Введённые значения остаются в форме; повторите попытку.');
      }
    } finally { setBusy(false); }
  }
  return <Card>
    <CardHeader><CardTitle>Личный профиль службы</CardTitle>
      <p className="text-sm text-muted-foreground">Вооружение, навыки и кадровые сведения. Значения вносит уполномоченный сотрудник.</p>
    </CardHeader>
    <CardContent className="space-y-4">
      {query.isPending && authority.ready && <p role="status">Загрузка профиля…</p>}
      {(!authority.ready || query.isError) && <LoadFailure what="личный профиль" onRetry={() => {
        if (!authority.ready) void client.refetchQueries({ queryKey: ['ops-me'], exact: true });
        else void query.refetch();
      }} isRetrying={query.isFetching} />}
      {message && <p role="status" className="text-sm">{message}</p>}
      {data && <EmployeeQualificationsPanel key={`${authority.key}-${employeeId}`} employeeId={employeeId} legacyScores={data.profile.skills} disabled={Boolean(editing)} />}
      {data && (editing && draft && editable ? <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-5">
        <fieldset disabled={busy} className="space-y-5">
          <div className="space-y-3">
            <h3 className="font-semibold">Личное вооружение и снаряжение</h3>
            <label className="block space-y-1 text-sm"><span>Сведения о составе</span>
              <select className={selectClass} value={draft.inventoryKnown ? 'known' : 'unknown'} onChange={event => change({ inventoryKnown: event.target.value === 'known' })}>
                <option value="unknown">Не указаны</option><option value="known">Состав известен</option>
              </select>
            </label>
            {draft.inventoryKnown && <>
              {draft.inventory.length === 0 && <p className="text-sm">Позиций нет. При сохранении это будет явно пустой состав.</p>}
              {draft.inventory.map((item, index) => <div key={index} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm"><span>Категория · позиция {index + 1}</span><select className={selectClass} value={item.category} onChange={event => change({ inventory: draft.inventory.map((row, i) => i === index ? { ...row, category: event.target.value as InventoryCategory } : row) })}>
                  {categories.map(category => <option key={category} value={category}>{INVENTORY_LABELS[category]}</option>)}
                </select></label>
                <label className="space-y-1 text-sm"><span>Наименование · позиция {index + 1}</span><Input className="min-h-11" required maxLength={2000} value={item.name} onChange={event => change({ inventory: draft.inventory.map((row, i) => i === index ? { ...row, name: event.target.value } : row) })} /></label>
                <label className="space-y-1 text-sm"><span>Количество · позиция {index + 1}</span><Input className="min-h-11" type="number" inputMode="numeric" required min={0} step={1} max={Number.MAX_SAFE_INTEGER} value={item.quantity} onChange={event => change({ inventory: draft.inventory.map((row, i) => i === index ? { ...row, quantity: event.target.value } : row) })} /></label>
                <Button className="min-h-11 self-end" type="button" variant="outline" onClick={() => change({ inventory: draft.inventory.filter((_, i) => i !== index) })}>Удалить позицию {index + 1}</Button>
              </div>)}
              <Button className="min-h-11" type="button" variant="outline" disabled={draft.inventory.length >= 100} onClick={() => change({ inventory: [...draft.inventory, { category: 'weapon', name: '', quantity: '' }] })}>Добавить позицию</Button>
            </>}
          </div>
          <div className="space-y-3"><h3 className="font-semibold">Оценки навыков · от 1 до 5</h3>
            <p className="text-sm text-muted-foreground">Оценку с историей проверок можно изменить только через «Записать проверку». Для остальных навыков здесь хранятся прежние сведения без подтверждающей записи.</p>
            <div className="grid gap-3 sm:grid-cols-3">{skillKeys.map(key => <label key={key} className="space-y-1 text-sm"><span>{SKILL_LABELS[key]}</span>
              <select className={selectClass} disabled={data.verified_skills?.includes(key)} value={draft.skills[key]} onChange={event => change({ skills: { ...draft.skills, [key]: event.target.value } })}>
                <option value="">Не оценено</option>{[1, 2, 3, 4, 5].map(score => <option key={score} value={score}>{score}</option>)}
              </select></label>)}</div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm"><span>Рост, см</span><Input className="min-h-11" type="number" min="0.01" step="any" value={draft.height_cm} onChange={event => change({ height_cm: event.target.value })} placeholder="Не указан" /></label>
            <label className="space-y-1 text-sm"><span>Вес, кг</span><Input className="min-h-11" type="number" min="0.01" step="any" value={draft.weight_kg} onChange={event => change({ weight_kg: event.target.value })} placeholder="Не указан" /></label>
          </div>
          <div className="space-y-3"><h3 className="font-semibold">Сведения о здоровье</h3>
            <p className="text-sm text-muted-foreground">Только внесённые кадровые сведения. Автоматическая медицинская оценка не выполняется.</p>
            {healthKeys.map(key => <label key={key} className="block space-y-1 text-sm"><span>{HEALTH_LABELS[key]}</span>
              <Textarea maxLength={2000} value={draft.health[key] ?? ''} placeholder="Не указано" onChange={event => change({ health: { ...draft.health, [key]: event.target.value || null } })} />
            </label>)}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11" type="submit" disabled={busy || query.isFetching || conflict}>{busy ? 'Сохранение…' : 'Сохранить профиль'}</Button>
          <Button className="min-h-11" type="button" variant="outline" disabled={busy} onClick={() => { setEditing(null); setMessage(''); setConflict(false); void query.refetch(); }}>Отменить правки и обновить</Button>
        </div>
      </form> : <div className="space-y-5">
        <details className="space-y-2"><summary className="cursor-pointer font-semibold">Личное вооружение и снаряжение{data.profile.inventory === null ? ' · не указано' : ` · ${data.profile.inventory.length} позиций`}</summary>
          {data.profile.inventory === null ? <p className="text-sm text-muted-foreground">Состав не указан.</p> : data.profile.inventory.length === 0 ? <p className="text-sm">Состав указан как пустой.</p> :
            <ul className="space-y-2">{data.profile.inventory.map((item, index) => <li className="break-words rounded-md border p-3 text-sm" key={index}><span className="text-muted-foreground">{INVENTORY_LABELS[item.category]} · </span>{item.name}<strong> — {item.quantity} шт.</strong></li>)}</ul>}
        </details>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div><dt className="text-sm text-muted-foreground">Рост</dt><dd>{data.profile.height_cm === null ? 'Не указан' : `${data.profile.height_cm} см`}</dd></div>
          <div><dt className="text-sm text-muted-foreground">Вес</dt><dd>{data.profile.weight_kg === null ? 'Не указан' : `${data.profile.weight_kg} кг`}</dd></div>
        </dl>
        <details className="space-y-3"><summary className="cursor-pointer font-semibold">Сведения о здоровье</summary>
          <dl className="space-y-3">{healthKeys.map(key => <div key={key}><dt className="text-sm text-muted-foreground">{HEALTH_LABELS[key]}</dt><dd className="whitespace-pre-wrap break-words">{data.profile.health[key] || 'Не указано'}</dd></div>)}</dl>
        </details>
        <p className="text-sm text-muted-foreground">{data.profile.updated_at ? `Обновлено ${formatIsoDateTime(data.profile.updated_at)}` : 'Профиль ещё не заполнен.'}</p>
        {editable && <Button className="min-h-11" type="button" variant="outline" disabled={query.isFetching} onClick={() => {
          setEditing({ revision: data.revision, draft: draftFromProfile(data.profile) }); setMessage(''); setConflict(false);
        }}>Редактировать личный профиль</Button>}
      </div>)}
    </CardContent>
  </Card>;
}
