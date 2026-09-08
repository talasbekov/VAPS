import { expect, test } from '@playwright/test'
import { mayManageVisitObjects } from '../entities/security-event/model/capabilities'

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
