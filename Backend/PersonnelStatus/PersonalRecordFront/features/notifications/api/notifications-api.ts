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
function describeOpsNotification(row: OpsNotificationRow): {
  title: string;
  message: string;
  link: string | null;
} {
  if (row.kind === "FORCES_REQUEST") {
    // Запрос сил управлению (Plane №392, `[СБС-22]`): «Выделите N сотрудников
    // на ОМ-… (дата)». Ссылка ведёт в «Статусы сотрудников» — там начальник
    // управления отмечает людей (`[СБС-30]`/`[СБС-31]`, Plane №394/№395);
    // баннер запроса на том экране — их шаг, здесь только адрес.
    const p = row.payload;
    const need = p.need ?? 0;
    return {
      title: `Выделите ${need} сотрудников на ${p.eventCode ?? "мероприятие"}`,
      message: `${p.eventTitle ?? ""} · ${p.businessDate ?? ""} · запрос от ${p.departmentName ?? "департамента"}`,
      link: p.allocationId
        ? `/statuses/?forcesRequest=${encodeURIComponent(p.allocationId)}`
        : "/statuses/",
    };
  }
  if (row.kind === "PLACEMENT_RETURNED") {
    // Возврат расстановки объекта с согласования (Plane №400, `[ВОЗ-03]`):
    // «Расстановка по объекту „…“ возвращена: N замечаний». Ссылка ведёт в
    // карточку СРАЗУ на этот объект (`?visit=`): чинить замечания — там, над
    // деревом постов (№397). «Срочно» — словом в заголовке, не только цветом.
    const p = row.payload;
    const object = p.objectName ? `«${p.objectName}»` : "(объект не указан)";
    const n = p.remarksOpen ?? 0;
    const remarks =
      n === 1 ? "1 замечание" : n >= 2 && n <= 4 ? `${n} замечания` : `${n} замечаний`;
    return {
      title: `${p.urgent ? "Срочно: " : ""}Расстановка по объекту ${object} возвращена: ${remarks}`,
      message: `${p.eventCode ?? ""} ${p.eventTitle ?? ""} · ${p.businessDate ?? ""}${p.comment ? ` · ${p.comment}` : ""}`.trim(),
      link:
        p.eventId && p.visitObjectId
          ? `/security-ops/events/${p.eventId}/?visit=${encodeURIComponent(p.visitObjectId)}`
          : p.eventId
            ? `/security-ops/events/${p.eventId}/`
            : null,
    };
  }
  if (row.kind === "EVENT_ACKNOWLEDGEMENT") {
    const p = row.payload;
    const event = `${p.eventCode ?? ""} ${p.eventTitle ?? ""}`.trim();
    // Пустое имя объекта — у ОМ без привязки к объекту реестра (снимок
    // 03.09.2026: «объект «»»). Пустые кавычки читаются как сбой; словами —
    // как факт.
    const object = p.objectName ? `объект «${p.objectName}»` : "объект не указан";
    const message = `${event} · ${object} · ${p.businessDate ?? ""}`;
    const link = p.eventId ? `/security-ops/events/${p.eventId}/` : null;
    return p.asSupervisor === true
      ? { title: "Подчинённый заступает на мероприятие", message, link }
      : { title: "Вы назначены на мероприятие", message, link };
  }
  if (row.kind === "FORCES_RESPONSE") {
    // Департамент ответил штабу «Выделяем: X» (Plane №426, `[СБС-12]`).
    // Уведомление адресовано ШТАБУ, и вопрос у него один: кто ответил и
    // сколько даёт против запрошенного — потому обе цифры стоят в заголовке,
    // рядом, а не порознь.
    //
    // Ноль — это ОТКАЗ, а не «выделяет нисколько»: сервер тем же нулём
    // закрывает запрос статусом «Отказ» (`respond_allocation`). Печатать
    // «выделяет 0 из 5» значило бы назвать решение цифрой и потерять его
    // смысл.
    const p = row.payload;
    const department = p.departmentName || "Департамент";
    const allocating = p.allocating ?? 0;
    const requested = p.requested ?? 0;
    const title =
      allocating === 0
        ? `${department}: отказ по запросу сил`
        : `${department} выделяет ${allocating} из ${requested}`;
    return {
      title,
      message: `${p.eventCode ?? ""} ${p.eventTitle ?? ""} · ${p.businessDate ?? ""}`.trim(),
      // Ссылки НЕТ ОСОЗНАННО: доска сбора сил живёт вкладкой «Сборы» внутри
      // `/employees/`, и адреса ни у вкладки, ни у карточки сбора пока не
      // существует — увести человека на первую вкладку значило бы обещать
      // переход и не сделать его. Заведение адреса — своя карточка.
      link: null,
    };
  }
  if (row.kind === "SUBMISSION_LAGGING") {
    return {
      title: "Отставание по сдаче",
      message: `Подразделений без сдачи: ${row.payload.laggard_division_ids?.length ?? 0}`,
      link: null,
    };
  }
  // 🔴 НЕЗНАКОМЫЙ ВИД НАЗЫВАЕТ СЕБЯ, А НЕ ЧУЖИМ ИМЕНЕМ. Раньше сюда падало
  // ВСЁ, чему выше не нашлось ветки, и печаталось как «Отставание по сдаче ·
  // Подразделений без сдачи: 0» — уведомление врало о том, что произошло, и
  // человек не мог даже понять, что подписи нет. Та же конвенция, что у
  // журнала аудита: неизвестный код показывается собой.
  return {
    title: "Уведомление раздела",
    message: row.kind,
    link: null,
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
    const { title, message, link } = describeOpsNotification(row);
    return {
      id: row.id,
      notification_type: row.kind,
      title,
      message,
      link,
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
