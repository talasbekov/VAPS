// §30: связи значения справочника со связанными сущностями. Чистые функции —
// репозиторий отдаёт им уже прочитанные проекции, сам расчёт не ходит в
// адаптер и потому проверяется без mock-runtime.
import type {
  DictionaryCode,
  DictionaryEntry,
  DictionaryUsage,
  DictionaryUsageReference,
} from '../model/types'
import type { JournalTypeReference } from '../mocks/securityEventsSlice'

/**
 * Реестр отслеживаемости — В ДАННЫХ, а не ветками `if` по коду справочника
 * (тот же принцип, что Lifecycle Registry аналитики ОМ). Справочник, которого
 * здесь нет, считается неотслеживаемым по умолчанию: забыть добавить строку
 * безопаснее, чем молча объявить связи посчитанными.
 */
export const USAGE_TRACKING: Readonly<
  Record<DictionaryCode, { tracked: boolean; reason: string | null }>
> = {
  JOURNAL_ENTRY_TYPES: { tracked: true, reason: null },
  POST_REQUIREMENT_GROUPS: { tracked: true, reason: null },
  RETURN_REASONS: {
    tracked: false,
    reason:
      'Возврат расстановки на доработку хранит свободный комментарий, а не код причины — связи значения отследить нельзя.',
  },
  POST_REQUIREMENTS: {
    tracked: false,
    reason:
      'Паспорт объекта хранит требования поста строкой, а не кодом значения — связи значения отследить нельзя.',
  },
  SEASONAL_CORRECTIONS: {
    tracked: false,
    reason: 'Поправки пока не читает ни один расчёт — потребителя кода в модели нет.',
  },
}

const SAMPLE_LIMIT = 3

function buildReference(
  sourceLabel: string,
  carriers: string[],
): DictionaryUsageReference | null {
  if (carriers.length === 0) return null
  const unique: string[] = []
  for (const carrier of carriers) {
    if (carrier !== '' && !unique.includes(carrier)) unique.push(carrier)
  }
  return { sourceLabel, count: carriers.length, samples: unique.slice(0, SAMPLE_LIMIT) }
}

function untracked(reason: string): DictionaryUsage {
  return { status: 'NOT_TRACKED', reason, references: [], totalCount: 0 }
}

function unknown(reason: string): DictionaryUsage {
  return { status: 'UNKNOWN', reason, references: [], totalCount: 0 }
}

/**
 * Считает связи одного значения.
 *
 * @param entry значение, чьи связи считаем
 * @param allEntries все значения СВОЕГО слайса (для ссылок `groupCode`)
 * @param journalReferences проекция чужого слайса ОМ; `null` — слайса нет
 */
export function computeEntryUsage(
  entry: DictionaryEntry,
  allEntries: readonly DictionaryEntry[],
  journalReferences: readonly JournalTypeReference[] | null,
): DictionaryUsage {
  const tracking = USAGE_TRACKING[entry.dictionaryCode]
  if (tracking === undefined || !tracking.tracked) {
    return untracked(
      tracking?.reason ??
        'Потребитель кода этого справочника в модели не объявлен — связи отследить нельзя.',
    )
  }

  const references: DictionaryUsageReference[] = []

  if (entry.dictionaryCode === 'JOURNAL_ENTRY_TYPES') {
    if (journalReferences === null) {
      return unknown(
        'Слайс охранных мероприятий недоступен в снимке — посчитать связи не удалось.',
      )
    }
    const own = journalReferences.filter((reference) => reference.typeCode === entry.code)
    const reference = buildReference(
      'Записи журнала штаба (охранные мероприятия)',
      own.map((item) => item.eventLabel),
    )
    if (reference !== null) references.push(reference)
  }

  if (entry.dictionaryCode === 'POST_REQUIREMENT_GROUPS') {
    const own = allEntries.filter(
      (candidate) =>
        candidate.dictionaryCode === 'POST_REQUIREMENTS' && candidate.groupCode === entry.code,
    )
    const reference = buildReference(
      'Значения справочника «Требования постов»',
      own.map((item) => item.label),
    )
    if (reference !== null) references.push(reference)
  }

  return {
    status: 'TRACKED',
    reason: null,
    references,
    totalCount: references.reduce((total, reference) => total + reference.count, 0),
  }
}

/** Человекочитаемая зависимость для текста отказа (§30 «понятная зависимость»). */
export function describeUsage(usage: DictionaryUsage): string {
  return usage.references
    .map((reference) => {
      const samples = reference.samples.length === 0 ? '' : ` (${reference.samples.join(', ')})`
      return `${reference.sourceLabel} — ${reference.count}${samples}`
    })
    .join('; ')
}
