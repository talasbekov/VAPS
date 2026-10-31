import type { AssistantTask } from '@/features/om-assistant/model';
import { progressPresentation } from '@/features/om-assistant/progress-model';

export function AssistantProgress({ task }: { task: AssistantTask }) {
  const progress = progressPresentation(task);
  if (!progress) return null;
  const waiting = progress.closed ? [] : progress.departments.filter(row => !['ACCEPTED', 'SUBMITTED'].includes(row.status));
  return <section className="mt-4 space-y-3" aria-label="Готовность наряда">
    <dl className="grid grid-cols-3 gap-3 rounded-xl border bg-slate-50 p-3 text-sm ">
      <div><dt className="text-slate-500 ">Требуется по ОМ</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{progress.need ?? '—'}</dd></div>
      <div><dt className="text-slate-500 ">В составе</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{progress.collected}</dd></div>
      <div><dt className="text-slate-500 ">Осталось собрать</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{progress.remaining ?? '—'}</dd></div>
    </dl>
    {progress.need === null && <p className="text-sm text-slate-500 ">Потребность появится после рекогносцировки.</p>}
    {waiting.length > 0 && <div><h3 className="text-sm font-semibold">Требуют внимания</h3><ul className="mt-2 divide-y text-sm">
      {waiting.map(row => <li key={row.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1 py-2">
        <span className="min-w-0 break-words font-medium">{row.name}</span><span>{row.label}{row.overdue ? ' · Срок прошёл' : ''}</span>
      </li>)}
    </ul></div>}
    {progress.departments.length > 0 && <details className="text-sm"><summary className="min-h-11 cursor-pointer py-3 font-medium">Все ответы департаментов</summary>
      <ul className="divide-y">{progress.departments.map(row => <li key={row.id} className="py-2">
        <strong>{row.name}</strong><p className="mt-1">Запрошено {row.requested} · {row.responded === null ? 'Ответа пока нет' : `Выделяют ${row.responded}`} · {row.label}</p>
      </li>)}</ul>
    </details>}
  </section>;
}
