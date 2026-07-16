// Story 10.5 — blob-скачивание вложений (Task 6): единый канал для кнопок
// «Скачать» экранов E10 поверх GET /api/documents/attachments/{id}/download/
// (6.7: sha256-verify + аудит DOCUMENT_DOWNLOADED на бэке — фронт НЕ аудирует).
// Конвенции — те же, что client.ts: authHeaders читаются В МОМЕНТ запроса
// (спред), не-2xx → parseErrorResponse (единый канал ошибок ARCH-FE-015),
// обрыв сети → NetworkError. Живёт в src/shared/api — fetch вне этой папки
// забанен eslint-ом; в клиент не встраивается: транспорт JSON-ветки (client)
// не должен обрастать blob/DOM-семантикой.
import { authHeaders } from '../auth/credential'
import { NetworkError, parseErrorResponse } from './errors'

/**
 * Имя файла из Content-Disposition: `filename*=utf-8''…` (RFC 5987,
 * процент-кодированная кириллица бэка) приоритетнее `filename="…"`;
 * битое кодирование filename* деградирует к filename; нет ни того ни
 * другого → null (вызывающий подставит fallback).
 */
export function parseContentDispositionFilename(
  header: string | null,
): string | null {
  if (header === null) return null
  // RFC 5987: filename*=charset'lang'value — language-tag опционален,
  // регистр charset не нормирован (Utf-8 валиден) — ревью 10.5.
  const extended = /filename\*=utf-8'[^']*'([^;]+)/i.exec(header)
  if (extended !== null) {
    try {
      return decodeURIComponent(extended[1].trim())
    } catch {
      // битые %-последовательности — падаем на обычный filename ниже
    }
  }
  const quoted = /filename="([^"]+)"/.exec(header)
  if (quoted !== null) return quoted[1]
  const bare = /filename=([^;"]+)/.exec(header)
  if (bare !== null) return bare[1].trim()
  return null
}

/**
 * Скачивает вложение и отдаёт его браузеру как файл: fetch → blob →
 * objectURL → программный клик `<a download>` → revoke. Имя — из
 * Content-Disposition, fallback — переданное (формат бэка:
 * `расход_{business_date}_исх-{number}.docx`, document_release_service).
 * Не-2xx → типизированный ApiError (parseErrorResponse); вызывающий
 * рендерит сообщение — молчаливых отказов нет (AC-11).
 */
export async function downloadAttachment(
  attachmentId: string,
  fallbackName: string,
): Promise<void> {
  const path = `/api/documents/attachments/${attachmentId}/download/`
  let response: Response
  try {
    response = await fetch(path, { headers: { ...authHeaders } })
  } catch (cause) {
    throw new NetworkError(`Сетевой сбой: GET ${path}`, { cause })
  }
  if (!response.ok) {
    throw await parseErrorResponse(response)
  }
  const blob = await response.blob()
  const name =
    parseContentDispositionFilename(
      response.headers.get('Content-Disposition'),
    ) ?? fallbackName
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}
