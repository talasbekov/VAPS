import { DUTY_STATE_LABELS, dutyDateTime, type DutyRecord } from '@/entities/duty-register';
import { executionState, executionSteps } from '../model/execution';

export function DutyExecutionBadge({ row, now }: { row: DutyRecord; now: string }) {
  const state = executionState(row, now);
  return <span className={`rounded-full px-3 py-1 text-xs font-medium ${state === 'COMPLETED'
    ? 'bg-emerald-50 text-emerald-800  '
    : state === 'ACTIVE' ? 'bg-blue-50 text-blue-800  '
    : state === 'INCOMPLETE' ? 'bg-amber-50 text-amber-800  '
    : 'bg-muted text-muted-foreground'}`}>{state === 'INCOMPLETE' ? 'Фактические отметки требуют проверки' : DUTY_STATE_LABELS[state]}</span>;
}

export function DutyExecutionTimeline({ row, now, zone }: { row: DutyRecord; now: string; zone: string }) {
  return <ol aria-label="Этапы исполнения" className="grid min-w-0 gap-2 sm:grid-cols-3">
    {executionSteps(row, now).map(step => <li key={step.code} className={`min-w-0 rounded-lg border px-3 py-2 ${step.recorded ? 'border-primary/20 bg-primary/5' : 'bg-muted/30'}`}>
      <p className="text-sm font-medium"><span aria-hidden="true" className="mr-2">{step.recorded ? '✓' : '—'}</span>{step.label}</p>
      <p className="mt-1 break-words text-xs text-muted-foreground">{step.recorded
        ? step.at ? dutyDateTime(step.at, zone) : 'Назначение создано'
        : step.at ? 'Отметка требует проверки' : 'Не отмечено'}</p>
    </li>)}
  </ol>;
}
