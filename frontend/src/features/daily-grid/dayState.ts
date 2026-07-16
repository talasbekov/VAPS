// Story 10.3 — типы и маппер read-модели day-state (Task 3).
// Типы — ТОЛЬКО из регенерированного schema.d.ts (ARCH-FE-011); drift в схеме
// приезжает unknown (JSONField 5.5a) — чтение строго defensive, зеркало
// readAggregateRows 10.2. Резолв ФИО — по словарю от страницы, fallback id
// (AC-12); функции чистые — панель рендерит готовую вью-модель.
import type { components, paths } from '../../shared/api/schema'

export type DayStateResponse =
  paths['/api/operations/daily-submissions/day-state/']['get']['responses']['200']['content']['application/json']

export type DayStateDivision = components['schemas']['DayStateDivision']
export type DaySubmission = components['schemas']['DailySubmission']
export type SubmitDayRequest = components['schemas']['DailySubmissionCreateRequest']
export type SubmitDayResponse =
  paths['/api/operations/daily-submissions/']['post']['responses']['201']['content']['application/json']

/** Строка изменившегося победителя (shape 5.5a: {employee_id, from, to}). */
export interface DriftChangeRow {
  employeeId: string
  from: string
  to: string
}

export interface DriftDetails {
  added: string[]
  removed: string[]
  changed: DriftChangeRow[]
}

/** Светофор выбранного подразделения из detail (null в list-режиме). */
export interface TrafficLightVM {
  status: string
  late: boolean
  drift: DriftDetails | null
}

/** Вью-модель выбранного подразделения: несдано / сдано (+drift в светофоре). */
export type SelectedDayState =
  | { kind: 'unsubmitted'; previewEvent: string }
  | {
      kind: 'submitted'
      submission: DaySubmission
      trafficLight: TrafficLightVM | null
    }

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/** drift конверта 5.5a — defensive: не-объект → null, кривые строки — мимо. */
export function readDrift(value: unknown): DriftDetails | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null
  const record = value as Record<string, unknown>
  const changed: DriftChangeRow[] = []
  if (Array.isArray(record.changed)) {
    for (const item of record.changed) {
      if (typeof item !== 'object' || item === null) continue
      const row = item as Record<string, unknown>
      if (
        typeof row.employee_id === 'string' &&
        typeof row.from === 'string' &&
        typeof row.to === 'string'
      )
        changed.push({ employeeId: row.employee_id, from: row.from, to: row.to })
    }
  }
  return {
    added: stringArray(record.added),
    removed: stringArray(record.removed),
    changed,
  }
}

/**
 * Вью-модель выбранного подразделения из ответа day-state. Источник
 * submitted-состояния — строка divisions (есть и в list-режиме); светофор —
 * только detail (сервер считает его по одному подразделению, NFR-4).
 */
export function selectDayState(
  response: DayStateResponse,
  divisionId: string,
): SelectedDayState | null {
  const row = response.divisions.find((d) => d.division_id === divisionId)
  if (row === undefined) return null
  if (row.submission === null) {
    return {
      kind: 'unsubmitted',
      previewEvent: response.detail?.preview_event ?? '',
    }
  }
  const light = response.detail?.traffic_light ?? null
  return {
    kind: 'submitted',
    submission: row.submission,
    trafficLight:
      light === null
        ? null
        : {
            status: light.status,
            late: light.late,
            drift: readDrift(light.drift),
          },
  }
}

/** Строка списка деталей drift для рендера панели. */
export interface DriftRowVM {
  key: string
  label: string
}

/** ФИО из словаря страницы; id вне словаря — показать id (AC-12 fallback). */
export function driftRows(
  drift: DriftDetails,
  nameById: Record<string, string>,
): DriftRowVM[] {
  const name = (id: string) => nameById[id] ?? id
  return [
    ...drift.added.map((id) => ({
      key: `added-${id}`,
      label: `${name(id)} — появился в расходе`,
    })),
    ...drift.removed.map((id) => ({
      key: `removed-${id}`,
      label: `${name(id)} — выбыл из расхода`,
    })),
    ...drift.changed.map((row) => ({
      key: `changed-${row.employeeId}`,
      label: `${name(row.employeeId)}: ${row.from} → ${row.to}`,
    })),
  ]
}
