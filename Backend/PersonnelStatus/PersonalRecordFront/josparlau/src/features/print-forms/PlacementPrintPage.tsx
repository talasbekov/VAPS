// Smart Josparlau §9.15 — печатная форма расстановки (`/print/placement`),
// КОНТРОЛЬНАЯ копия документа. Официальным артефактом §9.15 называет .docx,
// который строит бэкенд из утверждённой версии; здесь — demo-предпросмотр,
// и он ЯВНО помечен как demo (§9.15: «preview не называется официальным
// документом; mock preview маркируется как demo»).
//
// Печатный канон 8.8 (ARCH-FE-014 / architecture L255), block-scoped eslint по
// пути `src/features/print-forms/**`: голый семантический HTML + print.css,
// className — ТОЛЬКО строковые литералы `print-*`, импорты `shared/ui/*` и
// `lucide-react` запрещены. Кнопки «Печать» нет (Д6 8.8 — Ctrl+P).
//
// ⚠️ Данные берутся ЗАПРОСОМ по URL API, а не импортом из
// `features/security-events`: кросс-фичевый импорт красный по ARCH-FE-013.
// URL API — не маршрут портала, ARCH-FE-012 на него не распространяется
// (тот же приём, что `ExpensePrintPage`). Узкая ручная поверхность ответа и
// её обоснование — в `placementPrint.ts`.
import { usePrintDocumentIsolation } from '../../shared/lib/usePrintDocumentIsolation'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { apiClient } from '../../shared/api/client'
import type { ApiFailure } from '../../shared/api/errors'
import './print.css'
import { formatDocDate } from './expensePrint'
import {
  DEMO_MARK_TEXT,
  EMPTY_CELL,
  LOADING_TEXT,
  MISSING_PARAMS_TEXT,
  NO_POSTS_TEXT,
  PLACEMENT_COLUMN_LABELS,
  PLACEMENT_TITLE,
  SCREEN_HINT_TEXT,
  TOTALS_LABEL,
  UNPARSEABLE_TEXT,
  buildPlacementRows,
  describePlacementFailure,
  parsePlacementDocument,
  placementTotals,
  sentence,
  stageLabel,
} from './placementPrint'
import type { PlacementDocument } from './placementPrint'

const SECURITY_EVENTS_PATH = '/api/ops/security-events/'

export function PlacementPrintPage() {
  usePrintDocumentIsolation()
  const [searchParams] = useSearchParams()
  const eventId = searchParams.get('security_event_id') ?? ''

  /**
   * `retry: false` обязателен: `providers.tsx` гасит ретраи только у МУТАЦИЙ,
   * у `useQuery` остаётся дефолтный `retry: 3` — отказ висел бы ~7 с и
   * выглядел зависшей печатью (закреплённый урок 10.4/10.5).
   */
  const eventQuery = useQuery<unknown, ApiFailure>({
    queryKey: ['placement-print', eventId],
    queryFn: () =>
      apiClient.get<unknown>(
        `${SECURITY_EVENTS_PATH}${encodeURIComponent(eventId)}/`,
      ),
    enabled: eventId !== '',
    retry: false,
  })

  if (eventId === '') {
    return (
      <main className="print-root">
        <p className="print-screen-hint">{SCREEN_HINT_TEXT}</p>
        <p className="print-status">{MISSING_PARAMS_TEXT}</p>
      </main>
    )
  }

  const doc = eventQuery.isSuccess
    ? parsePlacementDocument(eventQuery.data)
    : null

  return (
    <main className="print-root">
      <p className="print-screen-hint">{SCREEN_HINT_TEXT}</p>
      {/* Маркер demo — ПЕРВЫМ блоком документа и на бумаге тоже (§9.15).
          Он не зависит от загрузки данных: лист без данных, но с шапкой, тоже
          не должен выглядеть официальным. */}
      <p className="print-demo">{DEMO_MARK_TEXT}</p>
      <header>
        <h1>{PLACEMENT_TITLE}</h1>
        <p>{documentSubtitle(doc)}</p>
      </header>
      <PlacementBody doc={doc} query={eventQuery} />
      <PlacementFooter doc={doc} />
    </main>
  )
}

/**
 * Подзаголовок шапки. До прихода данных — БЕЗ выдуманных значений и без дыр
 * вида «ОМ  от  на объекте»: испорченная шапка юридического по форме листа
 * хуже, чем её отсутствие (урок `ExpensePrintPage`, MISSING_PARAMS).
 */
function documentSubtitle(doc: PlacementDocument | null): string {
  if (doc === null) return ''
  const parts = [
    doc.code,
    doc.title,
    doc.objectName,
    formatDocDate(doc.businessDate),
  ].filter((part) => part !== '')
  return parts.join(' · ')
}

/**
 * Лестница состояний тела. Тоста тут нет и быть не должно: он отрендерился бы
 * в портал ВНЕ `.print-root` и покрасил бы DOM-скан печатного канона.
 */
function PlacementBody({
  doc,
  query,
}: {
  doc: PlacementDocument | null
  query: { isPending: boolean; isError: boolean; error: ApiFailure | null }
}) {
  if (query.isPending) return <p className="print-status">{LOADING_TEXT}</p>
  if (query.isError && query.error !== null) {
    const described = describePlacementFailure(query.error)
    if (described.kind === 'silent') return null
    return <p className="print-status">{described.message}</p>
  }
  // 200 с телом, которое не разобрать — НЕ пустая расстановка и НЕ ошибка.
  if (doc === null) return <p className="print-status">{UNPARSEABLE_TEXT}</p>
  if (doc.posts.length === 0 && doc.assignments.length === 0) {
    return <p className="print-status">{NO_POSTS_TEXT}</p>
  }
  return <PlacementTable doc={doc} />
}

function PlacementTable({ doc }: { doc: PlacementDocument }) {
  const rows = buildPlacementRows(doc)
  const totals = placementTotals(doc)
  return (
    <table>
      <thead>
        <tr>
          {PLACEMENT_COLUMN_LABELS.map((label) => (
            <th key={label}>{label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.post}-${row.employeeName}-${index}`}>
            {/* № — ПОЗИЦИОННЫЙ: номера строки в данных нет вовсе. */}
            <td className="print-num">{index + 1}</td>
            <td>{row.sector}</td>
            <td>{row.post}</td>
            <td>{row.task}</td>
            <td>{row.requirements}</td>
            <td className="print-num">{row.need ?? EMPTY_CELL}</td>
            <td>{row.employeeName}</td>
            <td>{row.acknowledgement}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        {/* Жирность даёт существующее правило `.print-root tfoot td`. */}
        <tr>
          <td></td>
          <td>{TOTALS_LABEL}</td>
          <td></td>
          <td></td>
          <td></td>
          <td className="print-num">{totals.need}</td>
          <td className="print-num">{totals.assigned}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  )
}

/**
 * Подвал — snapshot-реквизиты (§9.15: «документ сохраняет исторические
 * snapshot-данные»). Ровно те, что demo-срез РЕАЛЬНО знает: ответственный,
 * этап на момент печати и `updatedAt` карточки. `reportJobId`/`policyVersion`/
 * `placementVersionId` из §9.15 НЕ печатаются — их в модели нет, а выдумывать
 * реквизиты документа запрещено (§35).
 */
function PlacementFooter({ doc }: { doc: PlacementDocument | null }) {
  if (doc === null) return null
  return (
    <p className="print-note">
      Ответственный: {sentence(doc.ownerName)} Этап на момент печати:{' '}
      {sentence(stageLabel(doc.stage))} Снимок данных: {sentence(doc.updatedAt)}
    </p>
  )
}
