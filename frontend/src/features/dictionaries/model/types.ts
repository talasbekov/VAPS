// Справочники (§30 мастер-промпта): «Все авторизованные могут видеть
// разрешённые справочники; управление — только по permission. Не допускай
// удаление значения, используемого связанными сущностями. Mock API возвращает
// 409/422 с понятной зависимостью.» Реализован generic-реестр справочник→
// значения, НЕ дублирующий уже существующие владельцы данных: должности/
// звания — реальные donor-справочники `/api/core/positions|ranks/`
// (features/personnel), виды дежурств — `features/duties` (Duty Type
// Registry, §24.3). §30 «типы статусов»/«группы» не имеют явного кандидата
// в текущем домене (кадровый EmployeeStatus исключён из Smart Josparlau,
// принадлежит донору) — реализованы как: типы записей журнала стадии
// «Проведение» (JOURNAL_ENTRY_TYPES; форма журнала по-прежнему принадлежит
// features/security-events, но связи значений СЧИТАЮТСЯ по его слайсу —
// узкой проекцией общего снапшота, без features→features импорта,
// запрещённого ARCH-FE-013) и группы требований постов
// (POST_REQUIREMENT_GROUPS, категоризирует записи POST_REQUIREMENTS через
// `groupCode`, см. FRONTEND_DECISIONS).
export type DictionaryCode =
  | 'RETURN_REASONS'
  | 'POST_REQUIREMENTS'
  | 'SEASONAL_CORRECTIONS'
  | 'JOURNAL_ENTRY_TYPES'
  | 'POST_REQUIREMENT_GROUPS'

export interface DictionaryDefinition {
  code: DictionaryCode
  label: string
  description: string
}

export interface DictionaryEntry {
  id: string
  dictionaryCode: DictionaryCode
  code: string
  label: string
  description: string
  isActive: boolean
  /**
   * Только для `dictionaryCode === 'POST_REQUIREMENTS'` — код записи
   * справочника `POST_REQUIREMENT_GROUPS`, к которой относится это
   * требование. `null`, если группа не назначена или запись принадлежит
   * другому справочнику.
   */
  groupCode: string | null
  updatedAt: string
}

/**
 * Отслеживаемость связей значения (§30 «не допускай удаление значения,
 * используемого связанными сущностями»).
 *
 * Поля `referencedCount` на записи БОЛЬШЕ НЕТ: оно было числом из фикстуры,
 * не пересчитывалось ничем и у единственного справочника с настоящими
 * ссылками (`JOURNAL_ENTRY_TYPES`) утверждало «связей нет», хотя записи
 * журнала ссылаются на его коды. Число считает СЕРВЕР при чтении, поимённо
 * по источникам.
 *
 * - `TRACKED` — у справочника есть потребитель, хранящий именно КОД значения;
 *   связи пересчитываются по общему demo-снапшоту (§8.4).
 * - `NOT_TRACKED` — потребитель хранит свободный текст, а не код (паспорт
 *   объекта пишет требования строкой, возврат расстановки — комментарием).
 *   Ноль здесь был бы утверждением «удалять безопасно», то есть ложью (§35),
 *   поэтому вместо числа отдаётся причина.
 * - `UNKNOWN` — источник связей недоступен (слайс отсутствует в снапшоте).
 *   Тоже НЕ ноль: «посчитать не удалось» и «связей нет» — разные утверждения
 *   (тот же принцип, что в снимке аналитики, A75).
 */
export type DictionaryUsageStatus = 'TRACKED' | 'NOT_TRACKED' | 'UNKNOWN'

export interface DictionaryUsageReference {
  /** Готовая подпись источника — печатается дословно (тот же приём, что A94). */
  sourceLabel: string
  count: number
  /** Носители ссылки — до трёх, чтобы зависимость была ПОНЯТНОЙ, а не числом. */
  samples: string[]
}

export interface DictionaryUsage {
  status: DictionaryUsageStatus
  /** Заполнено только при `NOT_TRACKED`/`UNKNOWN` — почему счёт невозможен. */
  reason: string | null
  references: DictionaryUsageReference[]
  totalCount: number
}

/** Запись справочника вместе с посчитанными сервером связями (проекция, не слайс). */
export interface DictionaryEntryView extends DictionaryEntry {
  usage: DictionaryUsage
}
