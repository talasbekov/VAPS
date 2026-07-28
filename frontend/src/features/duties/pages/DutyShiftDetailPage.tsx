// §21.32 «Карточка дежурства».
//
// §21.32 перечисляет одиннадцать блоков. Пять из них выводимы из модели и
// нарисованы (паспорт и пост, конфликты, ознакомление, фактическое участие,
// примечание/обход); остальные — «Ответственный по объекту», «Резерв»,
// «Замены», «Инциденты», «Итоги», «Оценивание», «Журнал», а также `revision` и
// время из шапки — приходят С СЕРВЕРА списком `unavailableBlocks` С ПРИЧИНОЙ и
// показываются текстом. Тот же приём, что в архиве дела закрытого ОМ (A59):
// пустой блок читался бы как «данных нет», а не «поля нет в модели», а
// молчание — как «мы это учли».
//
// Страница НИЧЕГО не агрегирует и не выводит: severity конфликта считает
// сервер (§21.34), какая версия паспорта действует — тоже (§9.6). Единственное
// её решение — какие ДЕЙСТВИЯ показать, и то по `stateCode`, ровно как строка
// плана.
import { Link, useParams } from 'react-router'
import { Button } from '../../../shared/ui/Button'
import { usePermissions } from '../../../shared/auth/usePermissions'
import { ROUTES } from '../../../shared/routes'
import {
  useAcknowledgeDutyShift,
  useClockInDutyShift,
  useClockOutDutyShift,
  useDutyShiftDetail,
} from '../api/queries'
import {
  NO_BINDABLE_POST_TEXT,
  NO_PUBLISHED_VERSION_TEXT,
  NO_REGISTRY_OBJECT_TEXT,
  stalePostBindingText,
} from '../lib/passportBinding'
import type { DutyShiftDetail } from '../api/pending-contracts'
import type { DutyShiftState } from '../model/types'
import { EditDutyShiftSection } from './EditDutyShiftSection'

const STATE_LABEL: Record<DutyShiftState, string> = {
  PLANNED: 'Запланировано',
  ACKNOWLEDGED: 'Ознакомлен',
  ACTIVE: 'На посту',
  COMPLETED: 'Завершено',
  CANCELLED: 'Отменено',
}

function durationLabel(minutes: number): string {
  const hours = minutes / 60
  return Number.isInteger(hours) ? `${hours} ч` : `${minutes} мин`
}

export function DutyShiftDetailPage() {
  const { id = '' } = useParams()
  const detailQuery = useDutyShiftDetail(id)

  if (detailQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Загрузка дежурства…</p>
  }
  if (detailQuery.isError || detailQuery.data === undefined) {
    return (
      <div>
        <p className="mb-3 text-sm text-destructive">Не удалось загрузить дежурство.</p>
        <Link className="text-sm text-primary underline" to={ROUTES.duties}>
          К плану дежурств
        </Link>
      </div>
    )
  }
  return <ShiftCard detail={detailQuery.data} />
}

function ShiftCard({ detail }: { detail: DutyShiftDetail }) {
  const { shift, passportStatus, dutyType, conflicts, unavailableBlocks } = detail
  const { hasPermission } = usePermissions()
  const acknowledgeMutation = useAcknowledgeDutyShift()
  const clockInMutation = useClockInDutyShift()
  const clockOutMutation = useClockOutDutyShift()
  const pending =
    acknowledgeMutation.isPending || clockInMutation.isPending || clockOutMutation.isPending
  const canManage = hasPermission('ops.duty.manage')
  const actionError =
    acknowledgeMutation.error ?? clockInMutation.error ?? clockOutMutation.error

  return (
    <div>
      <header className="mb-6">
        <Link className="mb-2 inline-block text-xs text-primary underline" to={ROUTES.duties}>
          ← К плану дежурств
        </Link>
        <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
          Служба · дежурство
        </p>
        <h1 className="text-2xl font-bold tracking-tight">{shift.target.safeLabel}</h1>
        {/* §21.32 шапка: код, вид, дата, состояние. Время и revision в шапке
            НЕ показываются — они в списке недоступных блоков с причиной. */}
        <dl className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <HeaderItem label="Код дежурства" value={shift.id} mono />
          <HeaderItem
            label="Вид дежурства"
            value={
              dutyType === null
                ? `${shift.dutyTypeCode} — вида нет в действующем реестре`
                : `${dutyType.safeLabel} · ${durationLabel(dutyType.defaultDurationMinutes)}`
            }
          />
          <HeaderItem label="Дата" value={shift.businessDate} mono />
          <HeaderItem label="Состояние" value={STATE_LABEL[shift.stateCode]} />
          <HeaderItem
            label="Ознакомление"
            value={shift.acknowledgedAt === null ? 'Не подтверждено' : shift.acknowledgedAt}
          />
          <HeaderItem
            label="Состояние конфликта"
            value={
              conflicts.length === 0
                ? 'Конфликтов на этот день нет'
                : `${conflicts.length} — см. блок «Конфликты»`
            }
          />
        </dl>
      </header>

      <div className="flex flex-col gap-4">
        <Section title="Пост и исполнитель">
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <HeaderItem label="Сотрудник" value={shift.employeeName} />
            <HeaderItem
              label="Пост по паспорту"
              value={
                shift.passportBinding === null
                  ? bindingAbsenceText(passportStatus)
                  : `${shift.passportBinding.sectorName} · ${shift.passportBinding.postName}`
              }
            />
            <HeaderItem
              label="Версия паспорта"
              value={
                shift.passportBinding === null
                  ? 'Привязки нет'
                  : `ред. ${shift.passportBinding.versionNumber} от ${shift.passportBinding.effectiveFrom}`
              }
            />
            <HeaderItem
              label="Обязательный отдых после смены"
              value={
                dutyType === null
                  ? 'Неизвестен — вида дежурства нет в реестре'
                  : `${durationLabel(dutyType.restAfterMinutes)} · ${
                      // Режим — из ПОЛИТИКИ ответа (§21.35), срок — у вида.
                      detail.conflictPolicy.restAfterDutyMode === 'HARD_BLOCK'
                        ? 'нарушение блокируется'
                        : 'нарушение обходится с обоснованием'
                    }`
              }
            />
          </dl>
          {/* §21.32 «Посты загружай из ЗАФИКСИРОВАННОЙ версии паспорта, а не
              из текущего изменившегося объекта» — снимок не подменяется, а
              расхождение с действующей редакцией называется отдельно. */}
          {shift.passportBinding !== null &&
            passportStatus.stale &&
            passportStatus.applicableVersionNumber !== null && (
              <p className="mt-2 text-xs font-semibold text-amber-700">
                {stalePostBindingText(
                  shift.passportBinding.versionNumber,
                  passportStatus.applicableVersionNumber,
                )}
              </p>
            )}
        </Section>

        <Section title="Конфликты">
          {conflicts.length === 0 ? (
            <p className="text-sm text-slate-600">
              Конфликтов, проявляющихся в день этой смены, нет.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {conflicts.map((conflict) => (
                <li key={conflict.conflictId} className="flex flex-wrap items-center gap-2">
                  <span
                    className={
                      conflict.severity === 'HARD'
                        ? 'inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800'
                        : 'inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800'
                    }
                  >
                    {conflict.severity === 'HARD' ? 'Жёсткий' : 'Мягкий'}
                  </span>
                  <span className="text-sm">{conflict.message}</span>
                </li>
              ))}
            </ul>
          )}
          {shift.overrideReason !== null && (
            <p className="mt-2 text-xs font-semibold text-amber-700">
              Конфликт обойдён при планировании: {shift.overrideReason}
            </p>
          )}
        </Section>

        <Section title="Фактическое участие">
          {/* §24.23 «Плановое назначение нельзя автоматически считать
              фактическим участием» — тот же принцип и здесь: пока смена не
              начата, факта нет, и это НЕ «0 часов». */}
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <HeaderItem
              label="Заступил"
              value={shift.actualStart ?? 'Ещё не заступал'}
              mono={shift.actualStart !== null}
            />
            <HeaderItem
              label="Сдал"
              value={shift.actualEnd ?? 'Ещё не сдавал'}
              mono={shift.actualEnd !== null}
            />
          </dl>
        </Section>

        {shift.cancellation !== null && (
          <Section title="Отмена">
            <p className="text-sm">{shift.cancellation.reason}</p>
            <p className="mt-1 text-[11px] text-slate-600 tabular-nums">
              Отменено {shift.cancellation.cancelledAt}
            </p>
          </Section>
        )}

        {shift.note !== null && (
          <Section title="Примечание">
            <p className="text-sm">{shift.note}</p>
          </Section>
        )}

        <Section title="Блоки, которых нет в модели дежурства">
          <p className="mb-2 text-xs text-slate-600">
            §21.32 называет эти блоки карточки. Данных под них нет — ниже причина по
            каждому, чтобы пустое место не читалось как «проверено, ничего нет».
          </p>
          <ul className="flex flex-col gap-1.5">
            {unavailableBlocks.map((block) => (
              <li key={block.code} className="text-xs text-slate-600">
                <span className="font-medium">{block.label}</span> — {block.reason}
              </li>
            ))}
          </ul>
        </Section>
      </div>

      {/* Правка и отмена — только до заступления: после него смена уже несётся,
          и подмена сотрудника или поста была бы подлогом. Тот же список
          состояний держит и репозиторий (403/422 при обходе UI). */}
      {canManage && (shift.stateCode === 'PLANNED' || shift.stateCode === 'ACKNOWLEDGED') && (
        <div className="mt-4">
          <EditDutyShiftSection shift={shift} />
        </div>
      )}

      {canManage && shift.stateCode !== 'COMPLETED' && shift.stateCode !== 'CANCELLED' && (
        <div className="mt-5 flex items-center gap-3">
          {shift.stateCode === 'PLANNED' && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() => acknowledgeMutation.mutate({ id: shift.id })}
            >
              Ознакомиться
            </Button>
          )}
          {shift.stateCode === 'ACKNOWLEDGED' && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() => clockInMutation.mutate({ id: shift.id })}
            >
              Заступить
            </Button>
          )}
          {shift.stateCode === 'ACTIVE' && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() => clockOutMutation.mutate({ id: shift.id })}
            >
              Завершить
            </Button>
          )}
          {actionError !== null && (
            <p className="text-xs text-destructive">{actionError.message}</p>
          )}
        </div>
      )}
    </div>
  )
}

/** §9.6: причина отсутствия привязки, а не молчаливый прочерк — те же три
 * текста, что в строке плана (владелец формулировок один, lib/passportBinding). */
function bindingAbsenceText(status: DutyShiftDetail['passportStatus']): string {
  if (!status.objectKnown) return NO_REGISTRY_OBJECT_TEXT
  return status.applicableVersionNumber === null
    ? NO_PUBLISHED_VERSION_TEXT
    : NO_BINDABLE_POST_TEXT
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-2.5 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function HeaderItem({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-slate-600">{label}</dt>
      <dd className={mono ? 'text-sm tabular-nums' : 'text-sm'}>{value}</dd>
    </div>
  )
}
