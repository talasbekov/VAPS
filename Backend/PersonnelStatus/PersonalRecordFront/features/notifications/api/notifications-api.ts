import { getAccessToken } from "@/lib/api";
import { apiClient, type OpsNotification as OpsNotificationRow } from "@/lib/api";
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
  /** Откуда строка — какому бэкенду отвечать при отметке прочтения (Plane
   *  №402). Легаси-лента и лента раздела ОМ — РАЗНЫЕ модели с разными
   *  ручками; без метки клиент не знает, каким глаголом отметить прочитанным
   *  ЭТУ строку. */
  source: "legacy" | "ops";
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

/** Заголовок и текст уведомления раздела ОМ — у `OpsNotification` их нет
 *  вовсе (сервер отдаёт факт: вид + сырой payload), формулировку складывает
 *  экран (Plane №402). Один `kind` живёт здесь один раз — второе место, где
 *  выдумывался бы текст, разошлось бы с этим при первой же правке подписи. */
function describeOpsNotification(row: OpsNotificationRow): { title: string; message: string } {
  if (row.kind === "EVENT_ACKNOWLEDGEMENT") {
    const p = row.payload;
    const event = `${p.eventCode ?? ""} ${p.eventTitle ?? ""}`.trim();
    // Пустое имя объекта — у ОМ без привязки к объекту реестра (снимок
    // 03.09.2026: «объект «»»). Пустые кавычки читаются как сбой; словами —
    // как факт.
    const object = p.objectName ? `объект «${p.objectName}»` : "объект не указан";
    const message = `${event} · ${object} · ${p.businessDate ?? ""}`;
    return p.asSupervisor === true
      ? { title: "Подчинённый заступает на мероприятие", message }
      : { title: "Вы назначены на мероприятие", message };
  }
  return {
    title: "Отставание по сдаче",
    message: `Подразделений без сдачи: ${row.payload.laggard_division_ids?.length ?? 0}`,
  };
}

/** Обе ленты — легаси (`/api/notifications/`) и раздела ОМ
 *  (`/api/operations/notifications/`) — СЛИТЫ в одну (Plane №402, `[ОЗН-01]`).
 *
 * 🔴 ДО ЭТОЙ ПРАВКИ КОЛОКОЛЬЧИК ЧИТАЛ ТОЛЬКО ЛЕГАСИ-ЛЕНТУ. Уведомления о
 * заступлении (`EVENT_ACKNOWLEDGEMENT`) пишутся в `OpsNotification` —
 * ВТОРУЮ, более новую модель раздела (`operations/api/views.py`,
 * `NotificationViewSet`) — и колокольчик их не видел: запись создавалась,
 * `unread-count` рос, а хедер показывал «Нет новых уведомлений». Слияние, а
 * не переезд: легаси-лента несёт СВОИ виды уведомлений (не ОМ), и снимать её
 * не входит в рамки этой задачи.
 */
export async function fetchUnreadNotifications(): Promise<Notification[]> {
  const [legacyRes, opsPage] = await Promise.all([
    authorizedFetch(`${BASE}/unread/`).then((r) => r.json()) as Promise<
      Omit<Notification, "source">[]
    >,
    apiClient.getOpsNotifications({ unread: true }),
  ]);
  const legacy: Notification[] = legacyRes.map((row) => ({ ...row, source: "legacy" }));
  const ops: Notification[] = opsPage.results.map((row) => {
    const { title, message } = describeOpsNotification(row);
    return {
      id: row.id,
      notification_type: row.kind,
      title,
      message,
      link: null,
      is_read: row.read_at !== null,
      created_at: row.created_at,
      source: "ops",
    };
  });
  // Свежие сверху — сортировка по времени, а не конкатенация: иначе лента
  // читалась бы как «сначала все легаси, потом все ОМ» вместо «что новее».
  return [...legacy, ...ops].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function markAllRead(): Promise<void> {
  await Promise.all([
    authorizedFetch(`${BASE}/mark_all_read/`, { method: "POST" }),
    apiClient.markAllOpsNotificationsRead(),
  ]);
}

export async function markNotificationRead(notification: Notification): Promise<void> {
  if (notification.source === "ops") {
    await apiClient.markOpsNotificationRead(notification.id);
    return;
  }
  await authorizedFetch(`${BASE}/${notification.id}/mark_read/`, { method: "POST" });
}
