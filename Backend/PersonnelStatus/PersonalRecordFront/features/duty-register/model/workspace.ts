export type DutyWorkspaceSection = 'roster' | 'records' | 'shifts';
export const DUTY_WORKSPACE_HREF = '/security-ops/duty-register/';
const recordKeys = ['from', 'to', 'kind', 'state', 'source', 'attention', 'division_id', 'employee_id', 'search', 'page', 'page_size', 'view', 'record'];

export function dutyWorkspaceSection(params: URLSearchParams): DutyWorkspaceSection {
  const section = params.get('section');
  if (section === 'roster' || section === 'records' || section === 'shifts') return section;
  return recordKeys.some(key => params.has(key)) ? 'records' : 'roster';
}

export function dutyWorkspaceHref(section: DutyWorkspaceSection, params: URLSearchParams, values: Record<string, string> = {}): string {
  const next = new URLSearchParams(params);
  next.set('section', section);
  for (const [key, value] of Object.entries(values)) value ? next.set(key, value) : next.delete(key);
  if ('date' in values && values.date !== params.get('date')) {
    // A one-day control period follows the composition date. An explicitly
    // selected wider period remains independent.
    const previousDay = params.get('date');
    if (previousDay && params.get('from') === previousDay && params.get('to') === previousDay) {
      if (validDutyDate(values.date)) { next.set('from', values.date); next.set('to', values.date); }
      else { next.delete('from'); next.delete('to'); }
    }
    for (const key of ['record', 'page', 'group_page', 'roster_page']) if (!(key in values)) next.delete(key);
  }
  if (section !== 'records' && !next.has('date') && next.get('from') === next.get('to') && validDutyDate(next.get('from') ?? '')) {
    next.set('date', next.get('from')!);
  }
  if (section === 'records' && !next.has('from') && !next.has('to') && validDutyDate(next.get('date') ?? '')) {
    next.set('from', next.get('date')!); next.set('to', next.get('date')!);
  }
  return DUTY_WORKSPACE_HREF + '?' + next;
}

export function validDutyDate(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day.startsWith('0000')) return false;
  const date = new Date(day + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

export interface DutyRosterFilters {
  search: string;
  division: string;
  placement: 'all' | 'assigned' | 'unassigned';
  page: number;
}

export function dutyRosterFilters(params: URLSearchParams): DutyRosterFilters {
  const division = params.get('roster_division') ?? '';
  const placement = params.get('roster_placement');
  const page = Number(params.get('roster_page') ?? '1');
  return {
    search: (params.get('roster_search') ?? '').slice(0, 200),
    // Roster uses 0 for its explicit "Без департамента" bucket.
    division: /^(0|[1-9]\d{0,18})$/.test(division) ? division : '',
    placement: placement === 'assigned' || placement === 'unassigned' ? placement : 'all',
    page: Number.isSafeInteger(page) && page >= 1 ? page : 1,
  };
}

export function dutyRosterFilterValues(filters: DutyRosterFilters): Record<string, string> {
  return { roster_search: filters.search, roster_division: filters.division,
    roster_placement: filters.placement === 'all' ? '' : filters.placement,
    roster_page: filters.page === 1 ? '' : String(filters.page) };
}

export function shiftDutyDate(day: string, days: number): string | null {
  if (!validDutyDate(day) || !Number.isSafeInteger(days)) return null;
  const date = new Date(day + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  if (!Number.isFinite(date.getTime())) return null;
  const shifted = date.toISOString().slice(0, 10);
  return validDutyDate(shifted) ? shifted : null;
}

export function serverDutyDate(generatedAt: string, zone: string): string | null {
  try {
    const date = new Date(generatedAt);
    const parts = new Intl.DateTimeFormat('en', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
    const day = [part('year').padStart(4, '0'), part('month'), part('day')].join('-');
    return validDutyDate(day) ? day : null;
  } catch { return null; }
}
