export type AssignmentKind = 'all' | 'events' | 'shifts';
export type AssignmentPeriod = 'all' | 'current' | 'upcoming';

export function profileBusinessDate(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Almaty' }).format(now);
}

export function matchesAssignmentPeriod(from: string, to: string | null, period: AssignmentPeriod, today: string): boolean {
  if (period === 'all') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return false;
  if (period === 'upcoming') return from > today;
  const end = to && to >= from ? to : from;
  return from <= today && today <= end;
}
