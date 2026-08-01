// Шапка месячного плана: lifecycle §21.27 и поля/действия §21.28.
//
// ⚠️ Экран НЕ РЕШАЕТ, что доступно. Весь список действий приходит готовым в
// `header.actions` — §21.28 «доступность кнопки должна приходить от action
// policy API». Здесь нет ни одной ветки вида «если план утверждён, то кнопку
// выключить»: такая ветка неизбежно разошлась бы с сервером, и серая кнопка
// перестала бы означать отказ сервера. Компонент только сопоставляет коду
// действия его обработчик.
import { Button } from '../../../shared/ui/Button'
import {
  useApprovePlan,
  useCheckPlanConflicts,
  useCreatePlanDraft,
  useReopenPlan,
} from '../api/queries'
import { PLAN_HISTORY_LABEL, PLAN_STATE_LABEL } from '../lib/planLifecycle'
import type { DutyPlanAction, MonthlyPlanHeader } from '../lib/planLifecycle'

const STATE_CLASS: Record<string, string> = {
  DRAFT: 'inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900',
  APPROVED:
    'inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-900',
}

/** Момент времени → «ДД.ММ.ГГГГ, ЧЧ:ММ». Разбор через `Date` здесь безопасен:
 * это ISO-момент (`clock.now()`), а не календарный день — сдвига зоны, из-за
 * которого календарные даты разбираются только через `Date.UTC`, тут нет. */
export function formatMoment(iso: string): string {
  const at = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(at.getDate())}.${pad(at.getMonth() + 1)}.${at.getFullYear()}, ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** Подпись результата проверки (§21.27 «VALIDATED — результат проверки»). */
export function validationSummary(header: MonthlyPlanHeader): string {
  const validation = header.record?.lastValidation ?? null
  if (validation === null) return 'Проверка конфликтов не проводилась'
  const verdict = validation.passed
    ? 'пройдена'
    : `не пройдена (жёстких конфликтов ${validation.hardConflicts})`
  return `${formatMoment(validation.checkedAt)} — ${verdict}`
}

/** Именованная группа, а не `dt`/`dd`: подпись поля («Редакция») встречается и
 * в причинах недоступности действий, поэтому значение обязано быть адресуемым
 * по ИМЕНИ, а не по соседству в разметке — и для скринридера, и для локатора
 * теста. Тот же приём, что у карточек KPI ниже. */
function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div role="group" aria-label={label}>
      <p className="text-[11px] font-semibold text-slate-600">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  )
}

export function MonthlyPlanHeaderSection({
  header,
  monthLabel,
  onAddShift,
}: {
  header: MonthlyPlanHeader
  monthLabel: string
  /** «Добавить дежурство» уводит на представление, где живёт форма заведения
   * (§21.31): на месячной сетке формы нет, и кнопка без перехода была бы
   * кнопкой без операции. */
  onAddShift: () => void
}) {
  const draftMutation = useCreatePlanDraft()
  const checkMutation = useCheckPlanConflicts()
  const approveMutation = useApprovePlan()
  const reopenMutation = useReopenPlan()

  const record = header.record
  const month = header.month
  const mutations = [draftMutation, checkMutation, approveMutation, reopenMutation]
  const isPending = mutations.some((mutation) => mutation.isPending)
  // Показываем ПЕРВУЮ непустую ошибку: одновременно выполняется ровно одно
  // действие шапки, и «последняя» ошибка тут была бы тем же самым, но менее
  // очевидным способом её найти.
  const failure = mutations.find((mutation) => mutation.error !== null)?.error ?? null

  const runAction = (action: DutyPlanAction) => {
    if (action.code === 'CREATE_DRAFT') draftMutation.mutate({ month })
    else if (action.code === 'CHECK_CONFLICTS') checkMutation.mutate({ month })
    else if (action.code === 'APPROVE') approveMutation.mutate({ month })
    else if (action.code === 'REOPEN') reopenMutation.mutate({ month })
    else if (action.code === 'ADD_SHIFT') onAddShift()
  }

  const blocked = header.actions.filter((action) => !action.enabled)

  return (
    <section
      aria-label="Состояние месячного плана"
      className="mb-4 rounded-xl border bg-card p-4"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">План на {monthLabel}</h2>
        {record === null ? (
          // «Плана нет» и «план в черновике» — разные факты: §21.27 прямо
          // говорит, что автоматически созданный черновик не считается
          // утверждённым, а несуществующий не считается и черновиком.
          <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-slate-600">
            Черновик не сформирован
          </span>
        ) : (
          <span className={STATE_CLASS[record.stateCode]}>
            {PLAN_STATE_LABEL[record.stateCode]}
          </span>
        )}
      </div>

      {/* §21.28 «месяц и год» — в заголовке выше («План на июль 2026») и в
          переключателе месяца; ОТДЕЛЬНОГО поля с тем же значением здесь нет.
          Третья копия одной подписи на экране неразличима и для скринридера, и
          для локатора теста — тот же класс, что дублирующие подписи вкладок. */}
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <FieldRow label="Редакция" value={record === null ? '—' : String(record.revision)} />
        <FieldRow label="Последняя проверка" value={validationSummary(header)} />
        <FieldRow
          label="Источник объектов"
          value={
            header.objectSource.unknownObjects === 0
              ? `${header.objectSource.registryLabel}: объектов ${header.objectSource.knownObjects}`
              : `${header.objectSource.registryLabel}: объектов ${header.objectSource.knownObjects}, вне реестра ${header.objectSource.unknownObjects}`
          }
        />
      </div>

      {record !== null && record.stateCode === 'APPROVED' && (
        <p className="mb-3 text-xs text-slate-600">
          План зафиксирован {formatMoment(record.approvedAt ?? record.createdAt)}: заводить,
          править и отменять дежурства этого месяца нельзя — изменения выполняются через новую
          редакцию (§21.27). Ознакомление, заступление и завершение смен остаются доступны — это
          факт несения службы, а не изменение плана.
        </p>
      )}

      <div className="mb-2 flex flex-wrap gap-2">
        {header.actions.map((action) => (
          <Button
            key={action.code}
            size="sm"
            variant={action.code === 'APPROVE' ? 'default' : 'outline'}
            disabled={!action.enabled || isPending}
            title={action.reason ?? undefined}
            onClick={() => runAction(action)}
          >
            {action.label}
          </Button>
        ))}
      </div>

      {blocked.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1">
          {/* Причина недоступности — ВИДИМЫМ текстом, а не только в `title`:
              выключенная кнопка не получает фокус, поэтому подсказку нельзя
              ни навести с клавиатуры, ни прочитать скринридером. */}
          {blocked.map((action) => (
            <li key={action.code} className="text-xs text-slate-600">
              <span className="font-semibold">{action.label}</span> — {action.reason}
            </li>
          ))}
        </ul>
      )}

      {failure !== null && <p className="text-xs text-destructive">{failure.message}</p>}

      <p className="text-xs text-slate-600">
        Количество конфликтов и неознакомленных — в показателях ниже: те же серверные значения,
        второй раз их печатать негде (§21.29).
      </p>

      {record !== null && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-600">
            История плана ({record.history.length})
          </summary>
          <ol className="mt-2 flex flex-col gap-1">
            {/* §21.27 «история не перезаписывается» — показываем весь список
                в порядке событий, без схлопывания повторов. */}
            {record.history.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="text-xs text-slate-600">
                <span className="font-semibold">{formatMoment(entry.at)}</span> · редакция{' '}
                {entry.revision} · {PLAN_HISTORY_LABEL[entry.event]} — {entry.note}
              </li>
            ))}
          </ol>
        </details>
      )}

      <section className="mt-3 rounded-lg border border-dashed bg-muted/30 p-3">
        <h3 className="mb-1.5 text-xs font-semibold">Чего нет в шапке и в утверждении</h3>
        <ul className="flex flex-col gap-1.5">
          {[...header.unavailableFields, ...header.unavailableApprovalEffects].map((item) => (
            <li key={item.code} className="text-xs text-slate-600">
              <span className="font-semibold">{item.label}</span> — {item.reason}
            </li>
          ))}
        </ul>
      </section>
    </section>
  )
}
