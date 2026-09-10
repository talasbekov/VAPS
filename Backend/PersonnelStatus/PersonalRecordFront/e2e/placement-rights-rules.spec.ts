/**
 * №1127: замещающий редактирует свой объект, но не ведёт этап и не назначает
 * старшего поста. Эти действия сервер оставляет старшему объекта/ведущему.
 */
import { expect, test } from '@playwright/test'

import { placementRightsOf } from '../features/security-event-stages/ui/PlacementStage'

test('№1127: права редактирования расстановки отделены от перехода и старшего поста', () => {
  const deputy = placementRightsOf({
    editable: true,
    canEditPlacement: true,
    identityResolved: true,
    myEmployeeId: '42',
    visit: {
      chiefEmployeeId: '17',
      deputies: [{ employeeId: '42', canEditPlacement: true }],
    },
  })
  expect(deputy.edit, 'замещающий потерял разрешённую сервером правку постов').toBe(true)
  expect(deputy.setSectorSenior, 'замещающему показано действие, на которое API отвечает 403').toBe(false)
  expect(deputy.complete, 'замещающему показан переход этапа, на который API отвечает 403').toBe(false)

  const chief = placementRightsOf({
    editable: true,
    canEditPlacement: true,
    identityResolved: true,
    myEmployeeId: '17',
    visit: { chiefEmployeeId: '17', deputies: [] },
  })
  expect(chief.edit).toBe(true)
  expect(chief.setSectorSenior).toBe(true)
  expect(chief.complete).toBe(true)
})

test('№1127 P1: неразрешённая личность fail-closed для действий ведущего', () => {
  const pendingIdentity = placementRightsOf({
    editable: true,
    canEditPlacement: true,
    identityResolved: false,
    myEmployeeId: null,
    visit: { chiefEmployeeId: '17', deputies: [{ employeeId: '42', canEditPlacement: true }] },
  })
  expect(pendingIdentity.edit, 'разрешённая правка состава не зависит от загрузки identity').toBe(true)
  expect(pendingIdentity.setSectorSenior).toBe(false)
  expect(pendingIdentity.complete).toBe(false)
})
