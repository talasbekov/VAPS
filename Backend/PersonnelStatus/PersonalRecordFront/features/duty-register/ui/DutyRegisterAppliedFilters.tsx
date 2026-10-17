import { dutyDateTime, type DutyKind, type DutyRegisterSnapshot } from '@/entities/duty-register';
import { dutyAppliedFilterValues } from '../model/applied-filters';

export function DutyRegisterAppliedFilters({ params, data, kinds }: {
  params: URLSearchParams; data: DutyRegisterSnapshot; kinds: DutyKind[];
}) {
  const values = dutyAppliedFilterValues(params, data, kinds);
  const view = params.get('view') === 'kinds' ? 'По видам' : params.get('view') === 'employees' ? 'По сотрудникам' : 'Записи';
  return <section aria-label="Применённый отбор" className="min-w-0 space-y-2 rounded-lg border p-3 text-sm print:break-inside-avoid">
    <p className="font-medium">Применённый отбор</p>
    {values.length ? <dl className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">{values.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-words">{value}</dd></div>)}</dl> : <p>Все доступные записи за выбранный период.</p>}
    <p className="text-xs text-muted-foreground">Представление: {view}. Показатели рассчитаны по всему отбору. Сформировано: {dutyDateTime(data.generated_at, data.time_zone)}.</p>
  </section>;
}
