"use client";

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/dashboard-layout';
import { useOpsPermissions } from '@/hooks/use-ops-permissions';
import { portalWorkspace } from './model';
import { workdeskKind, WORKDESK_COPY } from './desk-model';
import { AssistantWorkQueue, DepartmentWorkQueue, PersonalWork, WorkdeskComposer } from './work-queues';
import styles from './workspace.module.css';

export function PortalWorkspace() {
  const access = useOpsPermissions();
  const client = useQueryClient();
  const tasks = portalWorkspace(access);
  const all = [...tasks.primary, ...tasks.more];
  const kind = workdeskKind(all, access.hasGlobalPermission('admin.roles'));
  const copy = WORKDESK_COPY[kind];
  const ready = !access.isLoading && !access.error && access.permissions !== undefined;
  const hasAssistant = all.some(task => task.id === 'assistant');
  const lead = tasks.primary[0];
  const showLead = kind === 'admin' || kind === 'status';
  const scope = [...new Set(access.roles.map(role => role.scope_division_name).filter(Boolean))].join(' · ');
  return <DashboardLayout><div className={styles.desk}>
    <header>
      <p className={styles.eyebrow}>Моя работа</p>
      <h1 className={styles.heading}>{ready ? copy.title : 'Рабочий стол'}</h1>
      {ready && <><p className={styles.subtitle}>{copy.description}</p>{scope && <p className={styles.scope}>{scope}</p>}</>}
    </header>
    {access.isLoading ? <p className={styles.empty} role="status">Загружаем ваши задачи…</p> : !ready ? <section role="alert" className={`${styles.panel} ${styles.empty} mt-6`}>
      <p>Не удалось загрузить ваши рабочие разделы.</p>
      <button type="button" className={styles.textLink} onClick={() => void client.resetQueries({ queryKey: ['ops-me'], exact: true })}>Повторить загрузку</button>
    </section> : <div className={styles.grid}>
      <div className={styles.column}>
        {kind === 'commander' && <WorkdeskComposer />}
        {kind === 'department' && <DepartmentWorkQueue />}
        {kind === 'personal' && <PersonalWork />}
        {showLead && lead && <section className={styles.lead} aria-label="Главное действие">
          <h2>{lead.title}</h2><p>{lead.description}</p><Link href={lead.href} className={styles.action}>{lead.title}<ArrowRight className="size-4" aria-hidden /></Link>
        </section>}
        {kind === 'commander' && <AssistantWorkQueue />}
        {kind === 'department' && hasAssistant && <details className={styles.panel}><summary className="cursor-pointer p-5 text-sm font-semibold">Мои поручения по ОМ</summary>
          <AssistantWorkQueue />
        </details>}
        {kind === 'admin' && <section className={`${styles.panel} ${styles.empty}`} aria-label="Как настроить доступ">
          <strong>Доступ настраивается в карточке пользователя</strong>Выберите сотрудника, рабочую роль и подразделение. Назначенные права определяют его рабочий стол и доступные действия.
        </section>}
      </div>

    </div>}
  </div></DashboardLayout>;
}
