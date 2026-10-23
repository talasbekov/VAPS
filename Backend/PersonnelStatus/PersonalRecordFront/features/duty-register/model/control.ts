import type { DutyRegisterSnapshot } from '@/entities/duty-register';

/** One denial or a midnight date change invalidates the entire officer card. */
export async function readDutyControl(get: (endpoint: string) => Promise<DutyRegisterSnapshot>) {
  const [overview, active] = await Promise.all([
    get('/api/ops/duty-register/?preset=TODAY&page_size=1'),
    get('/api/ops/duty-register/?preset=TODAY&state=ACTIVE&page_size=5'),
  ]);
  if (overview.period.from !== active.period.from || overview.period.to !== active.period.to || overview.time_zone !== active.time_zone) {
    throw new Error('Данные контроля относятся к разным датам. Повторите загрузку.');
  }
  return { overview, active };
}
