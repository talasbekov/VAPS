'use client';
import { combatState, type CombatShift } from '@/entities/combat-duty';
import { CombatShiftActions } from './CombatShiftActions';

export function CombatDutyTable({ shifts, canFor, onResubmit }: {
  shifts: CombatShift[]; canFor: (kind: 'roster' | 'review', divisionId: string) => boolean; onResubmit: (shift: CombatShift) => void;
}) {
  return <div className="overflow-x-auto rounded-lg border bg-card"><table className="w-full text-left text-sm">
    <caption className="sr-only">Группы на выбранную дату</caption>
    <thead className="border-b bg-muted/50"><tr>{['Группа', 'Люди', 'Место службы', 'Техника', 'ОМ', 'Состояние', 'Действия'].map(label => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
    <tbody className="divide-y">{shifts.map(shift => <tr key={shift.id} id={`combat-shift-${shift.id}`} tabIndex={-1} data-testid="combat-group-card" className="align-top focus:outline focus:outline-2 focus:outline-primary">
      <td className="min-w-44 px-4 py-3"><p className="font-semibold">{shift.groupName}</p><p className="mt-1 text-xs text-muted-foreground">{shift.divisionName}</p>
        <details className="mt-2"><summary className="cursor-pointer text-xs text-primary-ink">Подробности</summary><div className="mt-2 space-y-2 text-xs"><p>{shift.dutyTypeName}</p>{shift.callsign && <p>Позывной: {shift.callsign}</p>}<p>Состав: {shift.members.length} / {shift.maxMembers}</p>{shift.restDayAfter && <p>На следующий день — отдых</p>}<ul className="space-y-1">{shift.members.map(m => <li key={m.employeeId}>{m.employeeName}{m.isDriver ? ' · водитель' : ''}{m.isReserve ? ' · резерв' : ''}{m.acknowledged ? ' · ознакомлен' : ''}</li>)}</ul></div></details>
      </td>
      <td className="min-w-48 px-4 py-3"><ul className="space-y-1">{shift.members.map(m => <li key={m.employeeId}>{m.employeeName}{m.isLeader && <span className="block text-xs text-muted-foreground">Старший</span>}{m.isReserve && <span className="block text-xs text-muted-foreground">Резерв</span>}</li>)}</ul></td>
      <td className="min-w-40 px-4 py-3">{shift.isReserve ? 'Резерв' : shift.location.label}</td>
      <td className="px-4 py-3">{shift.equipment.map(v => `${v.label} × ${v.quantity}`).join(', ') || '—'}</td>
      <td className="px-4 py-3">{shift.event?.title ?? '—'}</td>
      <td className="min-w-44 px-4 py-3"><span className="inline-block rounded-md bg-muted px-2 py-1 text-xs font-medium">{combatState(shift)}</span>{shift.returnReason && <p className="mt-2 text-xs text-destructive">Возврат: {shift.returnReason}</p>}{shift.cancellationReason && <p className="mt-2 text-xs">Отмена: {shift.cancellationReason}</p>}{Boolean(shift.warnings?.length) && <div role="status" className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950"><p className="font-medium">Проверьте состав</p>{shift.warnings?.map(w => <p key={w.employeeId}>{w.employeeName} · {w.reason}</p>)}</div>}</td>
      <td className="min-w-44 px-4 py-3"><CombatShiftActions shift={shift} canRoster={canFor('roster', shift.divisionId)} canReview={canFor('review', shift.divisionId)} onResubmit={() => onResubmit(shift)} /></td>
    </tr>)}</tbody>
  </table></div>;
}
