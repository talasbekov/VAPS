import { expect, test } from '@playwright/test';
import { defaultPortalRoute, moduleOpenFor } from '../entities/portal-access';

test('service summary requires both permissions and no specific role name', () => {
  const open = (permissions: string[], role = '') => moduleOpenFor('/security-ops/service-summary', code => permissions.includes('*') || permissions.includes(code), code => code === role);
  expect(open(['status.view', 'service_summary.view'])).toBe(true);
  expect(open(['status.view'], 'DUTY_OFFICER')).toBe(false);
  expect(open(['service_summary.view'], 'DUTY_OFFICER')).toBe(false);
  expect(open([], 'DUTY_OFFICER')).toBe(false);
  expect(open(['*'])).toBe(true);
  expect(defaultPortalRoute(code => ['status.view', 'service_summary.view'].includes(code))).toBe('/security-ops/service-summary');
});
