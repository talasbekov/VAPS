// Демо-данные личного состава (Этап 4). Независимый набор от
// `security-events/mocks/personnelRoster.ts` (та фикстура — узкий read-only
// снапшот для подбора кандидатов на посты; эта — полноценный кадровый
// справочник для экрана «Сотрудники»). Дублирование намеренное: разные
// bounded context, разная форма (§20.3), фичи не имеют права шарить друг у
// друга внутренние mocks/ (ARCH-FE-013).
import type { IdentityDisclosureRecord } from '../lib/identity'
import type { Division, Employee, Position, Rank } from '../model/types'

/**
 * Слайс личного состава хранит ТОЛЬКО журнал раскрытий (§20.33). Самих
 * сотрудников он не копирует: Smart Josparlau кадровую систему не ведёт
 * (§20.1), он читает донорские данные — источником остаётся `EMPLOYEES`, а
 * персистентное состояние появляется лишь у того, что порождает сам портал.
 */
export interface PersonnelSlice {
  disclosures: IdentityDisclosureRecord[]
}

// Параметра нет намеренно: слайс ни от часов, ни от чужих слайсов не зависит
// (`FeatureSeedBuilder` допускает функцию без аргументов).
export function buildPersonnelSeed(): { sliceName: string; data: PersonnelSlice } {
  // Пусто по построению: раскрытие — действие человека, и «уже раскрывали»
  // из сида читалось бы как чей-то реальный доступ, которого не было.
  return { sliceName: 'personnel', data: { disclosures: [] } }
}

export const DIVISIONS: readonly Division[] = [
  { id: 'division-1', organization: 'org-1', parent: null, type_code: 'DEPARTMENT', name: '6-е управление', code: 'D6', is_active: true },
  { id: 'division-2', organization: 'org-1', parent: null, type_code: 'DEPARTMENT', name: '3-е управление', code: 'D3', is_active: true },
  { id: 'division-3', organization: 'org-1', parent: null, type_code: 'DEPARTMENT', name: 'Штаб охранных мероприятий', code: 'SHT', is_active: true },
]

export const POSITIONS: readonly Position[] = [
  { code: 'SR_OFFICER', name: 'Старший офицер', level: 3, sort_order: 1, is_active: true },
  { code: 'OFFICER', name: 'Офицер', level: 2, sort_order: 2, is_active: true },
  { code: 'SR_SERGEANT', name: 'Старший сержант', level: 1, sort_order: 3, is_active: true },
]

export const RANKS: readonly Rank[] = [
  { code: 'COLONEL', name: 'полковник', category: 'офицерский', rank_index: 6, is_active: true },
  { code: 'MAJOR', name: 'майор', category: 'офицерский', rank_index: 4, is_active: true },
  { code: 'CAPTAIN', name: 'капитан', category: 'офицерский', rank_index: 3, is_active: true },
  { code: 'SERGEANT', name: 'сержант', category: 'сержантский', rank_index: 1, is_active: true },
]

export const EMPLOYEES: readonly Employee[] = [
  {
    id: 'employee-1',
    iin: '800101300123',
    full_name: 'Нуртаев Ердаулет Асхатович',
    last_name: 'Нуртаев',
    first_name: 'Ердаулет',
    middle_name: 'Асхатович',
    rank_code: 'COLONEL',
    rank_index: 6,
    position_code: 'SR_OFFICER',
    division: 'division-3',
    is_active: true,
    personnel_number: '00428',
    hire_date: '2013-06-01',
    employment_status: 'WORKING',
  },
  {
    id: 'employee-2',
    iin: '850214300456',
    full_name: 'Ерланов Данияр Муратович',
    last_name: 'Ерланов',
    first_name: 'Данияр',
    middle_name: 'Муратович',
    rank_code: 'MAJOR',
    rank_index: 4,
    position_code: 'OFFICER',
    division: 'division-1',
    is_active: true,
    personnel_number: '00512',
    hire_date: '2016-09-12',
    employment_status: 'WORKING',
  },
  {
    id: 'employee-3',
    iin: '900320300789',
    full_name: 'Ахметов Бекзат Серикович',
    last_name: 'Ахметов',
    first_name: 'Бекзат',
    middle_name: 'Серикович',
    rank_code: 'CAPTAIN',
    rank_index: 3,
    position_code: 'OFFICER',
    division: 'division-2',
    is_active: true,
    personnel_number: '00674',
    hire_date: '2019-02-04',
    employment_status: 'WORKING',
  },
  {
    id: 'employee-4',
    iin: '950712300234',
    full_name: 'Сагинова Айгерим Куанышевна',
    last_name: 'Сагинова',
    first_name: 'Айгерим',
    middle_name: 'Куанышевна',
    rank_code: 'SERGEANT',
    rank_index: 1,
    position_code: 'SR_SERGEANT',
    division: 'division-2',
    is_active: true,
    personnel_number: '00811',
    hire_date: '2021-11-20',
    employment_status: 'WORKING',
  },
  {
    id: 'employee-5',
    iin: '881005300567',
    full_name: 'Оразов Куаныш Талгатович',
    last_name: 'Оразов',
    first_name: 'Куаныш',
    middle_name: 'Талгатович',
    rank_code: 'MAJOR',
    rank_index: 4,
    position_code: 'OFFICER',
    division: 'division-3',
    is_active: false,
    personnel_number: '00390',
    hire_date: '2011-04-15',
    dismissal_date: '2026-03-01',
    employment_status: 'FIRED',
  },
]
