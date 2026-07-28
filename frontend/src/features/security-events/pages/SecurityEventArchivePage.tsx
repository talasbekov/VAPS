// Smart Josparlau «Архив дела» (прототип Smart Josparlau.dc.html:1459-1490):
// read-only дело закрытого ОМ. Мастер-промпт L5643 — «архив открывается только
// в read-only режиме», L6309 — «архивные данные не редактируются обычной
// mutation».
//
// ⚠️ Read-only здесь — не пожелание, а свойство модуля: страница НЕ импортирует
// ни одного мутирующего хука (`useApiMutation`-обёртки из `api/queries`) и не
// рендерит ни одного `<button>`/`<input>`/`<textarea>`/`<select>`. Это
// закреплено ассертом в `SecurityEventArchivePage.test.tsx` — правка вёрстки,
// которая протащит сюда действие, покраснеет.
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { ROUTES } from '../../../shared/routes'
import { useSecurityEvent } from '../api/queries'
import type { JournalEntry, SecurityEvent } from '../model/types'
import {
  ARCHIVE_TITLE,
  NOT_ACKNOWLEDGED_TEXT,
  NOT_ASSIGNED_TEXT,
  NOT_CLOSED_TEXT,
  NO_PLACEMENT_VERSIONS_TEXT,
  READ_ONLY_BADGE,
  ACKNOWLEDGED_TEXT,
  buildArchiveCase,
  isArchiveOpen,
} from '../lib/archiveCase'
import { JOURNAL_TYPE_LABEL, STAGE_LABEL, stageBadgeVariants } from '../lib/stageMeta'

export function SecurityEventArchivePage() {
  const { id } = useParams<{ id: string }>()
  const query = useSecurityEvent(id ?? '')

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Загрузка дела…</p>
  }
  if (query.isError || query.data === undefined) {
    return (
      <div>
        <p className="text-sm text-destructive">
          Мероприятие не найдено или недоступно.
        </p>
        <Link
          to={ROUTES.securityEvents}
          className="mt-2 inline-block text-sm font-semibold text-primary"
        >
          ← Назад к реестру
        </Link>
      </div>
    )
  }

  const event = query.data

  return (
    <div>
      <Link
        to={ROUTES.securityEventDetailTo(event.id)}
        className="mb-3 inline-block text-xs font-semibold text-primary"
      >
        ← Назад к карточке ОМ
      </Link>

      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
            После закрытия
          </p>
          <h1 className="text-2xl font-bold tracking-tight">
            {ARCHIVE_TITLE} · {event.code}
          </h1>
          <span className="text-sm text-slate-600">
            {event.title} · {event.businessDate} · {event.objectName} ·{' '}
            {event.ownerName}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={stageBadgeVariants({ stage: event.stage })}>
            {STAGE_LABEL[event.stage]}
          </span>
          <span className="inline-flex rounded-full bg-muted px-3 py-1 text-[11.5px] font-semibold text-slate-600">
            {READ_ONLY_BADGE}
          </span>
        </div>
      </header>

      {!isArchiveOpen(event) ? (
        <section className="rounded-xl border bg-card p-9 text-center">
          <p className="text-sm text-slate-600">{NOT_CLOSED_TEXT}</p>
          <Link
            to={ROUTES.securityEventDetailTo(event.id)}
            className="mt-3 inline-block text-sm font-semibold text-primary"
          >
            Открыть карточку ОМ
          </Link>
        </section>
      ) : (
        <ArchiveBody event={event} />
      )}
    </div>
  )
}

function ArchiveBody({ event }: { event: SecurityEvent }) {
  const archive = buildArchiveCase(event)

  return (
    <div className="flex flex-col gap-3.5">
      <section
        className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Состав дела"
      >
        {archive.sections.map((section) => (
          <article key={section.key} className="rounded-xl border bg-card p-3.5">
            <div className="text-[13px] font-semibold">{section.title}</div>
            {section.count !== null && (
              <div className="mt-1 text-xl font-bold tabular-nums">
                {section.count}
              </div>
            )}
            <p className="mt-1 text-[11.5px] leading-relaxed text-slate-600">
              {section.note}
            </p>
          </article>
        ))}
      </section>

      <Panel title="Закрытие">
        <p className="mb-2.5 text-sm font-semibold text-green-800">
          Мероприятие закрыто
          {archive.closedAt !== null ? ` · ${archive.closedAt}` : ''}
        </p>
        {archive.missingClosureDirections.length > 0 && (
          <p className="mb-2.5 text-xs text-amber-700">
            Без итога остались направления:{' '}
            {archive.missingClosureDirections.join(', ')}
          </p>
        )}
        <div className="flex flex-col gap-2">
          {event.closureDirectionSummaries.map((item) => (
            <div key={item.direction} className="rounded-md border p-2.5">
              <div className="text-sm font-semibold">{item.direction}</div>
              <p className="text-xs text-slate-600">{item.summary}</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Карточка, бюллетень, задачи">
        <Field label="Краткое описание" value={event.briefDescription} />
        <Field label="Первичные задачи направлениям" value={event.initialTasks} />
      </Panel>

      <Panel title="Рекогносцировка">
        <ul className="mb-3 flex flex-col gap-1">
          {event.reconChecklist.map((item) => (
            <li key={item.id} className="text-xs text-slate-600">
              {item.done ? '✓' : '—'} {item.label}
            </li>
          ))}
        </ul>
        {event.reconSectorPosts.length === 0 ? (
          <Empty text="Посты и секторы не рассчитывались." />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {event.reconSectorPosts.map((post) => (
              <li key={post.id} className="rounded-md border p-2.5 text-xs">
                <span className="font-semibold">
                  {post.sector} · {post.post}
                </span>{' '}
                <span className="text-slate-600">
                  {post.task} · потребность {post.need}
                  {post.requirements !== '' ? ` · ${post.requirements}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Расчёты и заявки">
        {event.demandRows.length === 0 ? (
          <Empty text="Потребность не рассчитывалась." />
        ) : (
          <ul className="mb-3 flex flex-col gap-1.5">
            {event.demandRows.map((row) => (
              <li key={row.id} className="rounded-md border p-2.5 text-xs">
                <span className="font-semibold">
                  {row.sector} · {row.task}
                </span>{' '}
                <span className="text-slate-600">
                  {row.shift} · {row.need} чел. · {row.group}
                </span>
              </li>
            ))}
          </ul>
        )}
        {event.forceRequests.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {event.forceRequests.map((request) => (
              <li key={request.id} className="rounded-md border p-2.5 text-xs">
                <span className="font-semibold">{request.group}</span>{' '}
                <span className="text-slate-600">
                  запрошено {request.requestedCount}, выделено{' '}
                  {request.allocatedCount}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Расстановка на момент закрытия">
        {archive.postGroups.length === 0 ? (
          <Empty text="Расстановка не формировалась." />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {archive.postGroups.map((group, index) => (
              <li
                key={group.isOrphan ? `orphan-${index}` : group.postId}
                className="rounded-md border p-2.5 text-xs"
              >
                <span className="font-semibold">
                  {group.sector}
                  {group.isOrphan ? '' : ` · ${group.post}`}
                </span>
                {group.need !== null && (
                  <span className="text-slate-600"> · потребность {group.need}</span>
                )}
                <ul className="mt-1 flex flex-col gap-0.5">
                  {group.assignees.length === 0 ? (
                    <li className="text-slate-600">{NOT_ASSIGNED_TEXT}</li>
                  ) : (
                    group.assignees.map((assignee) => (
                      <li key={assignee.id} className="text-slate-600">
                        {assignee.name} —{' '}
                        {assignee.acknowledged
                          ? ACKNOWLEDGED_TEXT
                          : NOT_ACKNOWLEDGED_TEXT}
                      </li>
                    ))
                  )}
                </ul>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11.5px] leading-relaxed text-slate-600">
          {NO_PLACEMENT_VERSIONS_TEXT}
        </p>
        {event.placementAssignments.length > 0 && (
          <Link
            to={ROUTES.printPlacementTo(event.id)}
            className="mt-2 inline-block text-xs font-semibold text-primary"
          >
            Печатная форма расстановки
          </Link>
        )}
      </Panel>

      <Panel title="Изменения и замены">
        {archive.replacements.length === 0 ? (
          <Empty text="Замен состава не было." />
        ) : (
          <JournalList entries={archive.replacements} />
        )}
      </Panel>

      <Panel title="Журнал штаба, инциденты">
        {archive.journal.length === 0 ? (
          <Empty text="Записей журнала не было." />
        ) : (
          <JournalList entries={archive.journal} />
        )}
      </Panel>
    </div>
  )
}

function JournalList({ entries }: { entries: JournalEntry[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {entries.map((entry) => (
        <li key={entry.id} className="rounded-md border p-2.5 text-xs">
          <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-bold text-slate-600">
            {JOURNAL_TYPE_LABEL[entry.type]}
          </span>{' '}
          <span className="font-semibold">{entry.title}</span>
          <p className="mt-1 text-slate-600">{entry.description}</p>
          <p className="mt-0.5 text-[10.5px] text-slate-600">{entry.createdAt}</p>
        </li>
      ))}
    </ul>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-2.5 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2.5">
      <div className="text-[11.5px] font-bold text-slate-600">{label}</div>
      <p className="text-sm">{value.trim() === '' ? 'Не заполнялось' : value}</p>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="text-xs text-slate-600">{text}</p>
}
