// Чтение ЧУЖОГО слайса `security-events` из общего demo-снапшота (§8.4).
//
// Шестой случай того же приёма в проекте (A58 печатная форма, A62 привязка
// паспорта, отчётный реестр, аналитика службы, снимок аналитики): импорт из
// `features/security-events` красный по ARCH-FE-013, поэтому выборку делает
// СЕРВЕР — рукописная УЗКАЯ проекция соседнего слайса.
//
// Здесь она нужна ради §30: «не допускай удаление значения, используемого
// связанными сущностями». Записи журнала штаба хранят ИМЕННО КОД типа
// (`INSTRUCTION`/`ORDER`/`INCIDENT`/`REPLACEMENT`), совпадающий с кодами
// справочника `JOURNAL_ENTRY_TYPES`, — это единственный справочник в проекте
// с настоящим потребителем по коду.
//
// Инвариант: ТОЛЬКО ЧТЕНИЕ. Справочники ничего не меняют в чужом агрегате.
export const SECURITY_EVENTS_SLICE_NAME = 'security-events'

/** Одна ссылка на код типа записи журнала — с носителем, а не только счётом. */
export interface JournalTypeReference {
  typeCode: string
  /** Подпись мероприятия-носителя: печатается пользователю как зависимость. */
  eventLabel: string
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * `null` — слайса ОМ в снапшоте нет вовсе (посчитать не удалось).
 * Пустой массив — слайс есть, но ни одной записи журнала не заведено.
 * Разница существенна: первое запрещает удаление, второе разрешает.
 */
export function readJournalTypeReferences(
  slices: Readonly<Record<string, unknown>>,
): JournalTypeReference[] | null {
  const slice = slices[SECURITY_EVENTS_SLICE_NAME]
  if (slice === undefined || slice === null || typeof slice !== 'object') return null
  const rawEvents = (slice as { events?: unknown }).events
  if (!Array.isArray(rawEvents)) return null

  const references: JournalTypeReference[] = []
  for (const rawEvent of rawEvents as Record<string, unknown>[]) {
    const rawJournal = rawEvent.journalEntries
    if (!Array.isArray(rawJournal)) continue
    const code = asString(rawEvent.code)
    const title = asString(rawEvent.title)
    const eventLabel = code === '' ? title : code
    for (const rawEntry of rawJournal as Record<string, unknown>[]) {
      const typeCode = asString(rawEntry.type)
      if (typeCode === '') continue
      references.push({ typeCode, eventLabel })
    }
  }
  return references
}
