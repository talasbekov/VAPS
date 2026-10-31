'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/dashboard-layout';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { OpsAccessDenied } from '@/components/ops-access-denied';
import { OpsPermissionsUnavailable, isPermissionsCheckFailure } from '@/components/ops-permissions-unavailable';
import { useDutyRegisterAccess } from '@/hooks/use-duty-register';
import { DutyDispatchWorkspace } from '@/features/duty-dispatch/ui/DutyDispatchWorkspace';
import { dutyWorkspaceHref, dutyWorkspaceSection } from '../model/workspace';
import { DutyJournalRecords } from './DutyJournalRecords';
import { DutyRoster } from './DutyRoster';
import { CombatDutyBoard } from '@/features/combat-duty/ui/CombatDutyBoard';

export function DutyRegisterWorkspace() {
  const access = useDutyRegisterAccess();
  const client = useQueryClient();
  const params = useSearchParams();
  const search = new URLSearchParams(params);
  const canShifts = !access.isLoading && !access.error && (access.hasPermission('duty.dispatch') || access.hasGlobalPermission('admin.roles'));
  const canCombat = !access.isLoading && !access.error && ['duty.view', 'duty.manage', 'duty.combat.manage', 'duty.roster', 'duty.catalog.manage'].some(access.hasPermission);
  const requested = dutyWorkspaceSection(search);
  const section = !access.allowed && !params.has('section') ? (canCombat ? 'combat' : canShifts ? 'shifts' : requested) : requested;
  if (isPermissionsCheckFailure(access.error)) return <OpsPermissionsUnavailable onRetry={() => void client.invalidateQueries({ queryKey: ['ops-me'] })} isRetrying={access.isLoading} />;
  if (!access.isLoading && !access.allowed && !canShifts && !canCombat) return <OpsAccessDenied what="журнала дежурств" />;
  const tabs = [
    ...(canCombat ? [{ value: 'combat' as const, label: 'Боевые группы · расчёт на день' }] : []),
    ...(access.allowed ? [{ value: 'roster' as const, label: 'Состав на дату' }, { value: 'records' as const, label: 'Журнал и контроль' }] : []),
    ...(canShifts ? [{ value: 'shifts' as const, label: 'Почасовые смены' }] : []),
  ];
  return <DashboardLayout><div className="min-w-0 space-y-5 pb-12">
    <PageHeader title="Журнал дежурств"  />
    {access.isLoading ? <p role="status">Проверяем доступ к дежурствам…</p> : <>
      <nav aria-label="Разделы журнала дежурств" className="flex flex-wrap gap-2 print:hidden">{tabs.map(tab => <Button key={tab.value} asChild variant={section === tab.value ? 'default' : 'outline'}><Link href={dutyWorkspaceHref(tab.value, search)} aria-current={section === tab.value ? 'page' : undefined} scroll={false}>{tab.label}</Link></Button>)}</nav>
      {section === 'combat' ? (canCombat ? <CombatDutyBoard key={access.scope} /> : <OpsAccessDenied what="расчёта боевого дежурства" embedded />)
        : section === 'roster' ? (access.allowed ? <DutyRoster key={access.scope} /> : <OpsAccessDenied what="состава дежурств" embedded />)
        : section === 'records' ? (access.allowed ? <DutyJournalRecords key={access.scope} /> : <OpsAccessDenied what="записей журнала" embedded />)
        : canShifts ? <DutyDispatchWorkspace key={access.scope} embedded /> : <OpsAccessDenied what="почасовых смен" embedded />}
    </>}
  </div></DashboardLayout>;
}
