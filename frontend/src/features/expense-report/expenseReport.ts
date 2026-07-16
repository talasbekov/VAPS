// Story 10.5 — типы и чистые хелперы экрана «Расход» (Task 7).
// Типы — ТОЛЬКО из регенерированного schema.d.ts (ARCH-FE-011), ручных дублей
// контракта нет; функции чистые (зеркало dayState.ts 10.3 / trafficTree.ts
// 10.4) — страница рендерит готовую вью-модель. Фича expense-report — СВОЯ
// директория: ESLint boundaries банит features→features, из daily-grid /
// readiness-tree ничего не импортируется.
import type { components, paths } from '../../shared/api/schema'

export type ExpenseHistoryResponse =
  paths['/api/operations/expense-reports/history/']['get']['responses']['200']['content']['application/json']

export type HistoryDivision = components['schemas']['ExpenseHistoryDivision']
export type HistoryIssue = components['schemas']['IssuedExpenseReportHistory']
export type IssuedExpenseReport = components['schemas']['IssuedExpenseReport']
export type IssueExpenseRequest =
  components['schemas']['ExpenseReportIssueRequest']

/** «Исх.№ 247/2026» — номер выдаёт БЭК из DocumentSequence (ловушка 10.1 P2:
 * никаких Исх.№-инпутов из макета). */
export function issueLabel(issue: { number: number; year: number }): string {
  return `Исх.№ ${issue.number}/${issue.year}`
}

/** «взамен исх.№ 246/2026» — подпись цепочки пересдач. Год обязателен (10.6
 * AC-12, defer 10.5): year-rollover сбрасывает счётчик DocumentSequence, и
 * кросс-годовая цепочка №5/2026 ← №247/2025 без года была бы двусмысленна;
 * Д-формат — зеркало issueLabel (Q-формат: подтвердить у Bratan, не стоп). */
export function supersedesLabel(supersedes: {
  number: number
  year: number
}): string {
  return `взамен исх.№ ${supersedes.number}/${supersedes.year}`
}

/** Fallback-имя файла — формат бэка document_release_service.py:288. */
export function buildFileName(issue: {
  business_date: string
  number: number
}): string {
  return `расход_${issue.business_date}_исх-${issue.number}.docx`
}

/** Бейдж статуса выпуска; незнакомая строка (дрейф) — passthrough. */
export function statusLabel(status: string): string {
  if (status === 'ISSUED') return 'Выпущен'
  if (status === 'SUPERSEDED') return 'Заменён'
  return status
}

/** details.laggards из 422 TOMORROW_BLOCKED — defensive к unknown (зеркало
 * readAllowed 10.3): UUID-only by-design (контракт §5.2/Q7, имён у бэка НЕТ). */
export function readLaggards(details: Record<string, unknown>): string[] {
  const laggards = details.laggards
  if (!Array.isArray(laggards)) return []
  return laggards.filter((item): item is string => typeof item === 'string')
}

function findingLabel(item: unknown): string | null {
  if (typeof item !== 'object' || item === null || Array.isArray(item))
    return null
  const record = item as Record<string, unknown>
  const reason = typeof record.reason === 'string' ? record.reason : 'нарушение'
  const rest = Object.entries(record)
    .filter(([key]) => key !== 'reason')
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(', ')
  return rest === '' ? reason : `${reason} — ${rest}`
}

/** details 422 REPORT_NOT_CONVERGENT ({violations, warnings} — финдинги
 * derive 1.7) → строки баннера; defensive к unknown-shape. */
export function readConvergenceFindings(
  details: Record<string, unknown>,
): string[] {
  const out: string[] = []
  for (const key of ['violations', 'warnings'] as const) {
    const list = details[key]
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const label = findingLabel(item)
      if (label !== null) out.push(label)
    }
  }
  return out
}

/** Тексты кодов выпуска, где сообщение бэка слишком «серверное» для экрана;
 * прочие коды честно отдают message бэка (сверено с raise-сайтами, НЕ
 * error-codes.yaml — инцидент 10.1). */
export function issueErrorText(
  errorCode: string | null,
  message: string,
): string {
  if (errorCode === 'REPORT_NOT_READY_FOR_DATE')
    return (
      'Подразделение не сдало день на эту дату — расход выпускается ' +
      'по сданному дню.'
    )
  if (errorCode === 'DOCUMENT_ALREADY_ISSUED')
    return 'Расход за эту дату уже выпущен — карточка обновлена.'
  return message
}

/** Сегодняшняя ЛОКАЛЬНАЯ дата — дефолт date-input (оператор живёт в местных
 * сутках). Осознанный дубль todayLocalIso 10.2/10.4: boundaries банят импорт
 * из daily-grid; общий shared date-хелпер — существующий defer, здесь НЕ
 * чинится (зеркало отклонения №3 стори 10.4). */
export function todayLocalIso(): string {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${mm}-${dd}`
}

/** Арифметика дат — UTC (урок tz-флейка test_vacancies_endpoint); осознанный
 * дубль addDaysIso 10.2 — та же причина, что todayLocalIso выше. */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
