import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';
import type { SecurityEvent } from '@/entities/security-event';

// Navigation suites can reuse a real authenticated session. This keeps a long
// UX run within the same production login budget as a user browsing the app.
// Login/logout tests leave this opt-in unset and continue exercising sign-in.
const reuseAuth = process.env.UX_REUSE_AUTH === '1';
const sessionCookies = new Map<string, Awaited<ReturnType<APIRequestContext['storageState']>>['cookies']>();
const apiTokens = new Map<string, string>();
const contextTokens = new WeakMap<APIRequestContext, { key: string; access: string }>();
// A failed Playwright test restarts its worker. Keep the genuine navigation
// session in the ignored results directory so that restart is not a new login.
const authCacheFile = reuseAuth && process.env.UX_RESULTS_DIR ? path.join(process.env.UX_RESULTS_DIR, 'auth-state.private.json') : undefined;
if (authCacheFile && fs.existsSync(authCacheFile)) {
  const saved = JSON.parse(fs.readFileSync(authCacheFile, 'utf8'));
  for (const [key, value] of saved.sessions ?? []) sessionCookies.set(key, value);
  for (const [key, value] of saved.tokens ?? []) apiTokens.set(key, value);
}
function persistNavigationAuth() {
  if (!authCacheFile) return;
  fs.mkdirSync(path.dirname(authCacheFile), { recursive: true });
  const temporary = authCacheFile + '.' + process.pid + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify({ sessions: [...sessionCookies], tokens: [...apiTokens] }), { mode: 0o600 });
  fs.renameSync(temporary, authCacheFile);
}

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
  const key = `${process.env.SMOKE_APP ?? ''}:${username}`;
  const cached = reuseAuth ? sessionCookies.get(key) : undefined;
  if (cached) {
    await page.context().addCookies(cached);
    const response = await page.request.get('/api/auth/session/');
    const session = response.ok() ? await response.json() : undefined;
    if (session?.user?.name === username && session.user.accessToken && !session.error) {
      sessionCookies.set(key, await page.context().cookies());
      persistNavigationAuth();
      return;
    }
    sessionCookies.delete(key);
  }
  const csrf = await (await page.request.get('/api/auth/csrf/')).json();
  const response = await page.request.post('/api/auth/callback/credentials/', {
    form: { csrfToken: csrf.csrfToken, username, password: STAND_PASSWORD, json: 'true' },
  });
  expect((await response.json()).url, 'Authenticated UI is required').not.toContain('error=');
  if (reuseAuth) {
    sessionCookies.set(key, await page.context().cookies());
    persistNavigationAuth();
  }
}

export async function apiAccessToken(request: APIRequestContext): Promise<string> {
  const api = process.env.SMOKE_API;
  if (!api) throw new Error('SMOKE_API must identify the isolated local API');
  const key = `${api}:${STAND_USERNAME}`;
  const local = contextTokens.get(request);
  let access = reuseAuth ? apiTokens.get(key) : local?.key === key ? local.access : undefined;
  if (access) {
    const expiresAt = JSON.parse(Buffer.from(access.split('.')[1], 'base64url').toString()).exp;
    if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= Date.now() + 30_000) access = undefined;
  }
  if (!access) {
    const token = await request.post(api + '/api/token/', { data: { username: STAND_USERNAME, password: STAND_PASSWORD } });
    expect(token.ok()).toBeTruthy();
    access = (await token.json()).access as string;
    if (reuseAuth) {
      apiTokens.set(key, access);
      persistNavigationAuth();
    } else contextTokens.set(request, { key, access });
  }
  return access;
}

export async function readApi(request: APIRequestContext, endpoint: string, retryExpiredToken = true): Promise<any> {
  const api = process.env.SMOKE_API!;
  const response = await request.get(api + endpoint, { headers: { Authorization: `Bearer ${await apiAccessToken(request)}` } });
  if (retryExpiredToken && response.status() === 401) {
    apiTokens.delete(`${api}:${STAND_USERNAME}`);
    contextTokens.delete(request);
    persistNavigationAuth();
    return readApi(request, endpoint, false);
  }
  expect(response.ok()).toBeTruthy();
  return response.json();
}

export async function readEvent(request: APIRequestContext, retryExpiredToken = true): Promise<SecurityEvent> {
  const registry = await readApi(request, '/api/ops/security-events/?page_size=100', retryExpiredToken);
  const event = registry.results.find((row: SecurityEvent) => row.reconSectorPosts.length > 0 && row.visitObjects.length > 0 &&
    row.forceRoster.length > 0 && row.placementAssignments.length > 0 && row.visitObjects.some(visit => visit.approvalRoute.length > 0));
  if (!event) throw new Error('A real event with posts, a visit, approvers, an accepted roster and an assignment is required for UX verification');
  return event;
}

export { expect };
