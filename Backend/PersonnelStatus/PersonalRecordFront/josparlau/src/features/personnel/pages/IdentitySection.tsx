// Идентификационные данные сотрудника: маска, раскрытие с целью и сроком
// (§20.27), журнал раскрытий (§20.33).
//
// ⚠️ ЧТО ЗДЕСЬ ГЛАВНОЕ. §20.27 требует, чтобы после потери полномочия значение
// не осталось «ни в DOM, ни в Tooltip, ни в aria-label, ни в URL, localStorage
// или telemetry». Поэтому раскрытое значение:
//   * приходит МУТАЦИЕЙ, а не query — query-кэш пережил бы срок полномочия;
//   * рендерится обычным текстом, без `title` и без `aria-label` с ним внутри;
//   * стирается `reset()` по истечении срока и по кнопке «Скрыть»;
//   * никуда не пишется — ни в URL, ни в storage.
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { Input } from '../../../shared/ui/Input'
import { useDiscloseIdentity, useIdentityDisclosures } from '../api/queries'
import { MIN_PURPOSE_LENGTH, disclosureDurationMs } from '../lib/identity'
import type { PersonnelDirectoryEntry } from '../api/pending-contracts'
import type { IdentityDisclosure } from '../lib/identity'

export function formatMoment(iso: string): string {
  const at = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(at.getDate())}.${pad(at.getMonth() + 1)}.${at.getFullYear()}, ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

export function IdentitySection({ employee }: { employee: PersonnelDirectoryEntry }) {
  const disclose = useDiscloseIdentity(employee.id)
  const [purpose, setPurpose] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  // Журнал грузится всегда: 403 у него СВОЙ (право `personnel.identity.audit`),
  // и «не показывать журнал тому, кто не может раскрывать» было бы подменой
  // одного права другим.
  const disclosureLog = useIdentityDisclosures(employee.id)

  const disclosure = disclose.data ?? null

  // `useCallback` не для скорости: эта функция — зависимость эффекта отсчёта в
  // дочернем узле, и новая ссылка на каждый рендер перезапускала бы таймер.
  const hide = useCallback(() => {
    // §20.27 «удали данные из DOM»: `reset()` убирает значение из состояния
    // мутации, а не только с экрана — иначе оно вернулось бы на следующем
    // ререндере.
    disclose.reset()
    setPurpose('')
    setFormOpen(false)
  }, [disclose])

  function submit(): void {
    disclose.mutate({ purpose })
  }

  return (
    <section className="rounded-xl border bg-card p-4" aria-label="Идентификационные данные">
      <div className="mb-3 text-sm font-semibold">Идентификационные данные</div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">ИИН</span>
        {disclosure !== null ? (
          // `key` по идентификатору раскрытия: срок полномочия отсчитывается
          // от МОНТИРОВАНИЯ этого узла, то есть от момента получения ответа.
          // Новое раскрытие — новый ключ — новый отсчёт.
          <DisclosedValue key={disclosure.disclosureId} disclosure={disclosure} onExpire={hide} />
        ) : (
          <>
            <span className="font-mono text-sm font-semibold">{employee.iinMasked}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={!employee.canRevealIin}
              title={
                employee.canRevealIin
                  ? undefined
                  : 'Нужно право раскрытия идентификационных данных (personnel.identity.reveal).'
              }
              onClick={() => setFormOpen((open) => !open)}
            >
              Раскрыть ИИН
            </Button>
          </>
        )}
      </div>

      {!employee.canRevealIin && (
        // Причина — видимым текстом: выключенная кнопка не получает фокус, и
        // подсказка `title` недостижима с клавиатуры.
        <p className="mt-2 text-xs text-slate-600">
          Раскрытие недоступно: нужно право раскрытия идентификационных данных
          (personnel.identity.reveal), отдельное от права видеть карточку (§20.28).
        </p>
      )}

      {formOpen && disclosure === null && employee.canRevealIin && (
        <div role="group" aria-label="Раскрытие ИИН" className="mt-3 flex flex-col gap-2">
          <label className="text-xs font-semibold text-slate-600" htmlFor="disclosure-purpose">
            Цель раскрытия (обязательно, не короче {MIN_PURPOSE_LENGTH} символов)
          </label>
          <Input
            id="disclosure-purpose"
            value={purpose}
            placeholder="Например: сверка данных при оформлении допуска"
            onChange={(event) => setPurpose(event.target.value)}
          />
          <p className="text-[11px] text-slate-600">
            Раскрытие ограничено по времени и попадёт в журнал обращений. Само значение в
            журнал не записывается (§20.33).
          </p>
          {disclose.error !== null && (
            <p className="text-xs text-destructive">{disclose.error.message}</p>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={disclose.isPending}>
              Раскрыть
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setFormOpen(false)
                setPurpose('')
                disclose.reset()
              }}
            >
              Отмена
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4">
        <div className="mb-1.5 text-xs font-semibold text-slate-600">Журнал раскрытий</div>
        {disclosureLog.isError ? (
          <p className="text-xs text-slate-600">
            Журнал обращений недоступен: он читается по своему праву
            (personnel.identity.audit).
          </p>
        ) : disclosureLog.data === undefined ? (
          <p className="text-xs text-slate-600">Загрузка журнала…</p>
        ) : disclosureLog.data.results.length === 0 ? (
          <p className="text-xs text-slate-600">Обращений к идентификатору не было.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {disclosureLog.data.results.map((entry) => (
              <li key={entry.disclosureId} className="text-xs text-slate-600">
                <span className="font-semibold">{formatMoment(entry.disclosedAt)}</span> ·{' '}
                {entry.actorUserId} · цель: {entry.purpose}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-3 text-[11px] text-slate-600">
        §20.27 требует пять условий раскрытия: право, организационный scope, цель, срок
        полномочия и аудит. Четыре выполнены; организационного scope в demo-режиме нет —
        RBAC здесь плоский, без организационной иерархии (§8.9), и подменять его молчаливым
        «разрешено всем в пределах права» нельзя.
      </p>
    </section>
  )
}

/**
 * Раскрытое значение и обратный отсчёт полномочия.
 *
 * ⚠️ Дедлайн считается ОДИН РАЗ при монтировании: «момент получения ответа»
 * плюс длительность полномочия. Сравнивать серверный `expiresAt` с часами
 * клиента нельзя — они идут по разным шкалам (в demo-режиме DemoClock живёт в
 * сценарной дате, §8.8, и наивное сравнение объявляло бы только что выданное
 * полномочие истёкшим; поймано e2e, не рассуждением). Отсчёт от монтирования
 * инвариантен к сдвигу шкал и не требует ни ref-ов в рендере, ни setState
 * внутри эффекта: узел пересоздаётся по `key`.
 */
function DisclosedValue({
  disclosure,
  onExpire,
}: {
  disclosure: IdentityDisclosure
  onExpire: () => void
}) {
  const [deadline] = useState(
    () => Date.now() + disclosureDurationMs(disclosure.disclosedAt, disclosure.expiresAt),
  )
  const [expired, setExpired] = useState(() => Date.now() >= deadline)

  useEffect(() => {
    if (expired) {
      onExpire()
      return
    }
    const timer = setInterval(() => {
      if (Date.now() >= deadline) setExpired(true)
    }, 500)
    return () => clearInterval(timer)
  }, [deadline, expired, onExpire])

  if (expired) return null

  return (
    <>
      <span className="font-mono text-sm font-semibold">{disclosure.iin}</span>
      <span className="text-[11px] text-slate-600">
        полномочие действует до {formatMoment(disclosure.expiresAt)}
      </span>
      <Button size="sm" variant="outline" onClick={onExpire}>
        Скрыть
      </Button>
    </>
  )
}
