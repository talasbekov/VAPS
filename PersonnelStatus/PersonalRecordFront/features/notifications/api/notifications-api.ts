import { getAccessToken } from "@/lib/api";
import { apiClient, type OpsNotification as OpsNotificationRow } from "@/lib/api";
import { BACKEND_URL } from "@/shared/config/env";
import { EMPLOYEES, REMARKS, ruCount } from "@/lib/ru-plural";

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

/**
 * Ключ строки ленты — ИСТОЧНИК ПЛЮС НОМЕР, а не номер (Plane №563).
 *
 * 🔴 ЧТО БЫЛО НЕ ТАК. Колокольчик сводит ДВЕ таблицы — легаси
 * (`notifications`) и раздела ОМ (`OpsNotification`), — и первичные ключи у них
 * нумеруются НЕЗАВИСИМО. Легаси-строка №7 и ОМ-строка №7 — разные факты с
 * одинаковым `id`, и React получал два элемента с одним ключом: список
 * анимируется через `AnimatePresence` и `layout`, поэтому совпадение не
 * «просто предупреждение в консоли», а перепутанные при перестановке строки —
 * подпись одного уведомления над текстом другого.
 *
 * Пара (источник, номер) уникальна по построению: внутри таблицы номер
 * первичен, а источников ровно два и они не пересекаются.
 */
export function notificationKey(notification: Notification): string {
  return `${notification.source}:${notification.id}`;
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
 *  выдумывался бы текст, разошлось бы с этим при первой же правке подписи.
 *
 *  ЭКСПОРТИРОВАНА РАДИ ПРОБЫ (Plane №585). Формулировку читает человек, и
 *  сломать её легче всего молча — склонением, порядком слов, потерянной
 *  цифрой. Через `fetchUnreadNotifications` до неё не добраться, не подняв
 *  два бэкенда; сама функция чистая и от сети не зависит. */
export function describeOpsNotification(row: OpsNotificationRow): {
  title: string;
  message: string;
  link: string | null;
} {
  if (row.kind === "FORCES_REQUEST") {
    // Запрос сил управлению (Plane №392, `[СБС-22]`): «Выделите N сотрудника
    // /сотрудников на ОМ-… (дата)». Ссылка ведёт в «Статусы сотрудников» — там начальник
    // управления отмечает людей (`[СБС-30]`/`[СБС-31]`, Plane №394/№395);
    // баннер запроса на том экране — их шаг, здесь только адрес.
    const p = row.payload;
    const need = p.need ?? 0;
    return {
      // «Выделите 1 сотрудников» — самое частое значение этого уведомления и
      // самая заметная в нём ошибка (Plane №562). Склонение — общим правилом,
      // а не пятой копией тернарника.
      title: `Выделите ${ruCount(need, EMPLOYEES)} на ${p.eventCode ?? "мероприятие"}`,
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
    // Склонение — ОБЩЕЕ с бейджем реестра (Plane №585): тернарник без `% 100`
    // ломался ровно на втором десятке (21 → «21 замечаний», 22-24 →
    // «замечаний»), и две поверхности говорили про одно число по-разному.
    const remarks = ruCount(p.remarksOpen ?? 0, REMARKS);
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

/** Источник строки ленты: две таблицы, слитые в один список (Plane №402). */
export type NotificationSource = Notification["source"];

/** Лента и ЧЕСТНЫЙ отчёт о том, что из неё не пришло (Plane №565). */
export interface NotificationFeed {
  items: Notification[];
  /** Ленты, которые ответили отказом. Пусто — пришло всё. */
  failed: NotificationSource[];
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
 *
 * 🔴 ОТКАЗ ОДНОЙ ЛЕНТЫ НЕ ГАСИТ ВТОРУЮ (Plane №565). Слияние сделали через
 * `Promise.all`, и это оказалось РЕГРЕССОМ по сравнению с прежним поведением:
 * до него легаси-уведомления показывались сами по себе, а после — единственный
 * 500 со стороны раздела ОМ ронял весь запрос, и колокольчик показывал «не
 * удалось загрузить» вместо тех строк, которые прекрасно пришли. Отказ одной
 * половины — повод сказать про эту половину, а не спрятать вторую.
 *
 * Обе легли — это отказ целиком, и он летит наверх: показывать пустую ленту
 * там, где ничего не известно, значило бы сказать «уведомлений нет».
 */
export async function fetchUnreadNotifications(): Promise<NotificationFeed> {
  const [legacyResult, opsResult] = await Promise.allSettled([
    authorizedFetch(`${BASE}/unread/`).then((r) => r.json()) as Promise<
      Omit<Notification, "source">[]
    >,
    apiClient.getOpsNotifications({ unread: true }),
  ]);

  if (legacyResult.status === "rejected" && opsResult.status === "rejected") {
    throw legacyResult.reason;
  }

  const failed: NotificationSource[] = [];
  const legacy: Notification[] =
    legacyResult.status === "fulfilled"
      ? legacyResult.value.map((row) => ({ ...row, source: "legacy" as const }))
      : (failed.push("legacy"), []);
  const ops: Notification[] =
    opsResult.status === "fulfilled"
      ? opsResult.value.results.map((row) => {
          const { title, message, link } = describeOpsNotification(row);
          return {
            id: row.id,
            notification_type: row.kind,
            title,
            message,
            link,
            is_read: row.read_at !== null,
            created_at: row.created_at,
            source: "ops" as const,
          };
        })
      : (failed.push("ops"), []);

  // Свежие сверху — сортировка по времени, а не конкатенация: иначе лента
  // читалась бы как «сначала все легаси, потом все ОМ» вместо «что новее».
  const items = [...legacy, ...ops].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return { items, failed };
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
