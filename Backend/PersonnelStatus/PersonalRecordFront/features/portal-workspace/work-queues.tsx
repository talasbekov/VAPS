"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { useAssistantAccess, useAssistantConfiguration, useAssistantTasks, useAssistantWriter } from '@/features/om-assistant/api';
import { assistantDate, assistantTaskHref, assistantTaskTitle, taskPresentation } from '@/features/om-assistant/model';
import { AssistantBrief } from '@/features/om-assistant/brief';
import { useOpsProtectedRead, useOpsReadAccess } from '@/hooks/use-ops-protected-read';
import { useMyEmployee } from '@/hooks/use-my-employee';
import { MyNextShift } from '@/widgets/my-profile/ui/MyNextShift';
import { opsApiClient } from '@/lib/ops-api';
import { securityEventDepartmentRequestsPath, type DepartmentRequestRow } from '@/entities/security-event';
import { departmentWorkRow } from './desk-model';
import styles from './workspace.module.css';

export function WorkdeskComposer() {
  const router = useRouter();
  const access = useAssistantAccess();
  const config = useAssistantConfiguration();
  const [message, setMessage] = useState('');
  const writer = useAssistantWriter({ access, taskId: null }, task => router.push(assistantTaskHref(task.id)));
  const frozen = writer.pending || writer.retryable;
  return <section className={`${styles.panel} ${styles.compose}`} aria-label="Новое поручение">
    {config.data?.enabled === false ? <>
      <h2 className="text-lg font-semibold">Подготовить наряд</h2>
      <p className="my-3 text-sm text-muted-foreground">Понимание текста отключено. Укажите сведения в форме.</p>
      <Link className={styles.action} href="/security-ops/assistant/">Заполнить поручение <ArrowRight className="size-4" aria-hidden /></Link>
    </> : <AssistantBrief value={message} onChange={setMessage} disabled={frozen || !access.allowed}
      pending={writer.pending} onSubmit={() => void writer.create(message)} />}
    {config.isError && <p role="status" className="mt-3 text-sm text-muted-foreground">Не удалось проверить понимание текста. Форму можно открыть в помощнике.</p>}
    {writer.error && <div role="alert" className="mt-4 rounded-lg border border-destructive/30 p-4 text-sm">
      <p>{writer.error}</p>
      {writer.retryable && <><p className="mt-2">Ответ мог потеряться после сохранения. Повтор вернёт то же поручение.</p>
        <button type="button" disabled={writer.pending} className={styles.textLink} onClick={() => void writer.retry()}>Повторить сохранение</button></>}
    </div>}
  </section>;
}

function Refresh({ label, busy, run }: { label: string; busy: boolean; run(): void }) {
  return <button type="button" className={styles.textLink} aria-label={label} disabled={busy} onClick={run}>
    <RefreshCw className={`size-3.5 ${busy ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />Обновить
  </button>;
}

export function AssistantWorkQueue() {
  const query = useAssistantTasks();
  const data = query.isError ? undefined : query.data;
  const rows = data?.results.slice(0, 5) ?? [];
  return <section className={styles.panel} aria-label="Последние поручения">
    <div className={styles.panelHead}><h2>Последние поручения</h2><Refresh label="Обновить поручения" busy={query.isFetching} run={() => void query.refetch()} /></div>
    {query.isError ? <p className={styles.empty} role="alert">{query.readAccessBlocked ? 'Доступ к поручениям не подтверждён.' : 'Не удалось обновить поручения.'} Повторите загрузку.</p>
      : !data ? <p className={styles.empty} role="status">Загружаем поручения…</p>
      : rows.length === 0 ? <div className={styles.empty}><strong>Поручений пока нет</strong>Опишите задачу в помощнике. После сохранения здесь будет видно, кто выполняет следующий шаг.</div>
      : <ul>{rows.map(task => {
        const state = taskPresentation(task);
        return <li key={task.id}><Link href={assistantTaskHref(task.id)} className={styles.row}>
          <div className={styles.rowBody}>
            <strong>{assistantTaskTitle(task)}</strong>
            <p className={styles.meta}>{[task.plan.businessDate ? assistantDate(task.plan.businessDate) : 'Дата уточняется', task.plan.objectName,
              task.plan.personnelTotal == null ? null : `${task.plan.personnelTotal} чел.`].filter(Boolean).join(' · ')}</p>
            <div className={styles.next}><span className={styles.state} data-tone={task.status === 'needs_information' ? 'attention' : 'active'}>{state.label}</span><span>{state.owner}</span></div>
          </div><ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link></li>;
      })}</ul>}
    {!!rows.length && <div className={styles.foot}><span>Показаны последние {rows.length}. Полный список — в помощнике.</span>
      <Link className={styles.textLink} href="/security-ops/assistant/?page=1">Все поручения <ArrowRight className="size-3.5" aria-hidden /></Link></div>}
  </section>;
}

export function DepartmentWorkQueue() {
  const access = useOpsReadAccess('forces.allocate');
  const query = useOpsProtectedRead<{ results: DepartmentRequestRow[] }>(['ops-workdesk', 'department-requests'], [], access,
    () => opsApiClient.get(securityEventDepartmentRequestsPath()), { poll: () => 30000 });
  const data = query.isError ? undefined : query.data;
  const rows = [...(data?.results ?? [])].sort((a, b) => {
    const priority = (row: DepartmentRequestRow) => ({ attention: 0, active: 1, quiet: 2 })[departmentWorkRow(row).tone];
    return priority(a) - priority(b);
  }).slice(0, 6);
  return <section className={styles.panel} aria-label="Запросы вашему департаменту">
    <div className={styles.panelHead}><h2>Запросы вашему департаменту</h2><Refresh label="Обновить запросы" busy={query.isFetching} run={() => void query.refetch()} /></div>
    {query.isError ? <p role="alert" className={styles.empty}>Не удалось обновить запросы. Повторите загрузку.</p>
      : !data ? <p role="status" className={styles.empty}>Загружаем запросы…</p>
      : rows.length === 0 ? <div className={styles.empty}><strong>Запросов пока нет</strong>Когда Штаб запросит людей, поручение появится здесь.</div>
      : <ul>{rows.map(row => {
        const work = departmentWorkRow(row);
        return <li key={row.allocationId}><Link href={work.href} className={styles.row}>
          <div className={styles.rowBody}><strong>{row.title}</strong>
            <p className={styles.meta}>{assistantDate(row.businessDate)} · {row.departmentName}<br />{work.detail}</p>
            <div className={styles.next}><span className={styles.state} data-tone={work.tone}>{work.status}</span><span>{work.action}</span></div>
          </div><ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link></li>;
      })}</ul>}
    {!!rows.length && <div className={styles.foot}><span>Сначала запросы, требующие ответа.</span>
      <Link href="/employees?view=forces&tab=requests" className={styles.textLink}>Все запросы <ArrowRight className="size-3.5" aria-hidden /></Link></div>}
  </section>;
}

export function PersonalWork() {
  const me = useMyEmployee();
  if (me.isError) return <div className={`${styles.panel} ${styles.empty}`} role="alert">Не удалось загрузить вашу кадровую запись.
    <button className={`${styles.textLink} ml-2`} disabled={me.isFetching} onClick={() => void me.refetch()}>Повторить загрузку профиля</button></div>;
  if (!me.data) return <p className={styles.empty} role="status">Загружаем личные назначения…</p>;
  if (!me.data.employee) return <section className={`${styles.panel} ${styles.empty}`}><strong>Нужно связать учётную запись с сотрудником</strong>
    {me.data.unlinked_reason || 'Обратитесь к администратору доступа. После привязки здесь появятся ваши назначения.'}</section>;
  return <MyNextShift employeeId={String(me.data.employee.id)} />;
}
