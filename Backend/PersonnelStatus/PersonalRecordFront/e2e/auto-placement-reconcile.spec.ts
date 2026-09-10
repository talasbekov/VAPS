import { expect, test } from '@playwright/test'
import { reconcileAutoPlan } from '../features/security-event-stages/ui/PlacementStage'

test('№1128: повтор автоподбора не повторяет уже сохранённые строки после отказа', async () => {
  const plan = [
    { postId: 'p1', postLabel: 'A', employeeId: 'e1', employeeName: 'Первый', reasons: [] },
    { postId: 'p2', postLabel: 'B', employeeId: 'e2', employeeName: 'Второй', reasons: [] },
  ]
  const first = await reconcileAutoPlan(plan, async row => {
    if (row.employeeId === 'e2') throw new Error('конфликт')
  })
  expect(first.applied.map(row => row.employeeId)).toEqual(['e1'])
  expect(first.remaining.map(row => row.employeeId)).toEqual(['e2'])
  const retried: string[] = []
  await reconcileAutoPlan(first.remaining, async row => { retried.push(row.employeeId) })
  expect(retried, 'повтор не должен повторно отправлять уже сохранённого первого').toEqual(['e2'])
})
