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

// То же требование §9.6 для дежурств: план дежурств привязывается к объекту
// реестра и его версии паспорта — сид обязан давать РЕАЛЬНЫЕ id, иначе
// колонка «Пост по паспорту» в демо всегда пустая.
interface SeededDutyShift {
  id: string
  businessDate: string
  target: { objectId: string; safeLabel: string }
  passportBinding: {
    objectId: string
    versionId: string
    versionNumber: number
    sectorId: string
    postId: string
  } | null
}

interface SeededObjectWithSectors {
  id: string
  code: string
  passportVersions: Array<{
    id: string
    versionNumber: number
    effectiveFrom: string
    sectors: Array<{ id: string; posts: Array<{ id: string }> }>
  }>
}

function readDutySeed() {
  const envelope = composeSeed(scenario)
  const shifts = (envelope.slices.duties as { shifts: SeededDutyShift[] }).shifts
  const objects = (envelope.slices.objects as { objects: SeededObjectWithSectors[] }).objects
  return { shifts, objects }
}

describe('composeSeed — привязка дежурства к версии паспорта (§9.6)', () => {
  it('привязанное дежурство ссылается на реальные объект, версию, сектор и пост', () => {
    const { shifts, objects } = readDutySeed()
    const bound = shifts.filter((shift) => shift.passportBinding !== null)
    expect(bound.length).toBeGreaterThan(0)

    for (const shift of bound) {
      const binding = shift.passportBinding!
      // Привязка и цель смены обязаны указывать на ОДИН объект.
      expect(binding.objectId).toBe(shift.target.objectId)
      const object = objects.find((o) => o.id === binding.objectId)
      expect(object, `объект ${binding.objectId} для «${shift.target.safeLabel}»`).toBeDefined()
      const version = object?.passportVersions.find((v) => v.id === binding.versionId)
      expect(version, `версия ${binding.versionId}`).toBeDefined()
      expect(version!.effectiveFrom.localeCompare(shift.businessDate)).toBeLessThanOrEqual(0)
      const sector = version?.sectors.find((s) => s.id === binding.sectorId)
      expect(sector, `сектор ${binding.sectorId}`).toBeDefined()
      expect(sector?.posts.map((p) => p.id)).toContain(binding.postId)
    }
  })

  it('в сиде дежурств встречаются все три исхода §9.6', () => {
    const { shifts, objects } = readDutySeed()
    const known = (shift: SeededDutyShift) =>
      objects.some((object) => object.id === shift.target.objectId)

    // 1. Объекта нет в реестре вовсе.
    expect(shifts.some((shift) => !known(shift))).toBe(true)
    // 2. Объект есть, опубликованной версии на дату нет.
    const withoutVersion = shifts.find(
      (shift) => known(shift) && shift.passportBinding === null,
    )
    expect(withoutVersion).toBeDefined()
    expect(
      objects.find((object) => object.id === withoutVersion?.target.objectId)?.passportVersions,
    ).toEqual([])
    // 3. Объект есть и версия действует.
    expect(shifts.some((shift) => shift.passportBinding !== null)).toBe(true)
  })
})
