/**
 * Адрес фото сотрудника для `<img src>` — ВСЕГДА относительный (Plane №1201).
 *
 * Бэкенд отдаёт `photo_url` вида `/media/employees/photos/….jpg`, и в любом
 * контуре его обслуживает прокси перед приложением (`next.config.js` →
 * `/media/:path*`, в Docker — nginx). До 12.09.2026 рядом жила запасная
 * лестница `${NEXT_PUBLIC_MEDIA_URL}${photo}` с ВШИТЫМ при сборке адресом
 * (`http://10.15.3.187:8100`): в закрытой сети бэкенд стоит на другом порту,
 * а nginx-контур запрещает картинки с чужого адреса (`img-src 'self'`), и
 * фото не загружались. Абсолютные адреса здесь больше не собираются вовсе:
 * сырое имя файла из `photo` превращается в тот же `/media/…`.
 */
export const PHOTO_PLACEHOLDER = "/placeholder.svg";

const MEDIA_PREFIX = "/media/";

function present(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "" && value !== "null";
}

export function photoSrc(
  photoUrl: string | null | undefined,
  photo: string | null | undefined,
  placeholder: string = PHOTO_PLACEHOLDER,
): string {
  if (present(photoUrl)) return photoUrl;
  if (!present(photo)) return placeholder;
  const raw = photo.trim();
  // Абсолютный адрес из хранилища (S3 и т.п.) — как есть: это ответ сервера,
  // а не догадка клиента о его хосте.
  if (/^https?:\/\//.test(raw)) return raw;
  if (raw.startsWith(MEDIA_PREFIX)) return raw;
  return `${MEDIA_PREFIX}${raw.replace(/^\/+/, "")}`;
}
