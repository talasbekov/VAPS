import { expect, test } from '@playwright/test'
import {
  mayManageRecon,
  mayManageVisitObjects,
} from '../entities/security-event/model/capabilities'

test.describe('серверная capability объектов ОМ (Plane №981)', () => {
  test('слово сервера важнее локального event.manage', () => {
    expect(
      mayManageVisitObjects(
        { canManageVisitObjects: true, stage: 'RECON' },
        false,
      ),
    ).toBe(true)
    expect(
      mayManageVisitObjects(
        { canManageVisitObjects: false, stage: 'RECON' },
        true,
      ),
    ).toBe(false)
  })

  test('старый ответ имеет fallback, а CLOSED всегда неизменяем', () => {
    expect(mayManageVisitObjects({ stage: 'RECON' }, true)).toBe(true)
    expect(
      mayManageVisitObjects(
        { canManageVisitObjects: true, stage: 'CLOSED' },
        true,
      ),
    ).toBe(false)
  })
})

test.describe('объектная capability рекогносцировки (Plane №982)', () => {
  test('только явное true открывает форму выбранного объекта', () => {
    expect(mayManageRecon({ canManageRecon: true, stage: 'RECON' })).toBe(true)
    expect(mayManageRecon({ canManageRecon: false, stage: 'RECON' })).toBe(false)
    expect(mayManageRecon({ stage: 'RECON' })).toBe(false)
  })

  test('прошедший этап остаётся только для чтения', () => {
    expect(mayManageRecon({ canManageRecon: true, stage: 'DEMAND' })).toBe(false)
    expect(mayManageRecon({ canManageRecon: true, stage: 'CLOSED' })).toBe(false)
  })
})
