'use client';
import Link from 'next/link';
import type { CombatAssignment } from '@/entities/combat-duty';
import { useOpsPermissions } from '@/hooks/use-ops-permissions';

export function CombatAssignmentDetails({ assignment }: { assignment?: CombatAssignment | null }) {
  return assignment ? <Assignment assignment={assignment} /> : null;
}

function Assignment({ assignment }: { assignment: CombatAssignment }) {
  const access = useOpsPermissions();
  const canOpen = !access.isLoading && !access.error && ['duty.view', 'duty.roster', 'duty.manage', 'duty.combat.manage', 'duty.catalog.manage'].some(access.hasPermission);
  const query = new URLSearchParams({ section: 'combat', date: assignment.business_date, combat_shift: assignment.shift_id, ...(assignment.division_id ? { combat_division: assignment.division_id } : {}) });
  return <span className="block space-y-0.5 text-xs leading-normal" data-testid="combat-assignment">
    <span className="block font-medium">Групповое · {canOpen ? <Link className="text-primary-ink underline underline-offset-2" href={'/security-ops/duty-register/?' + query}>{assignment.group_name}</Link> : assignment.group_name}</span>
    <span className="block text-muted-foreground">{assignment.location_label}</span>
    {assignment.event_id && <span className="block text-primary-ink">ОМ · {assignment.event_name || `№${assignment.event_id}`}</span>}
  </span>;
}
