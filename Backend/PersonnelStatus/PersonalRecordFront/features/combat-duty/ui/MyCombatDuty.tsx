'use client';
import { COMBAT_PATH, combatState, type CombatShift } from '@/entities/combat-duty';
import { useCombatRead } from '@/hooks/use-combat-duty';
import { Button } from '@/components/ui/button';
import { CombatAssignmentDetails } from './CombatAssignmentDetails';
import { CombatShiftActions } from './CombatShiftActions';

export function MyCombatDuty({ employeeId }: { employeeId: string }) {
  const query = useCombatRead<{ results: CombatShift[] }>(COMBAT_PATH + 'mine/', true, true);
  if (query.isError) return <div role="alert" className="rounded-lg border p-4 text-sm">Не удалось обновить личные боевые дежурства. <Button variant="outline" onClick={() => void query.refetch()}>Повторить</Button></div>;
  if (!query.data?.results.length) return null;
  return <section className="space-y-3 rounded-lg border bg-card p-4" aria-label="Мои боевые дежурства"><h2 className="font-semibold">Мои боевые дежурства</h2>{query.data.results.map(shift => <article key={shift.id} className="space-y-2 border-t pt-3"><p className="text-sm font-medium">{shift.businessDate} · {combatState(shift)}</p><CombatAssignmentDetails assignment={shift.assignment} /><p className="text-xs text-muted-foreground">Старший: {shift.members.find(m => m.isLeader)?.employeeName} · {shift.dutyTypeName}</p><CombatShiftActions shift={shift} personalId={employeeId} /></article>)}</section>;
}
