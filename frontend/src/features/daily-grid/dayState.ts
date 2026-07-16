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
// 10.6 — контракт пересдачи: тело ровно {reason, sanction} (ни actor, ни
// triggered_by_status_id), 201 = та же 9-полевая проекция DailySubmission.
export type AmendDayRequest = components['schemas']['DailySubmissionAmendRequest']
export type AmendDayResponse =
  paths['/api/operations/daily-submissions/{id}/amend/']['post']['responses']['201']['content']['application/json']

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

/** Причина/санкция текущей AMENDED-версии (10.6, detail.amendment). */
export interface AmendmentVM {
  reason: string
  sanction: string
}

/** Строка оси superseded: пин ребёнка вытеснен новой версией (10.6). */
export interface SummarySupersededVM {
  divisionId: string
  pinnedVersion: number
  currentVersion: number
}

/** Строка оси missing: у запиненного ребёнка не осталось current (10.6). */
export interface SummaryMissingVM {
  divisionId: string
  pinnedVersion: number
}

/** Derived-свежесть сводки 5.11 (10.6, detail.summary). */
export interface SummaryVM {
  status: string
  superseded: SummarySupersededVM[]
  missing: SummaryMissingVM[]
  unpinned: string[]
}

/** Вью-модель выбранного подразделения: несдано / сдано (+drift в светофоре;
 * 10.6 — amendment/summary из detail, null в list-режиме и у не-сводки). */
export type SelectedDayState =
  | { kind: 'unsubmitted'; previewEvent: string }
  | {
      kind: 'submitted'
      submission: DaySubmission
      trafficLight: TrafficLightVM | null
      amendment: AmendmentVM | null
      summary: SummaryVM | null
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

/** amendment-блок 10.6 — defensive (зеркало readDrift): не-объект или кривые
 * типы полей → null (блок бинарен: либо оба поля строки, либо его нет). */
export function readAmendment(value: unknown): AmendmentVM | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null
  const record = value as Record<string, unknown>
  if (typeof record.reason !== 'string' || typeof record.sanction !== 'string')
    return null
  return { reason: record.reason, sanction: record.sanction }
}

/** summary-блок 10.6 — defensive: без строкового status блока нет; кривые
 * строки осей отбрасываются построчно (зеркало changed в readDrift). */
export function readSummary(value: unknown): SummaryVM | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null
  const record = value as Record<string, unknown>
  if (typeof record.status !== 'string') return null
  const superseded: SummarySupersededVM[] = []
  if (Array.isArray(record.superseded)) {
    for (const item of record.superseded) {
      if (typeof item !== 'object' || item === null) continue
      const row = item as Record<string, unknown>
      if (
        typeof row.division_id === 'string' &&
        typeof row.pinned_version === 'number' &&
        typeof row.current_version === 'number'
      )
        superseded.push({
          divisionId: row.division_id,
          pinnedVersion: row.pinned_version,
          currentVersion: row.current_version,
        })
    }
  }
  const missing: SummaryMissingVM[] = []
  if (Array.isArray(record.missing)) {
    for (const item of record.missing) {
      if (typeof item !== 'object' || item === null) continue
      const row = item as Record<string, unknown>
      if (
        typeof row.division_id === 'string' &&
        typeof row.pinned_version === 'number'
      )
        missing.push({
          divisionId: row.division_id,
          pinnedVersion: row.pinned_version,
        })
    }
  }
  return {
    status: record.status,
    superseded,
    missing,
    unpinned: stringArray(record.unpinned),
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
    amendment: readAmendment(response.detail?.amendment ?? null),
    summary: readSummary(response.detail?.summary ?? null),
  }
}

/**
 * Итоговое состояние панели из серверной вью-модели и локального 201 (AC-11а,
 * закрытие defer 10.3 L667): серверная submitted-строка ПОБЕЖДАЕТ локальный
 * ответ, когда `server.version >= local.version` — чужой amendment после
 * рефетча показывает свежие версию/время/событие, а не застывший 201. Пока
 * сервер отстаёт (инвалидация в полёте) — локальная строка со светофором/
 * сводкой серверного состояния (amendment локального 201 сервер ещё не знает).
 */
export function resolvePanelState(
  serverState: SelectedDayState | null,
  submittedNow: DaySubmission | null,
): SelectedDayState | null {
  if (submittedNow === null) return serverState
  if (
    serverState?.kind === 'submitted' &&
    serverState.submission.version >= submittedNow.version
  )
    return serverState
  return {
    kind: 'submitted',
    submission: submittedNow,
    trafficLight:
      serverState?.kind === 'submitted' ? serverState.trafficLight : null,
    amendment: null,
    summary: serverState?.kind === 'submitted' ? serverState.summary : null,
  }
}

/** Строка списка деталей drift для рендера панели. */
export interface DriftRowVM {
  key: string
  label: string
}

/** Оси STALE-сводки → строки маркера (AC-10): имя ребёнка из divisions-словаря
 * ответа day-state; id вне словаря — показать id (fallback-канон 10.3). */
export function summaryRows(
  summary: SummaryVM,
  nameById: Record<string, string>,
): DriftRowVM[] {
  const name = (id: string) => nameById[id] ?? id
  return [
    ...summary.superseded.map((row) => ({
      key: `superseded-${row.divisionId}`,
      label: `${name(row.divisionId)}: пин v${row.pinnedVersion} → текущая v${row.currentVersion}`,
    })),
    ...summary.missing.map((row) => ({
      key: `missing-${row.divisionId}`,
      label: `${name(row.divisionId)}: сдача ребёнка отозвана`,
    })),
    ...summary.unpinned.map((id) => ({
      key: `unpinned-${id}`,
      label: `${name(id)}: появился несведённый ребёнок`,
    })),
  ]
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
