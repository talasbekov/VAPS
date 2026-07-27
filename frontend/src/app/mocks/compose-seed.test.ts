// Композиция demo-снапшота: гвард на ПОРЯДОК builder'ов. Порядок стал значимым
// с §9.6 — сид ОМ привязывается к объекту и версии его паспорта по id, а
// увидеть чужой слайс можно только если он построен раньше (`ctx.builtSlices`).
// Комментарий в compose-seed.ts этого не удержит, тест — удержит.
import { describe, expect, it } from 'vitest'
import { composeSeed } from './compose-seed'
import { DEMO_SCENARIOS } from './scenario-manifest'

const scenario = DEMO_SCENARIOS[0]

interface SeededEvent {
  title: string
  objectId: string | null
  objectName: string
  businessDate: string
  passportBinding: { versionId: string; versionNumber: number } | null
}

interface SeededObject {
  id: string
  code: string
  passportVersions: Array<{ id: string; versionNumber: number }>
}

function readSeed() {
  const envelope = composeSeed(scenario)
  const events = (envelope.slices['security-events'] as { events: SeededEvent[] }).events
  const objects = (envelope.slices.objects as { objects: SeededObject[] }).objects
  return { events, objects }
}

describe('composeSeed — привязка ОМ к версии паспорта (§9.6)', () => {
  it('привязанный ОМ ссылается на РЕАЛЬНО существующий объект и его версию, а не на выдуманный id', () => {
    const { events, objects } = readSeed()
    const bound = events.filter((event) => event.passportBinding !== null)
    expect(bound.length).toBeGreaterThan(0)

    for (const event of bound) {
      const object = objects.find((o) => o.id === event.objectId)
      expect(object, `объект ${String(event.objectId)} для «${event.title}»`).toBeDefined()
      const versionIds = object?.passportVersions.map((v) => v.id) ?? []
      expect(versionIds).toContain(event.passportBinding?.versionId)
    }
  })

  it('в сиде встречаются ВСЕ три исхода §9.6 — иначе демо не показывает пустые случаи', () => {
    const { events, objects } = readSeed()

    // 1. Объекта нет в реестре вовсе.
    expect(events.some((event) => event.objectId === null)).toBe(true)
    // 2. Объект есть, опубликованной версии на дату нет.
    expect(
      events.some((event) => event.objectId !== null && event.passportBinding === null),
    ).toBe(true)
    // 3. Объект есть и версия действует.
    expect(events.some((event) => event.passportBinding !== null)).toBe(true)

    // Второй исход должен быть именно «нет версий», а не «объект пропал».
    const withoutBinding = events.find(
      (event) => event.objectId !== null && event.passportBinding === null,
    )
    const object = objects.find((o) => o.id === withoutBinding?.objectId)
    expect(object?.passportVersions).toEqual([])
  })

  it('привязка решается по бизнес-дате ОМ: версия не может действовать позже дня проведения', () => {
    const envelope = composeSeed(scenario)
    const events = (envelope.slices['security-events'] as { events: SeededEvent[] }).events
    const objects = (
      envelope.slices.objects as {
        objects: Array<SeededObject & { passportVersions: Array<{ id: string; effectiveFrom: string }> }>
      }
    ).objects

    for (const event of events) {
      if (event.passportBinding === null) continue
      const version = objects
        .flatMap((o) => o.passportVersions)
        .find((v) => v.id === event.passportBinding?.versionId)
      expect(version?.effectiveFrom.localeCompare(event.businessDate)).toBeLessThanOrEqual(0)
    }
  })

  it('сид детерминирован: два прогона одного сценария дают одинаковые привязки', () => {
    const first = readSeed().events.map((e) => [e.objectId, e.passportBinding?.versionId ?? null])
    const second = readSeed().events.map((e) => [e.objectId, e.passportBinding?.versionId ?? null])
    expect(second).toEqual(first)
  })
})
