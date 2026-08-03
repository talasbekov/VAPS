// Конфликт редакции и неизвестный исход отправки (§19.25-19.26).
//
// ЭТО НЕ `ConflictDialog`. §19.25 прямо запрещает вести конфликт версии оценки
// через диалог назначений: там кнопка «повторить с обоснованием» — конфликт
// назначения РАЗРЕШАЕТСЯ override'ом, а здесь разрешать нечего. Здесь человек
// должен увидеть, что изменилось, пока он заполнял форму, и решить сам.
// Поэтому код отказа намеренно не входит в `OVERRIDABLE_CODES`.
//
// Введённый текст НЕ стирается (§19.25 «введённый комментарий сохраняется
// локально для ручного восстановления»): панель показывается РЯДОМ с формой, а
// не вместо неё, и ничего в состоянии формы не сбрасывает.
import type { ApiFailure } from '../../../shared/api/errors'
import type { EvaluationConflictDetails } from '../api/pending-contracts'

function readDetails(error: ApiFailure): EvaluationConflictDetails | null {
  if (!('details' in error)) return null
  const details = error.details as Partial<EvaluationConflictDetails>
  if (typeof details.currentRevision !== 'number') return null
  return {
    currentRevision: details.currentRevision,
    currentScore: typeof details.currentScore === 'number' ? details.currentScore : null,
    currentBasisLabel:
      typeof details.currentBasisLabel === 'string' ? details.currentBasisLabel : null,
    currentComment: typeof details.currentComment === 'string' ? details.currentComment : null,
    currentEvaluationId:
      typeof details.currentEvaluationId === 'string' ? details.currentEvaluationId : null,
  }
}

export interface ConflictNoticeProps {
  error: ApiFailure | null
  /** Что человек собирался отправить — половина diff'а (§19.25 «пользователь видит diff»). */
  attempted: { score: number; basisLabel: string | null; comment: string | null }
  /** Перечитать актуальное состояние: §19.26 «предложи проверить текущее состояние». */
  onRecheck: () => void
}

export function EvaluationConflictNotice({ error, attempted, onRecheck }: ConflictNoticeProps) {
  if (error === null) return null

  // Сетевой сбой/таймаут: исход НЕИЗВЕСТЕН. §19.26 запрещает и «Оценка
  // сохранена», и молчаливый повтор — поэтому здесь ни того, ни другого, а
  // предложение проверить состояние.
  if (error.name === 'NetworkError') {
    return (
      <div className="mb-2 rounded-md border border-destructive/40 p-2" aria-label="Исход неизвестен">
        <p className="text-xs">
          Ответ не получен, и результат отправки неизвестен. Оценка могла быть принята —
          проверьте текущее состояние, прежде чем отправлять снова. Повторная отправка из этой
          формы безопасна: она идёт с тем же ключом и не создаст вторую запись.
        </p>
        <button type="button" className="mt-2 rounded-md border px-3 py-1.5 text-sm" onClick={onRecheck}>
          Проверить состояние
        </button>
      </div>
    )
  }

  const details = readDetails(error)
  if (details === null) return null

  const rows = [
    { label: 'Оценка', mine: String(attempted.score), current: details.currentScore === null ? '—' : String(details.currentScore) },
    { label: 'Основание', mine: attempted.basisLabel ?? '—', current: details.currentBasisLabel ?? '—' },
    { label: 'Комментарий', mine: attempted.comment ?? '—', current: details.currentComment ?? '—' },
  ].filter((row) => row.mine !== row.current)

  return (
    <div className="mb-2 rounded-md border border-destructive/40 p-2" aria-label="Запись изменилась">
      <p className="text-xs font-semibold">{error.message}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Актуальная редакция: {details.currentRevision}. Введённый текст сохранён — ничего не
        отправлено.
      </p>
      {rows.length > 0 && (
        <ul className="mt-1 flex flex-col gap-1">
          {rows.map((row) => (
            <li key={row.label} className="text-xs">
              <span className="font-semibold">{row.label}: </span>
              <span className="text-muted-foreground">сейчас {row.current}</span>
              {' · '}
              <span>вы вводите {row.mine}</span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="mt-2 rounded-md border px-3 py-1.5 text-sm" onClick={onRecheck}>
        Загрузить актуальную запись
      </button>
    </div>
  )
}
