// Story 10.8a — «моя копия»: локальные утилиты скачивания .xlsx сдачи.
//
// `saveBlob` — ЛОКАЛЬНАЯ копия (НЕ импорт из `features/expense`, ARCH-FE-013
// запрещает `features/A → features/B`). Голый `<a href>` на путь бэка не несёт
// X-User-Id/Authorization — файл нужно сначала забрать через apiClient (уже
// авторизованный fetch), затем «скачать» blob синтетическим кликом.
//
// Чистые функции: ни React (`saveBlob` — единственное исключение, DOM API, но
// без React-состояния), тестируются в env node/jsdom.
import type { ApiFailure } from '../../shared/api/errors'

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/** Фолбэк-имя, если сервер не прислал распознаваемое `Content-Disposition`
 * (зеркало `personal_export_service.py:104-106`). */
export function exportFileName(businessDate: string, version: number): string {
  return `сдача_${businessDate}_v${version}.xlsx`
}

/**
 * Карта отказов скачивания «моя копия» — зеркало `describeDownloadFailure`
 * (`features/expense/expense.ts:343-352`), СВОЯ карта (не импорт, ARCH-FE-013).
 *
 * network/5xx/401 молчат — уже обслужены тостом `useApiMutation`, дубль хуже
 * молчания. 403 НЕ молчит: штатно недостижим (право уже держит панель), но
 * защитный текст обязателен на случай смены роли между рендером и кликом.
 */
export function describeExportFailure(error: ApiFailure): string {
  if (error.kind === 'network') return ''
  if (error.status >= 500) return ''
  if (error.status === 401) return ''
  if (error.status === 403) {
    return 'Недостаточно прав на скачивание копии. Требуется право daily_report.mark_update.'
  }
  if (error.status === 404) return 'Версия сдачи не найдена.'
  if (error.status === 422) return error.message
  return `Не удалось скачать файл: ${error.message}`
}
