// Экспорт оперативного рейтинга (§19.29). Чистая модель: ни React, ни
// apiClient — тестируется в env node.
//
// ⚠️ Этот модуль исполняется ТОЛЬКО на стороне mock-сервера (repository).
// §19.29 перечисляет, чего в обычной выгрузке быть не должно: отдельных score,
// оценщиков, комментариев, sensitive documents, персональных оснований и
// скрытых correction details. Здесь их не «вычищают» из строки — файл
// собирается ИЗ СВОДКИ (`OperationalRatingSummary`), в которой таких полей нет
// вовсе. Фильтр можно забыть применить; отсутствующее поле забыть нельзя.
import type {
  OperationalRatingSummary,
  RatingExportFormat,
  RatingExportScope,
  RatingPolicy,
} from '../model/types'

/**
 * Форматы, которые проект РЕАЛЬНО собирает. §19.29 называет XLSX и PDF —
 * генератора ни того, ни другого в сборке нет, и предложить их значило бы
 * обещать файл (тот же вывод, что §22.23 у отчётного реестра). Причина едет
 * клиенту в `UNAVAILABLE_EXPORT_FORMATS`, а не молчит.
 */
export const RATING_EXPORT_FORMATS: readonly RatingExportFormat[] = ['CSV']

/** §35: форматы §19.29, которых нет, и почему. */
export const UNAVAILABLE_EXPORT_FORMATS: readonly { code: string; label: string; reason: string }[] =
  [
    {
      code: 'XLSX',
      label: 'XLSX',
      reason:
        '§19.29 называет формат, но генератора книги XLSX в сборке нет: файл собирал бы браузер из уже полученных строк, то есть выгрузка перестала бы быть серверной операцией с правом и audit. Доступен CSV — он открывается тем же табличным редактором.',
    },
    {
      code: 'PDF',
      label: 'PDF',
      reason:
        '§19.29 называет формат, но генератора PDF в сборке нет. Печатная форма — отдельный механизм (§9.15) со своим макетом и владельцем; выдать за PDF-выгрузку окно печати браузера значило бы назвать файлом то, что файлом не является.',
    },
  ]

/**
 * §35: режимы §19.29, которые НЕ выдаются, и почему.
 *
 * Отказ от индивидуальной выгрузки — не пропуск, а тот же вывод, что уже
 * записан у просмотра отдельных оценок: §19.21 требует к закрытым данным
 * sensitive permission, organization scope, event scope и СРОК полномочия
 * одновременно. Ни scope, ни срока в сборке нет. Завести под это право было бы
 * хуже, чем отказать: у эталонного администратора wildcard, и «отдельное право»
 * §19.29 немедленно оказалось бы у того, кому никакой scope не выдавали.
 */
export const UNAVAILABLE_EXPORT_SCOPES: readonly { code: string; label: string; reason: string }[] =
  [
    {
      code: 'INDIVIDUAL',
      label: 'Экспорт индивидуальных оценок (sensitive export)',
      reason:
        '§19.29 требует под него отдельного permission и audit-записи, но §19.21 требует к закрытым данным ещё organization scope, event scope и срок полномочия. Ни того, ни другого в сборке нет — и право без них охраняло бы выгрузку только на словах: у эталонного администратора wildcard, и файл с отдельными score, оценщиками и комментариями собрался бы для того, кому никакого scope не выдавали. Отказ фиксируется в журнале оценивания (§19.27).',
    },
  ]

/** Код отказа и безопасное объяснение. Экран ставит сообщение ПО КОДУ. */
export interface ExportViolation {
  code: string
  message: string
}

/**
 * Проверка заказа выгрузки. Выполняется на СЕРВЕРЕ; экран выполняет её же,
 * чтобы не отправлять заведомо отклоняемый запрос, — но решает сервер.
 */
export function validateExportRequest(input: {
  scope: RatingExportScope
  format: RatingExportFormat
}): ExportViolation | null {
  if (input.scope === 'INDIVIDUAL') {
    return {
      code: 'SENSITIVE_EXPORT_UNAVAILABLE',
      message:
        'Выгрузка индивидуальных оценок не выдаётся: закрытые данные требуют scope и срока полномочия, которых в этой сборке нет (§19.21).',
    }
  }
  if (!RATING_EXPORT_FORMATS.includes(input.format)) {
    return {
      code: 'EXPORT_FORMAT_UNAVAILABLE',
      message: 'Формат не собирается в этой сборке: доступен CSV.',
    }
  }
  return null
}

/**
 * Экранирование поля CSV: кавычки удваиваются, поле берётся в кавычки, если
 * содержит разделитель, кавычку или перевод строки.
 *
 * Осознанный дубль такой же функции отчётного реестра: фичи не читают чужие
 * модули (ARCH-FE-013), а общий CSV-хелпер в `shared/` связал бы два раздела с
 * разными форматами файлов одной правкой.
 */
export function csvField(value: string): string {
  return /[";\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** Колонки агрегированной выгрузки. Все — из сводки, закрытых среди них нет. */
export const AGGREGATE_EXPORT_COLUMNS: readonly string[] = [
  'Участник',
  'Агрегат',
  'Учтено оценок',
  'Период с',
  'Период по',
  'Методика',
  'Состояние',
]

const DATA_STATE_LABEL: Record<OperationalRatingSummary['dataState'], string> = {
  READY: 'Рассчитан',
  INSUFFICIENT_DATA: 'Недостаточно оценок',
  POLICY_UNDEFINED: 'Методика не определена',
  FEATURE_DISABLED: 'Функция выключена',
}

/**
 * Содержимое агрегированной выгрузки (§19.29).
 *
 * Отсутствие агрегата печатается СОСТОЯНИЕМ и пустой клеткой, а не нулём:
 * §19.19 «не показывай 0,0», и в файле это правило действует ровно так же —
 * ноль в таблице живёт дольше экрана и читается как оценка.
 */
export function buildAggregateExportContent(
  summaries: readonly OperationalRatingSummary[],
  policy: RatingPolicy | null,
): string {
  const lines = [
    `# Оперативный рейтинг: агрегированная сводка${
      policy === null ? '' : `, методика ${policy.policyVersion}`
    }`,
    AGGREGATE_EXPORT_COLUMNS.map(csvField).join(';'),
  ]
  for (const summary of summaries) {
    lines.push(
      [
        summary.safeLabel,
        summary.aggregateRating === null ? '' : summary.aggregateRating.toFixed(1),
        String(summary.evaluationsCount),
        summary.periodStartsAt ?? '',
        summary.periodEndsAt ?? '',
        summary.calculationPolicyVersion ?? '',
        DATA_STATE_LABEL[summary.dataState],
      ]
        .map(csvField)
        .join(';'),
    )
  }
  return `${lines.join('\n')}\n`
}

/** Имя файла собирает СЕРВЕР — вместе с содержимым, а не браузер по дате вкладки. */
export function exportFileName(
  scope: RatingExportScope,
  format: RatingExportFormat,
  businessDate: string,
): string {
  const prefix = scope === 'AGGREGATE' ? 'operational-rating-aggregate' : 'operational-rating'
  return `${prefix}-${businessDate}.${format.toLowerCase()}`
}
