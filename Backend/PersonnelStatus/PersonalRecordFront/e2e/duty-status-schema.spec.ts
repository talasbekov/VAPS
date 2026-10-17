import { expect, test } from '@playwright/test'
import { editStatusFormSchema, EMPTY_EDIT_STATUS_FORM } from '../features/employee-status-update/model/edit-status-schema'

function draft(statusCode: string, status: string) {
  return { ...EMPTY_EDIT_STATUS_FORM, statusCode, status, startDate: new Date(2026, 9, 8), endDate: new Date(2026, 9, 8) }
}

test('renaming the original duty preserves required placement fields', () => {
  const result = editStatusFormSchema.safeParse(draft('on_duty', 'Дежурный на посту'))
  expect(result.success).toBe(false)
  if (!result.success) expect(result.error.issues.map(issue => issue.path.join('.'))).toEqual(['duty.dutyKind', 'duty.objectId'])
})

test('a different status with the old display name does not require a local assignment', () => {
  expect(editStatusFormSchema.safeParse(draft('DUTY_COMBAT', 'На дежурстве')).success).toBe(true)
})

for (const [code, label] of [['DUTY_COMBAT', 'Боевое дежурство'], ['DUTY_DAILY', 'Суточное дежурство'], ['DUTY_OPERATIONAL', 'Оперативное дежурство']]) {
  test(`${code} saves a dated duty location without browser-only placement fields`, () => {
    const result = editStatusFormSchema.safeParse({ ...draft(code, label), location: 'Пост 2' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toMatchObject({ statusCode: code, location: 'Пост 2' })
    }
    expect(editStatusFormSchema.safeParse({ ...draft(code, label), endDate: undefined }).success).toBe(false)
  })
}
