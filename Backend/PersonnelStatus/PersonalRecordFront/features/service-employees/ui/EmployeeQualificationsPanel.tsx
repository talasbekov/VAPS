'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { LoadFailure } from '@/components/load-failure';
import { opsApiClient } from '@/lib/ops-api';
import { OpsApiError } from '@/lib/ops-errors';
import { browserUuid } from '@/lib/browser-uuid';
import { SERVICE_EMPLOYEES_PATH } from '@/entities/service-employee';
import { SKILL_LABELS, type SkillKey } from '@/entities/service-employee/service-profile';
import {
  assessmentFromDraft, qualificationStateLabel,
  type AssessmentDraft, type AssessmentInput, type QualificationsResponse,
} from '@/entities/service-employee/qualifications';
import { useServiceEmployeeAuthority } from '../use-service-employee-authority';

const skills = Object.keys(SKILL_LABELS) as SkillKey[];
const selectClass = 'min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm';
const dateLabel = (date: string) => date.split('-').reverse().join('.');
type Submission = AssessmentInput & { revision: number; request_key: string };

export function EmployeeQualificationsPanel({ employeeId, legacyScores, disabled = false }: {
  employeeId: string; legacyScores: Record<SkillKey, number | null>; disabled?: boolean;
}) {
  const authority = useServiceEmployeeAuthority();
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const key = ['employee-qualifications', authority.key, employeeId];
  const endpoint = `${SERVICE_EMPLOYEES_PATH}${encodeURIComponent(employeeId)}/qualifications/`;
  const query = useQuery({
    queryKey: [...key, page], queryFn: () => opsApiClient.get<QualificationsResponse>(`${endpoint}?page=${page}`),
    enabled: authority.ready, retry: false,
  });
  const [draft, setDraft] = useState<AssessmentDraft | null>(null);
  const [draftRevision, setDraftRevision] = useState<number | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [message, setMessage] = useState('');
  const data = authority.ready && query.isSuccess && !blocked ? query.data : undefined;
  const editable = data?.can_edit && authority.hasPermission('orgstructure.manage') && authority.hasPermission('admin.roles');
  const frozen = busy || Boolean(submission) || disabled || conflict;
  async function refresh() {
    const result = await query.refetch();
    if (result.isSuccess) { setBlocked(false); setConflict(false); setDraftRevision(result.data.revision); }
  }
  async function save() {
    if (!data || !draft || !editable || busy || disabled || conflict || query.isFetching) return;
    let body = submission;
    try {
      body ??= { ...assessmentFromDraft(draft, data.today), revision: draftRevision ?? data.revision, request_key: browserUuid() };
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Проверьте сведения.'); return; }
    setSubmission(body); setBusy(true); setMessage('');
    try {
      const result = await opsApiClient.post<QualificationsResponse>(endpoint, body);
      client.setQueryData([...key, 1], result);
      setPage(1); setDraft(null); setDraftRevision(null); setSubmission(null);
      setMessage('Проверка записана. Прежние записи сохранены в истории.');
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({ queryKey: ['employee-service-profile', authority.key, employeeId] });
    } catch (error) {
      if (error instanceof OpsApiError && [401, 403, 404].includes(error.status)) {
        setBlocked(true); setDraft(null); setSubmission(null);
        client.removeQueries({ queryKey: key });
        void client.invalidateQueries({ queryKey: ['ops-me'] });
        setMessage('Доступ изменился. Обновите карточку.');
      } else if (error instanceof OpsApiError && error.status === 409) {
        setSubmission(null); setConflict(true);
        setMessage('Карточка изменена. Введённые сведения сохранены; обновите версию и проверьте данные перед повторной записью.');
      } else if (error instanceof OpsApiError && error.status === 400) {
        setSubmission(null); setMessage('Проверка не сохранена. Проверьте даты, оценку и основание; при необходимости обновите сведения.');
      } else {
        setMessage('Результат записи не подтверждён. Повторите сохранение: тот же запрос не создаст дубликат.');
      }
    } finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-lg border p-4" aria-label="Квалификация сотрудника">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-semibold">Квалификация и проверки</h3>
      {data && editable && !draft && <Button type="button" variant="outline" disabled={disabled || query.isFetching} onClick={() => {
        setDraft({skill: 'shooting', score: '', assessed_on: data.today, valid_until: '', basis: ''}); setDraftRevision(data.revision); setMessage(''); setConflict(false);
      }}>Записать проверку</Button>}
    </div>
    <p className="text-sm text-muted-foreground">Показаны дата и срок проверки. Запись оценки не заменяет решение о допуске; прежние оценки без основания отмечены отдельно.</p>
    {query.isPending && authority.ready && <p role="status">Загрузка проверок…</p>}
    {(!authority.ready || query.isError || blocked) && <LoadFailure what="проверки квалификации" onRetry={() => {
      if (!authority.ready) void client.refetchQueries({queryKey: ['ops-me'], exact: true});
      else void refresh();
    }} isRetrying={query.isFetching} />}
    {message && <p role="status" className="text-sm">{message}</p>}
    {data && <div className="grid gap-3 sm:grid-cols-3">{skills.map(skill => {
      const current = data.current[skill];
      return <div key={skill} className="space-y-1 rounded-md bg-muted/40 p-3">
        <h4 className="font-medium">{SKILL_LABELS[skill]}</h4>
        <p className="text-sm">{current.assessment ? `${current.assessment.score} / 5 · ${qualificationStateLabel(current.state)}` : legacyScores[skill] === null ? 'Проверок нет' : `${legacyScores[skill]} / 5 · без записи о проверке`}</p>
        {current.assessment && <p className="text-xs text-muted-foreground">
          Проверено {dateLabel(current.assessment.assessed_on)}.
          {current.assessment.valid_until ? ` Срок до ${dateLabel(current.assessment.valid_until)} включительно.` : ' Срок действия не указан.'}
        </p>}
      </div>;
    })}</div>}
    {data && editable && draft && <form className="space-y-3 rounded-md border p-3" onSubmit={event => { event.preventDefault(); void save(); }}>
      <h4 className="font-medium">Новая запись о проверке</h4>
      <fieldset disabled={frozen} className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm"><span>Навык</span><select className={selectClass} value={draft.skill} onChange={event => setDraft({...draft, skill: event.target.value as SkillKey})}>
          {skills.map(skill => <option key={skill} value={skill}>{SKILL_LABELS[skill]}</option>)}
        </select></label>
        <label className="space-y-1 text-sm"><span>Оценка</span><select className={selectClass} required value={draft.score} onChange={event => setDraft({...draft, score: event.target.value})}>
          <option value="">Выберите оценку</option>{[1,2,3,4,5].map(score => <option key={score} value={score}>{score}</option>)}
        </select></label>
        <label className="space-y-1 text-sm"><span>Дата проверки</span><Input type="date" required max={data.today} value={draft.assessed_on} onChange={event => setDraft({...draft, assessed_on: event.target.value})} /></label>
        <label className="space-y-1 text-sm"><span>Действует по (необязательно)</span><Input type="date" min={draft.assessed_on} value={draft.valid_until} onChange={event => setDraft({...draft, valid_until: event.target.value})} /></label>
        <label className="space-y-1 text-sm sm:col-span-2"><span>Основание (документ, проверяющий)</span><Textarea required maxLength={1000} value={draft.basis} onChange={event => setDraft({...draft, basis: event.target.value})} /></label>
      </fieldset>
      <p className="text-xs text-muted-foreground">Запись останется в истории. Исправление вносится новой записью с основанием. Кто внёс сведения, фиксируется автоматически.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || disabled || conflict || query.isFetching}>{busy ? 'Записываем…' : submission ? 'Повторить сохранение' : 'Сохранить проверку'}</Button>
        {conflict && <Button type="button" variant="outline" disabled={query.isFetching} onClick={() => void refresh()}>Обновить версию</Button>}
        <Button type="button" variant="outline" disabled={busy || Boolean(submission)} onClick={() => {setDraft(null); setMessage(''); setConflict(false);}}>Отмена</Button>
      </div>
    </form>}
    {data && data.history.count === 0 && <p className="text-sm text-muted-foreground">Подтверждающие записи пока не внесены.</p>}
    {data && data.history.count > 0 && <details className="space-y-3">
      <summary className="cursor-pointer text-sm font-medium">История проверок · {data.history.count}</summary>
      <ul className="space-y-3">{data.history.results.map(record => <li key={record.id} className="space-y-1 border-t pt-3 text-sm">
        <p className="font-medium">{SKILL_LABELS[record.skill]} · {record.score} / 5 · {dateLabel(record.assessed_on)}</p>
        <p className="whitespace-pre-wrap break-words">{record.basis}</p>
        <p className="break-words text-muted-foreground">{record.valid_until ? `Срок до ${dateLabel(record.valid_until)} включительно.` : 'Срок действия не указан.'} Записал: {record.recorded_by_name}.</p>
      </li>)}</ul>
      {data.history.count > data.history.page_size && <nav aria-label="Страницы истории проверок" className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={busy || query.isFetching || page <= 1 || Boolean(draft)} onClick={() => setPage(page - 1)}>Назад</Button>
        <span className="text-sm">Страница {page} из {Math.ceil(data.history.count / data.history.page_size)}</span>
        <Button type="button" variant="outline" disabled={busy || query.isFetching || page * data.history.page_size >= data.history.count || Boolean(draft)} onClick={() => setPage(page + 1)}>Далее</Button>
      </nav>}
    </details>}
  </section>;
}

