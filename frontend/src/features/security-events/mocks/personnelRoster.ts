// Синтетические ДАННЫЕ read-only кадрового snapshot (тип — model/types.ts).
// Feature-owned: единственный потребитель сейчас — security-events; при
// появлении второго потребителя вынести в shared (не раньше). Доступ из UI —
// ТОЛЬКО через usePersonnelRoster() (api/queries.ts), а не прямым импортом
// этого файла из pages/ (страница не должна знать, что источник — mock).
import type { PersonnelSummarySnapshot } from '../model/types'

export const PERSONNEL_ROSTER: readonly PersonnelSummarySnapshot[] = [
  { id: 'emp-1', name: 'Ахметов Б.', rankLabel: 'Ст. сержант', unit: 'Группа досмотра' },
  { id: 'emp-2', name: 'Бекова А.', rankLabel: 'Сержант', unit: 'Группа досмотра' },
  { id: 'emp-3', name: 'Ерланов Д.', rankLabel: 'Капитан', unit: 'Управление ОМ' },
  { id: 'emp-4', name: 'Жаксыбеков Т.', rankLabel: 'Прапорщик', unit: 'Физическая охрана' },
  { id: 'emp-5', name: 'Каримова С.', rankLabel: 'Сержант', unit: 'Физическая охрана' },
  { id: 'emp-6', name: 'Нуртаев Е.', rankLabel: 'Майор', unit: 'Управление ОМ' },
  { id: 'emp-7', name: 'Оспанов Р.', rankLabel: 'Ст. сержант', unit: 'Резерв' },
  { id: 'emp-8', name: 'Тулегенова Ж.', rankLabel: 'Сержант', unit: 'Резерв' },
]

export function findPersonnel(id: string): PersonnelSummarySnapshot | undefined {
  return PERSONNEL_ROSTER.find((p) => p.id === id)
}
