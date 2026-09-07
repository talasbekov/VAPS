// Адрес файла под `/media/` (Plane №951).
//
// Сервер отдаёт снимок ОТНОСИТЕЛЬНЫМ адресом (`/media/protected-persons/…`).
// В dev браузер ходит в бэкенд по абсолютному `BACKEND_URL`, и относительный
// адрес открылся бы от стенда :3106 — 404. В прод-сборке `BACKEND_URL` пуст,
// и адрес идёт через перезапись `/media/:path*` в `next.config.js` — она
// заведена этой же задачей, потому что до неё `/media/` не проксировался.
import { BACKEND_URL } from "@/shared/config/env";

export function mediaSrc(url: string | null | undefined): string | null {
  if (url === null || url === undefined || url === "") return null;
  if (/^(https?:)?\/\//.test(url) || url.startsWith("data:") || url.startsWith("blob:")) {
    return url;
  }
  return `${BACKEND_URL}${url}`;
}
