"use client";

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/dashboard-layout';
import { useOpsPermissions } from '@/hooks/use-ops-permissions';
import { portalWorkspace, type PortalTask } from './model';

function TaskCards({ tasks }: { tasks: PortalTask[] }) {
  return <div className="grid gap-4 md:grid-cols-3">
    {tasks.map(task => <Link key={task.id} href={task.href} className="group flex min-h-40 min-w-0 flex-col rounded-2xl border border-border bg-card p-6 shadow-sm transition-colors hover:border-primary hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <h2 className="text-lg font-semibold leading-snug">{task.title}</h2>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">{task.description}</p>
      <span className="mt-5 flex items-center gap-2 text-sm font-semibold text-primary">Открыть <ArrowRight className="size-4" aria-hidden /></span>
    </Link>)}
  </div>;
}

export function PortalWorkspace() {
  const access = useOpsPermissions();
  const client = useQueryClient();
  const tasks = portalWorkspace(access);
  return <DashboardLayout>
    <div className="mx-auto w-full max-w-5xl space-y-7 p-4 sm:p-8">
      <header>
        <p className="text-sm font-medium text-muted-foreground">Моя работа</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Что нужно сделать?</h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">Выберите задачу — откроется нужный рабочий экран.</p>
      </header>
      {access.isLoading ? <p role="status">Загружаем ваши задачи…</p> : access.error ? <section role="alert" className="rounded-xl border p-5">
        <p>Не удалось загрузить ваши рабочие разделы.</p>
        <button type="button" className="mt-3 min-h-11 font-medium text-primary underline" onClick={() => void client.resetQueries({ queryKey: ['ops-me'], exact: true })}>Повторить загрузку</button>
      </section> : <>
        <section aria-label="Основные рабочие задачи"><TaskCards tasks={tasks.primary} /></section>
        {tasks.more.length > 0 && <details className="rounded-xl border border-border bg-card p-5">
          <summary className="min-h-7 cursor-pointer text-base font-semibold">Другие рабочие задачи</summary>
          <div className="mt-5"><TaskCards tasks={tasks.more} /></div>
        </details>}
        <p className="text-sm leading-relaxed text-muted-foreground">Справочники, отчёты и остальные доступные экраны находятся в меню «Все разделы».</p>
      </>}
    </div>
  </DashboardLayout>;
}
