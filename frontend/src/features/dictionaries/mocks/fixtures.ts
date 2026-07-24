// Demo-сид «Справочники» (§8.7: только синтетические данные). Собственный
// набор значений — НЕ шарит данные с features/duties (ARCH-FE-013 не даёт
// фичам импортировать друг друга, тот же принцип, что A26/A35).
import type { SeedContext } from '../../../shared/testing/mock-runtime/seed-context'
import type { DictionaryDefinition, DictionaryEntry } from '../model/types'

export interface DictionariesSlice {
  definitions: DictionaryDefinition[]
  entries: DictionaryEntry[]
}

export const DICTIONARY_DEFINITIONS: readonly DictionaryDefinition[] = [
  {
    code: 'RETURN_REASONS',
    label: 'Причины возврата на доработку',
    description: 'Используются при возврате расстановки ОМ на доработку (стадия «Согласование»).',
  },
  {
    code: 'POST_REQUIREMENTS',
    label: 'Требования постов',
    description: 'Стандартные требования к назначению сотрудника на пост (паспорт объекта).',
  },
  {
    code: 'SEASONAL_CORRECTIONS',
    label: 'Сезонные/погодные поправки',
    description: 'Поправочные коэффициенты расчёта потребности по сезону/погодным условиям.',
  },
  {
    code: 'JOURNAL_ENTRY_TYPES',
    label: 'Типы записей журнала',
    description:
      'Каталог типов записей журнала штаба на стадии «Проведение» мероприятия. Справочник и форма журнала — независимые источники значений, технически не связаны (ARCH-FE-013).',
  },
  {
    code: 'POST_REQUIREMENT_GROUPS',
    label: 'Группы требований постов',
    description: 'Категории, объединяющие значения справочника «Требования постов».',
  },
]

export function buildDictionariesSeed(
  ctx: SeedContext,
): { sliceName: string; data: DictionariesSlice } {
  const now = ctx.clock.now()

  const entries: DictionaryEntry[] = [
    {
      id: ctx.ids.next('dict-entry'),
      dictionaryCode: 'RETURN_REASONS',
      code: 'INSUFFICIENT_COVERAGE',
      label: 'Недостаточная укомплектованность постов',
      description: 'Не все посты обеспечены назначением.',
      isActive: true,
      referencedCount: 3,
      groupCode: null,
      updatedAt: now,
    },
    {
      id: ctx.ids.next('dict-entry'),
      dictionaryCode: 'RETURN_REASONS',
      code: 'DOUBLE_ASSIGNMENT',
      label: 'Обнаружено двойное назначение',
      description: 'Сотрудник назначен на два поста одновременно.',
      isActive: true,
      referencedCount: 0,
      groupCode: null,
      updatedAt: now,
    },
    {
      id: ctx.ids.next('dict-entry'),
      dictionaryCode: 'RETURN_REASONS',
      code: 'OUTDATED_DATA',
      label: 'Устаревшие исходные данные',
      description: 'Рекогносцировка/потребность требует пересмотра.',
      isActive: false,
      referencedCount: 0,
      groupCode: null,
      updatedAt: now,
    },
    {
      id: ctx.ids.next('dict-entry'),
      dictionaryCode: 'POST_REQUIREMENTS',
      code: 'ARMED',
      label: 'Вооружённый пост',
      description: 'Требуется допуск к табельному оружию.',
      isActive: true,
      referencedCount: 5,
      groupCode: 'ACCESS',
      updatedAt: now,
    },
    {
      id: ctx.ids.next('dict-entry'),
      dictionaryCode: 'POST_REQUIREMENTS',
      code: 'DRIVER_LICENSE',
      label: 'Водительское удостоверение',
      description: 'Требуется действующее удостоверение категории B.',
      isActive: true,
      referencedCount: 0,
      groupCode: 'DOCUMENTS',
      updatedAt: now,
    },
    {
      id: ctx.ids.next('dict-entry'),
      dictionaryCode: 'SEASONAL_CORRECTIONS',
      code: 'WINTER_NIGHT',
      label: 'Зимняя ночная смена',
      description: 'Увеличенная продолжительность обогрева поста.',
      isActive: true,
      referencedCount: 0,
      groupCode: null,
      updatedAt: now,
    },
    {
      id: ctx.ids.next('dict-entry'),
      dictionaryCode: 'SEASONAL_CORRECTIONS',
      code: 'HEAT_ADVISORY',
      label: 'Аномальная жара',
      description: 'Сокращённые интервалы смены на открытых постах.',
      isActive: true,
      referencedCount: 2,
      groupCode: null,
      updatedAt: now,
    },
    {
      id: ctx.ids.next('dict-entry'),
      dictionaryCode: 'JOURNAL_ENTRY_TYPES',
      code: 'INSTRUCTION',
      label: 'Инструктаж',
      description: 'Проведение инструктажа личного состава на мероприятии.',
      isActive: true,
      referencedCount: 0,
      groupCode: null,
      updatedAt: now,
    },
    {
      id: ctx.ids.next('dict-entry'),
      dictionaryCode: 'JOURNAL_ENTRY_TYPES',
      code: 'ORDER',
      label: 'Распоряжение',
      description: 'Распоряжение штаба по ходу мероприятия.',
      isActive: true,
      referencedCount: 0,
      groupCode: null,
      updatedAt: now,
    },
    {
      id: ctx.ids.next('dict-entry'),
      dictionaryCode: 'JOURNAL_ENTRY_TYPES',
      code: 'INCIDENT',
      label: 'Инцидент',
      description: 'Регистрация инцидента на мероприятии.',
      isActive: true,
      referencedCount: 0,
      groupCode: null,
      updatedAt: now,
    },
    {
      id: ctx.ids.next('dict-entry'),
      dictionaryCode: 'JOURNAL_ENTRY_TYPES',
      code: 'REPLACEMENT',
      label: 'Замена',
      description: 'Замена сотрудника на посту в ходе мероприятия.',
      isActive: true,
      referencedCount: 0,
      groupCode: null,
      updatedAt: now,
    },
    {
      id: ctx.ids.next('dict-entry'),
      dictionaryCode: 'POST_REQUIREMENT_GROUPS',
      code: 'ACCESS',
      label: 'Допуски',
      description: 'Требования, связанные с допуском (оружие, спецсредства).',
      isActive: true,
      referencedCount: 1,
      groupCode: null,
      updatedAt: now,
    },
    {
      id: ctx.ids.next('dict-entry'),
      dictionaryCode: 'POST_REQUIREMENT_GROUPS',
      code: 'DOCUMENTS',
      label: 'Документы',
      description: 'Требования к личным документам сотрудника.',
      isActive: true,
      referencedCount: 1,
      groupCode: null,
      updatedAt: now,
    },
    {
      id: ctx.ids.next('dict-entry'),
      dictionaryCode: 'POST_REQUIREMENT_GROUPS',
      code: 'EQUIPMENT',
      label: 'Экипировка',
      description: 'Требования к форме и снаряжению.',
      isActive: false,
      referencedCount: 0,
      groupCode: null,
      updatedAt: now,
    },
  ]

  return {
    sliceName: 'dictionaries',
    data: { definitions: [...DICTIONARY_DEFINITIONS], entries },
  }
}
