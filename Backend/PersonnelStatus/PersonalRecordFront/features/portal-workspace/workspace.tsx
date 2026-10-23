"use client";

import Link from 'next/link';
import { ArrowRight, ClipboardCheck, ShieldCheck, Users, CalendarDays, Sparkles } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/dashboard-layout';
import { useOpsPermissions } from '@/hooks/use-ops-permissions';
import { portalWorkspace, type PortalTask } from './model';
import { workdeskKind, WORKDESK_COPY } from './desk-model';
import { AssistantWorkQueue, DepartmentWorkQueue, PersonalWork, WorkdeskComposer } from './work-queues';
import styles from './workspace.module.css';

function TaskLink({ task }: { task: PortalTask }) {
  const Icon = task.id === 'assistant' ? Sparkles : task.id === 'users' ? Users : task.id === 'roles' ? ShieldCheck
    : task.id === 'duties' || task.id === 'personal' ? CalendarDays : ClipboardCheck;
  return <Link href={task.href} className={styles.tool}><Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
    <span><strong>{task.title}</strong><small>{task.description}</small></span><ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
  </Link>;
}

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
  const primaryTools = tasks.primary.filter(task => !(showLead && task.id === lead?.id) && !(kind === 'commander' && task.id === 'assistant'));
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
      <aside className={styles.tools} aria-label="Рабочие инструменты">
        <h2>Быстрый переход</h2>
        <section aria-label="Основные рабочие задачи">{primaryTools.map(task => <TaskLink key={task.id} task={task} />)}</section>
        {tasks.more.length > 0 && <details><summary>Другие рабочие задачи</summary>{tasks.more.map(task => <TaskLink key={task.id} task={task} />)}</details>}
      </aside>
    </div>}
  </div></DashboardLayout>;
}
