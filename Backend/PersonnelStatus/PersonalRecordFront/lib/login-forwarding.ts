import { isIP } from 'node:net';

/** Enabled only where nginx is the sole published frontend entrypoint. */
export function loginForwardingHeaders(headers: Readonly<Record<string, unknown>> | undefined): Record<string, string> {
  if (process.env.TRUST_LOGIN_PROXY_HEADER !== '1') return {};
  const value = headers?.['x-real-ip'];
  if (typeof value !== 'string' || !isIP(value.trim())) return {};
  // Nginx overwrites X-Real-IP; never forward user-supplied XFF or auth headers.
  return { 'X-Forwarded-For': value.trim() };
}
