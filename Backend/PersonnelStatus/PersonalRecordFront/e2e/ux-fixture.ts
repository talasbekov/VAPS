import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';
import type { SecurityEvent } from '@/entities/security-event';

export const test = base.extend<{ businessWrites: string[] }>({
  businessWrites: async ({ page }, use) => {
    const writes: string[] = [];
    await page.route('**/api/**', route => {
      const request = route.request();
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !new URL(request.url()).pathname.startsWith('/api/auth/')) {
        writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
        return route.fulfill({ status: 403, json: { detail: 'Business writes are blocked by the UX test' } });
      }
      return route.fallback();
    });
    await use(writes);
    expect(writes, 'UX navigation must not change any business records').toEqual([]);
  },
});

export async function signIn(page: Page, username = STAND_USERNAME) {
  const csrf = await (await page.request.get('/api/auth/csrf/')).json();
  const response = await page.request.post('/api/auth/callback/credentials/', {
    form: { csrfToken: csrf.csrfToken, username, password: STAND_PASSWORD, json: 'true' },
  });
  expect((await response.json()).url, 'Authenticated UI is required').not.toContain('error=');
}

export async function readEvent(request: APIRequestContext): Promise<SecurityEvent> {
  const api = process.env.SMOKE_API;
  if (!api) throw new Error('SMOKE_API must identify the isolated local API');
  const token = await request.post(api + '/api/token/', { data: { username: STAND_USERNAME, password: STAND_PASSWORD } });
  expect(token.ok()).toBeTruthy();
  const { access } = await token.json();
  const response = await request.get(api + '/api/ops/security-events/?page_size=100', { headers: { Authorization: `Bearer ${access}` } });
  expect(response.ok()).toBeTruthy();
  const registry = await response.json();
  const event = registry.results.find((row: SecurityEvent) => row.reconSectorPosts.length > 0 && row.visitObjects.length > 0 &&
    row.forceRoster.length > 0 && row.placementAssignments.length > 0 && row.visitObjects.some(visit => visit.approvalRoute.length > 0));
  if (!event) throw new Error('A real event with posts, a visit, approvers, an accepted roster and an assignment is required for UX verification');
  return event;
}

export { expect };
