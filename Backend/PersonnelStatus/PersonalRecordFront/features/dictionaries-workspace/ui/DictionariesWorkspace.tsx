"use client";

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BookOpen, ChevronRight, Search } from 'lucide-react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { LoadFailure } from '@/components/load-failure';
import { useDictionaries } from '@/hooks/use-dictionaries';
import { useOpsPermissions } from '@/hooks/use-ops-permissions';
import type { DictionaryDefinitionSummary } from '@/entities/dictionary';

const ROOT = '/security-ops/dictionaries';
const GROUPS = ['Охранные мероприятия', 'Кадровые справочники', 'География'] as const;

export function dictionaryHref(row: DictionaryDefinitionSummary): string {
  return `${ROOT}/${row.screen ?? row.code}`;
}

function groupOf(row: DictionaryDefinitionSummary): typeof GROUPS[number] {
  if (row.screen?.startsWith('personnel/')) return 'Кадровые справочники';
  if (row.screen?.startsWith('geo/')) return 'География';
  return 'Охранные мероприятия';
}

export function DictionariesWorkspace({ children }: { children: ReactNode }) {
  const pathname = usePathname().replace(/\/+$/, '');
  const router = useRouter();
  const { hasPermission, isLoading } = useOpsPermissions();
  const canChoose = !isLoading && hasPermission('dictionary.view');
  const query = useDictionaries({ enabled: canChoose });
  const [search, setSearch] = useState('');
  const definitions = query.data?.results ?? [];
  const term = search.trim().toLocaleLowerCase();
  const matches = useMemo(() => definitions.filter(row => `${row.label} ${row.code} ${row.description}`.toLocaleLowerCase().includes(term)), [definitions, term]);
  const groups = GROUPS.map(label => ({ label, rows: matches.filter(row => groupOf(row) === label) })).filter(group => group.rows.length > 0);
  const current = definitions.find(row => dictionaryHref(row) === pathname);
  const registries = hasPermission('catalog.view') ? [
    { label: 'Охраняемые лица', href: '/security-ops/persons' },
    { label: 'Законы и нормативные документы', href: '/security-ops/laws' },
  ] : [];

  if (!canChoose) return <DashboardLayout>{children}</DashboardLayout>;

  return (
    <DashboardLayout>
      <div className="grid min-w-0 gap-5 xl:grid-cols-[240px_minmax(0,1fr)] xl:items-start">
        <div className="min-w-0 xl:hidden">
          {query.isError ? (
            <LoadFailure what="перечень справочников" onRetry={() => void query.refetch()} isRetrying={query.isFetching} />
          ) : (
            <label className="block space-y-1.5 text-sm font-medium">
              <span>Выбрать справочник</span>
              <select
                aria-label="Выбрать справочник"
                className="h-11 w-full min-w-0 rounded-md border bg-card px-3 text-sm"
                disabled={query.isLoading}
                value={current ? dictionaryHref(current) : ROOT}
                onChange={event => router.push(event.target.value)}
              >
                <option value={ROOT}>{query.isLoading ? 'Загрузка справочников…' : 'Обзор справочников'}</option>
                {GROUPS.map(group => (
                  <optgroup key={group} label={group}>
                    {definitions.filter(row => groupOf(row) === group).map(row => <option key={row.code} value={dictionaryHref(row)}>{row.label}</option>)}
                  </optgroup>
                ))}
                {registries.length > 0 && <optgroup label="Отдельные реестры">{registries.map(row => <option key={row.href} value={row.href}>{row.label}</option>)}</optgroup>}
              </select>
            </label>
          )}
        </div>

        <nav aria-label="Выбор справочника" className="hidden min-w-0 rounded-xl border bg-card xl:sticky xl:top-4 xl:block">
          <div className="space-y-3 border-b p-3">
            <Link href={ROOT} className="flex min-h-9 items-center gap-2 text-sm font-semibold text-primary-ink" aria-current={pathname === ROOT ? 'page' : undefined}>
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              Справочники
            </Link>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input aria-label="Поиск справочников" placeholder="Найти справочник" className="h-10 pl-9" value={search} onChange={event => setSearch(event.target.value)} />
            </div>
          </div>
          <div className="max-h-[calc(100vh-240px)] overflow-y-auto p-2">
            {query.isLoading ? <p role="status" className="p-2 text-sm text-muted-foreground">Загрузка справочников…</p>
              : query.isError ? <LoadFailure what="перечень справочников" onRetry={() => void query.refetch()} isRetrying={query.isFetching} />
              : matches.length === 0 ? (
                <div className="space-y-2 p-2">
                  <p role="status" className="text-sm text-muted-foreground">{term ? 'Справочники не найдены.' : 'Справочников пока нет.'}</p>
                  {term && <Button variant="outline" size="sm" onClick={() => setSearch('')} aria-label="Сбросить поиск справочников">Сбросить поиск</Button>}
                </div>
              ) : groups.map(group => (
                <section key={group.label} className="mb-3 last:mb-0">
                  <h2 className="px-2 py-2 text-xs font-semibold text-muted-foreground">{group.label}</h2>
                  <ul className="space-y-1">
                    {group.rows.map(row => {
                      const href = dictionaryHref(row), selected = href === pathname;
                      return <li key={row.code}>
                        <Link href={href} aria-label={row.label} aria-current={selected ? 'page' : undefined}
                          title={`${row.activeCount} активных из ${row.totalCount} значений`}
                          className={`flex min-h-10 items-center gap-2 rounded-lg px-2 py-2 text-sm ${selected ? 'bg-primary/10 font-semibold text-primary-ink' : 'hover:bg-muted'}`}>
                          <span className="min-w-0 flex-1 break-words">{row.label}</span>
                          <span aria-hidden="true" className="shrink-0 text-xs tabular-nums text-muted-foreground">{row.activeCount}/{row.totalCount}</span>
                          {selected && <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                        </Link>
                      </li>;
                    })}
                  </ul>
                </section>
              ))}
            {!query.isError && registries.length > 0 && term === '' && <section className="mt-3 border-t pt-2">
              <h2 className="px-2 py-2 text-xs font-semibold text-muted-foreground">Отдельные реестры</h2>
              {registries.map(row => <Link key={row.href} href={row.href} className="flex min-h-10 items-center px-2 py-2 text-sm hover:bg-muted">{row.label}</Link>)}
            </section>}
          </div>
          {!query.isLoading && !query.isError && definitions.length > 0 && <p className="border-t px-3 py-2 text-xs text-muted-foreground">В счётчиках: активных / всего значений</p>}
        </nav>

        <div className="min-w-0" data-slot="dictionary-values">{children}</div>
      </div>
    </DashboardLayout>
  );
}
