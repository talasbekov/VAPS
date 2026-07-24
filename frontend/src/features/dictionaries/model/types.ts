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
// «Проведение» (JOURNAL_ENTRY_TYPES, самостоятельный справочник-каталог,
// НЕ связан технически с UI security-events — ARCH-FE-013 запрещает
// features→features импорт) и группы требований постов
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
   * §30 «не допускай удаление значения, используемого связанными
   * сущностями» — демо-эмуляция: живой перекрёстный подсчёт по чужим фичам
   * потребовал бы cross-feature импорта (ARCH-FE-013 запрещает), поэтому
   * здесь заранее заданное значение фикстуры, не пересчитывается при
   * мутациях в других фичах. Честно задокументировано, не выдаётся за
   * серверный агрегат (§35).
   */
  referencedCount: number
  /**
   * Только для `dictionaryCode === 'POST_REQUIREMENTS'` — код записи
   * справочника `POST_REQUIREMENT_GROUPS`, к которой относится это
   * требование. `null`, если группа не назначена или запись принадлежит
   * другому справочнику.
   */
  groupCode: string | null
  updatedAt: string
}
