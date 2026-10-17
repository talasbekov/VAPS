import { ACCESS_USER_ROLES_PATH, type AccessUserRole, type ListAccessUserRolesResponse } from './index';
import { OpsNetworkError } from '@/lib/ops-errors';

/** Read this account's complete assignment history before filtering active grants. */
export async function loadUserRoleAssignments(
  userId: number,
  get: (endpoint: string) => Promise<ListAccessUserRolesResponse>,
): Promise<ListAccessUserRolesResponse> {
  const results: AccessUserRole[] = [];
  const visited = new Set<string>();
  let next: string | null = `${ACCESS_USER_ROLES_PATH}?user_id=${encodeURIComponent(String(userId))}`;
  while (next !== null) {
    let url: URL;
    try {
      url = new URL(next, 'https://ops-api.invalid');
    } catch (cause) {
      throw new OpsNetworkError('Неверный адрес страницы назначений.', { cause });
    }
    if (url.pathname !== ACCESS_USER_ROLES_PATH ||
        !['http:', 'https:'].includes(url.protocol) || url.hash !== '' ||
        url.searchParams.getAll('user_id').length !== 1 || url.searchParams.get('user_id') !== String(userId)) {
      throw new OpsNetworkError('Неверный адрес страницы назначений.');
    }
    // Backend pagination may mention its internal host. Keep only the validated
    // local endpoint and this account's filter; never request another origin.
    url.searchParams.sort();
    const endpoint = `${url.pathname}?${url.searchParams}`;
    if (visited.has(endpoint)) throw new OpsNetworkError('Список назначений повторяет страницу.');
    visited.add(endpoint);
    const body = await get(endpoint);
    if (!Array.isArray(body.results) || (body.next !== null && typeof body.next !== 'string') ||
        (body.results.length === 0 && body.next !== null) ||
        body.results.some(row => String(row.user_id) !== String(userId))) {
      throw new OpsNetworkError('Некорректный ответ списка назначений.');
    }
    results.push(...body.results);
    next = body.next;
  }
  return { count: results.length, next: null, previous: null, results };
}
