// §21.30 «Список дежурств» и «История».
//
// Плоский список поверх ТОГО ЖЕ набора смен, что план и месячная сетка. Из
// одиннадцати колонок промпта модель даёт семь — они и есть таблица; остальные
// четыре (интервал, ответственный, открытые посты, подтверждение плана) приходят
// с сервера списком с причиной и печатаются под таблицей (§35).
//
// «История» — не фильтр на клиенте: границу прошедшего знает сервер (DemoClock,
// §8.8), и `businessDate` приходит в ответе, чтобы экран мог назвать её вслух,
// а не молча отфильтровать по часам машины.
import { Link } from 'react-router'
import { Button } from '../../../shared/ui/Button'
import { ROUTES } from '../../../shared/routes'
import { useDutyShiftList } from '../api/queries'
import type { DutyShiftListRow, DutyShiftListScope } from '../api/pending-contracts'
import type { DutyShiftState } from '../model/types'

const STATE_LABEL: Record<DutyShiftState, string> = {
  PLANNED: 'Запланировано',
  ACKNOWLEDGED: 'Ознакомлен',
  ACTIVE: 'На посту',
  COMPLETED: 'Завершено',
  CANCELLED: 'Отменено',
}

export function DutyShiftListSection({
  scope,
  onScopeChange,
}: {
  scope: DutyShiftListScope
  onScopeChange: (scope: DutyShiftListScope) => void
}) {
  const listQuery = useDutyShiftList(scope)
  const data = listQuery.data ?? null

  return (
    <section aria-label="Список дежурств">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 rounded-md border bg-muted/40 p-1">
          <Button
            size="sm"
            variant={scope === 'ALL' ? 'default' : 'ghost'}
            onClick={() => onScopeChange('ALL')}
          >
            Все дежурства
          </Button>
          <Button
            size="sm"
            variant={scope === 'HISTORY' ? 'default' : 'ghost'}
            onClick={() => onScopeChange('HISTORY')}
          >
            История
          </Button>
        </div>
        {data !== null && (
          <span className="text-xs text-slate-600 tabular-nums">
            {scope === 'HISTORY'
              ? `Завершённые дежурства до ${data.businessDate}`
              : `Бизнес-дата: ${data.businessDate}`}
          </span>
        )}
      </div>

      {listQuery.isLoading && <p className="text-sm text-muted-foreground">Загрузка списка…</p>}
      {listQuery.isError && (
        <p className="text-sm text-destructive">Не удалось загрузить список дежурств.</p>
      )}

      {data !== null && (
        <div className="flex flex-col gap-3.5">
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr>
                  {['Дата', 'Объект', 'Вид дежурства', 'Состав', 'Пост', 'Конфликты', 'Ознакомление', 'Состояние', 'Фактическое завершение'].map(
                    (title) => (
                      <th
                        key={title}
                        scope="col"
                        className="p-3 text-[11px] font-semibold text-slate-600"
                      >
                        {title}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {data.results.length === 0 && (
                  <tr className="border-t">
                    <td className="p-6 text-center text-sm text-muted-foreground" colSpan={9}>
                      {scope === 'HISTORY'
                        ? 'Завершённых дежурств за прошедшие дни нет'
                        : 'Дежурств не найдено'}
                    </td>
                  </tr>
                )}
                {data.results.map((row) => (
                  <ListRow key={row.id} row={row} />
                ))}
              </tbody>
            </table>
          </div>

          <section className="rounded-xl border border-dashed bg-muted/30 p-4">
            <h2 className="mb-2 text-sm font-semibold">Колонки, которых нет в модели</h2>
            <ul className="flex flex-col gap-2">
              {data.unavailableColumns.map((column) => (
                <li key={column.code} className="text-xs text-slate-600">
                  <span className="font-semibold">{column.label}</span> — {column.reason}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </section>
  )
}

function ListRow({ row }: { row: DutyShiftListRow }) {
  return (
    <tr className="border-t">
      <td className="p-3 text-sm tabular-nums">
        <Link className="text-primary underline" to={ROUTES.dutyShiftDetailTo(row.id)}>
          {row.businessDate}
        </Link>
      </td>
      <td className="p-3 text-sm">{row.objectLabel}</td>
      <td className="p-3 text-sm">{row.dutyTypeLabel}</td>
      <td className="p-3 text-sm">{row.employeeName}</td>
      {/* §9.6: отсутствие привязки — факт планирования, а не пустая ячейка. */}
      <td className="p-3 text-sm">
        {row.postLabel ?? <span className="text-xs text-slate-600">Пост вне паспорта</span>}
      </td>
      <td className="p-3 text-sm">
        {/* §21.34: счётчики серверные — список их не выводит. */}
        {row.hardConflictCount === 0 && row.softConflictCount === 0 ? (
          <span className="text-xs text-slate-600">Нет</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {row.hardConflictCount > 0 && (
              <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800">
                Жёстких: {row.hardConflictCount}
              </span>
            )}
            {row.softConflictCount > 0 && (
              <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                Мягких: {row.softConflictCount}
              </span>
            )}
          </span>
        )}
      </td>
      <td className="p-3 text-sm tabular-nums">
        {row.acknowledgedAt ?? <span className="text-xs text-slate-600">Не подтверждено</span>}
      </td>
      <td className="p-3">
        <span className="text-sm">{STATE_LABEL[row.stateCode]}</span>
        {row.cancellationReason !== null && (
          <span className="mt-1 block text-[11px] text-red-800">{row.cancellationReason}</span>
        )}
      </td>
      <td className="p-3 text-sm tabular-nums">
        {row.actualEnd ?? <span className="text-xs text-slate-600">Не завершено</span>}
      </td>
    </tr>
  )
}
