// Story 16.7 — упрощённая печатная форма Расстановки (`/print/placement`).
// Официального документа-эталона НЕТ (в отличие от расхода's `.docx`,
// генератор 6.3) — найдено при create-story: `apps/documents/generators/`
// не содержит генератора для Placement. Клиентская HTML-таблица поверх
// уже существующего GET /assignment-versions/{id}/ (16.8a) — "упрощённая"
// в названии стори это признаёт явно.
//
// Печатный канон 8.8 (ARCH-FE-014), block-scoped eslint по пути
// `src/features/print-forms/**`: голый семантический HTML + print.css,
// className — ТОЛЬКО строковые литералы `print-*`, импорты `shared/ui/*`
// и `lucide-react` запрещены. Кнопки «Печать» нет (Д6 8.8 — Ctrl+P).
//
// ARCH-FE-013: НЕ импортирует `features/placement/api/queries.ts` — прямой
// `apiClient.get()`, тот же приём, что `ExpensePrintPage` не импортирует
// `features/expense/`.
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { apiClient } from '../../shared/api/client'
import type { ApiFailure } from '../../shared/api/errors'
import type { paths } from '../../shared/api/schema'
import './print.css'
import {
  PRINT_EMPTY_MESSAGE,
  PRINT_LOADING_TEXT,
  PRINT_MISSING_PARAMS_MESSAGE,
  PRINT_SCREEN_HINT_TEXT,
  describePrintFailure,
  formatPrintDateTime,
} from './placementPrint'

type AssignmentVersionDetail =
  paths['/api/operations/assignment-versions/{id}/']['get']['responses']['200']['content']['application/json']

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Черновик',
  SUBMITTED: 'На согласовании',
  RETURNED: 'Возвращена на доработку',
  APPROVED: 'Утверждена',
}

export function PlacementPrintPage() {
  const [searchParams] = useSearchParams()
  const versionIdParam = searchParams.get('version_id') ?? ''
  const paramsValid = /^\d+$/.test(versionIdParam)

  const versionQuery = useQuery<AssignmentVersionDetail, ApiFailure>({
    queryKey: ['placement-print', versionIdParam],
    queryFn: () =>
      apiClient.get<AssignmentVersionDetail>(
        `/api/operations/assignment-versions/${encodeURIComponent(versionIdParam)}/`,
      ),
    enabled: paramsValid,
    retry: false,
  })

  if (!paramsValid) {
    return (
      <main className="print-root">
        <p className="print-screen-hint">{PRINT_SCREEN_HINT_TEXT}</p>
        <p className="print-status">{PRINT_MISSING_PARAMS_MESSAGE}</p>
      </main>
    )
  }

  return (
    <main className="print-root">
      <p className="print-screen-hint">{PRINT_SCREEN_HINT_TEXT}</p>
      <PlacementPrintBody query={versionQuery} />
    </main>
  )
}

function PlacementPrintBody({
  query,
}: {
  query: {
    isPending: boolean
    isError: boolean
    isSuccess: boolean
    error: ApiFailure | null
    data: AssignmentVersionDetail | undefined
  }
}) {
  if (query.isPending) return <p className="print-status">{PRINT_LOADING_TEXT}</p>
  if (query.isError && query.error !== null) {
    const described = describePrintFailure(query.error)
    // 'silent' — 401: handle401 уже чистит credential, RequireAuth уводит
    // на /login; текст успел бы только мигнуть поверх редиректа.
    if (described.kind === 'silent') return null
    return <p className="print-status">{described.message}</p>
  }
  if (!query.isSuccess || query.data === undefined) return null

  const version = query.data
  return (
    <>
      <header>
        <h1>
          Расстановка — Событие #{version.event} · Версия {version.version}
        </h1>
        <p>
          Статус: {STATUS_LABEL[version.status] ?? version.status}
          {version.signature_hash !== '' && ` · Подпись: ${version.signature_hash}`}
        </p>
      </header>
      <PlacementPrintTable version={version} />
      <p className="print-note">
        Сформировано: {formatPrintDateTime(new Date().toISOString())}.
      </p>
    </>
  )
}

function PlacementPrintTable({ version }: { version: AssignmentVersionDetail }) {
  if (version.assignments.length === 0) {
    return <p className="print-status">{PRINT_EMPTY_MESSAGE}</p>
  }
  return (
    <table className="print-wide">
      <thead>
        <tr>
          <th>№</th>
          <th>Сотрудник</th>
          <th>Пост</th>
          <th>Ознакомлен</th>
        </tr>
      </thead>
      <tbody>
        {version.assignments.map((assignment, index) => (
          <tr key={assignment.id}>
            <td className="print-num">{index + 1}</td>
            <td>{assignment.employee_id}</td>
            <td className="print-num">{assignment.post}</td>
            <td>
              {assignment.acknowledged_at === null
                ? 'Нет'
                : formatPrintDateTime(assignment.acknowledged_at)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
