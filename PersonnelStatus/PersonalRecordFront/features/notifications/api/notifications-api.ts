import { getAccessToken } from "@/lib/api";
import { BACKEND_URL } from "@/shared/config/env";

const BASE = "/api/notifications/notifications";

export interface Notification {
  id: number;
  notification_type: string;
  title: string;
  message: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

function buildUrl(endpoint: string) {
  return `${BACKEND_URL}${endpoint}`;
}

async function authorizedFetch(endpoint: string, init?: RequestInit) {
  const token = await getAccessToken();
  const headers: Record<string, string> = { accept: "application/json" };
  if (init?.headers) Object.assign(headers, init.headers as any);
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(buildUrl(endpoint), { ...init, headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

export async function fetchUnreadNotifications(): Promise<Notification[]> {
  const res = await authorizedFetch(`${BASE}/unread/`);
  return res.json();
}

export async function markAllRead(): Promise<void> {
  await authorizedFetch(`${BASE}/mark_all_read/`, { method: "POST" });
}

export async function markNotificationRead(id: number): Promise<void> {
  await authorizedFetch(`${BASE}/${id}/mark_read/`, { method: "POST" });
}
