import { ApiHttpError } from "@/lib/api";

/**
 * Повтор запроса — только для сбоев, которые могут пройти сами.
 *
 * Отказ 4xx (нет права, нет привязки к подразделению, дурной параметр) не
 * станет успехом от повтора, а react-query по умолчанию переспросит трижды:
 * три одинаковых 403 в сети и задержка перед тем, как экран покажет причину.
 * Заведено в ручке `directorate` (гвард экранов расхода), затем понадобилось
 * справочникам должностей и званий (Plane №329) — общая копия вместо третьей.
 */
export function retryUnlessClientError(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiHttpError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 3;
}
