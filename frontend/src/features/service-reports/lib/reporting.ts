// Формирование отчёта и masking policy (§22.20/§22.24, §20.32). Чистая
// модель: ни React, ни apiClient — тестируется в env node.
//
// ⚠️ ГЛАВНОЕ. §22.24 прямо запрещает «формировать чувствительный XLSX из уже
// загруженного в браузер полного массива». Поэтому и выборка строк, и
// маскирование, и сборка содержимого выполняются ЗДЕСЬ и вызываются из
// mock-repository (нашего «сервера»): экран получает готовый артефакт и не
// видит ни одного исключённого поля — их нет в ответе, а не спрятаны в
// вёрстке (тот же вывод, что sensitive identity в §20.27, A71).
import type {
  ReportArtifact,
  ReportParameters,
} from '../model/types'

/** Строка источника отчёта «Расход личного состава» (§22.20). Узкая проекция
 * чужого слайса дежурств: `features/service-reports` не импортирует
 * `features/duties` (ARCH-FE-013), а читает соседний слайс общего снапшота —
 * тот же приём, что `objectsSlice` в duties (A58/A62). */
export interface ReportSourceRow {
  businessDate: string
  employeeName: string
  objectLabel: string
  postLabel: string | null
  stateCode: string
  /** §22.24 «персональные комментарии» — исключается обычным экспортом. */
  note: string | null
  /** §22.24 «скрытые ограничения» — обоснование обхода конфликта; внутреннее. */
  overrideReason: string | null
}

/**
 * §22.24 masking policy. Список полей, которые обычный экспорт НЕ содержит,
 * с причиной по каждому — он приходит клиенту и печатается на экране: «поле
 * отсутствует» и «поле пустое» читаются одинаково, если не сказать, что его
 * исключили намеренно.
 */
export interface MaskedField {
  code: string
  label: string
  reason: string
}

export const MASKED_FIELDS: readonly MaskedField[] = [
  {
    code: 'NOTE',
    label: 'Примечание к дежурству',
    reason:
      '§22.24 «персональные комментарии»: свободный текст пишется для внутренней работы и может содержать сведения о человеке, которых отчёт не требует.',
  },
  {
    code: 'OVERRIDE_REASON',
    label: 'Обоснование обхода конфликта',
    reason:
      '§22.24 «скрытые ограничения»: обоснование обхода обязательного отдыха — внутреннее решение, а не факт несения службы.',
  },
]

/** Версия политики маскирования. Меняется вместе с составом `MASKED_FIELDS` —
 * артефакт хранит ту версию, по которой был построен (§22.22). */
export const MASKING_POLICY_VERSION = 'masking-2026.07.1'
/** Версия расчёта — методика выборки строк (какие смены попадают в период). */
export const CALCULATION_VERSION = 'expense-2026.07.1'

const BASE_COLUMNS = ['Дата', 'Сотрудник', 'Объект', 'Пост', 'Состояние'] as const
const SENSITIVE_COLUMNS = ['Примечание', 'Обоснование обхода'] as const

/** Экранирование поля CSV: кавычки удваиваются, поле берётся в кавычки, если
 * содержит разделитель, кавычку или перенос строки. */
export function csvField(value: string): string {
  if (!/[";\n\r]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * §22.20 «Расход личного состава». Содержимое собирается из строк источника;
 * состав КОЛОНОК зависит от режима: обычный экспорт не имеет колонок с
 * исключёнными полями ВООБЩЕ — не пустые ячейки, а отсутствующие колонки,
 * иначе отчёт сообщал бы «у этих смен примечаний не было».
 */
export function buildReportContent(
  rows: readonly ReportSourceRow[],
  parameters: ReportParameters,
  sensitive: boolean,
): string {
  const header = sensitive ? [...BASE_COLUMNS, ...SENSITIVE_COLUMNS] : [...BASE_COLUMNS]
  const lines = [
    `# Расход личного состава за период ${parameters.from} — ${parameters.to}`,
    header.map(csvField).join(';'),
  ]
  for (const row of rows) {
    const base = [
      row.businessDate,
      row.employeeName,
      row.objectLabel,
      row.postLabel ?? '',
      row.stateCode,
    ]
    const values = sensitive ? [...base, row.note ?? '', row.overrideReason ?? ''] : base
    lines.push(values.map(csvField).join(';'))
  }
  return `${lines.join('\n')}\n`
}

/** Отбор строк периода. Границы ВКЛЮЧИТЕЛЬНЫЕ — период «с 1-го по 31-е»
 * человек понимает именно так; полуинтервал молча терял бы последний день. */
export function selectRows(
  rows: readonly ReportSourceRow[],
  parameters: ReportParameters,
): ReportSourceRow[] {
  return rows
    .filter((row) => row.businessDate >= parameters.from && row.businessDate <= parameters.to)
    .sort(
      (a, b) =>
        a.businessDate.localeCompare(b.businessDate) ||
        a.employeeName.localeCompare(b.employeeName),
    )
}

/** Детерминированная контрольная сумма (FNV-1a, 32 бита). Не криптографическая
 * — см. комментарий у `ReportArtifact.hash`. */
export function contentHash(content: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** Размер в байтах, а не длина строки: кириллица в UTF-8 занимает два байта, и
 * `content.length` показал бы размер вдвое меньше настоящего. */
export function contentSize(content: string): number {
  return new TextEncoder().encode(content).length
}

export function periodDays(parameters: ReportParameters): number {
  const toUtc = (date: string) =>
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
  // Включительные границы: «с 1-го по 1-е» — один день, а не ноль.
  return Math.round((toUtc(parameters.to) - toUtc(parameters.from)) / 86_400_000) + 1
}

/** §22.22 «available»: артефакт доступен, пока не истёк срок хранения. */
export function isArtifactAvailable(artifact: ReportArtifact, nowIso: string): boolean {
  return Date.parse(nowIso) < Date.parse(artifact.expiresAt)
}

/** §22.23: форматы, которых проект НЕ формирует. Приходят клиенту с причиной —
 * §22.23 требует удалить «фальшивые действия», а не спрятать их молча. */
export const UNAVAILABLE_FORMATS: readonly MaskedField[] = [
  {
    code: 'XLSX',
    label: 'XLSX',
    reason:
      'Формирование книги Excel требует отдельной библиотеки и серверной генерации; кнопка без артефакта — ровно то «фальшивое действие», которое §22.23 запрещает.',
  },
  {
    code: 'PDF',
    label: 'PDF',
    reason:
      'PDF в проекте формируется печатью браузера по печатному канону (§8.8, печатная форма расстановки), а не серверным артефактом — это другой механизм, и выдавать его за экспорт нельзя.',
  },
  {
    code: 'DOCX',
    label: 'DOCX',
    reason: 'Генератора DOCX в проекте нет.',
  },
]

/** §35: поля контракта §22.22, которых demo-срез не даёт. */
export const UNAVAILABLE_ARTIFACT_FIELDS: readonly MaskedField[] = [
  {
    code: 'SCOPE_SNAPSHOT',
    label: 'Снимок scope',
    reason:
      'RBAC demo-режима плоский, без организационного scope (§8.9) — снимать нечего; тот же разрыв, что у раскрытия ИИН (§20.27).',
  },
  {
    code: 'SOURCE_WATERMARK',
    label: 'Водяной знак источника',
    reason:
      'Водяной знак наносится генератором документа; CSV его не несёт, а приписывать поле, которого нет в файле, значило бы описывать несуществующее свойство артефакта.',
  },
  {
    code: 'POLICY_VERSION',
    label: 'Версия политики доступа',
    reason:
      'Версионируемой политики доступа в demo-срезе нет: права — плоский список кодов. Версии РАСЧЁТА и МАСКИРОВАНИЯ при этом реальные и хранятся в артефакте.',
  },
]
