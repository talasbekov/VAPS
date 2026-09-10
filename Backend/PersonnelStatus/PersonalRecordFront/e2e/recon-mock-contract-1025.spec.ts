import { expect, test } from '@playwright/test'
import { reconChecklistIncomplete } from '../mocks/ops/security-events-handlers'

const completeTemplate = Array.from({ length: 5 }, (_, index) => ({
  id: `event-1-checklist-${index}`,
  label: `Пункт ${index}`,
  state: 'NORMAL' as const,
  required: false,
  done: true,
  result: 'MATCHES' as const,
  comment: '',
}))

test.describe('мок рекогносцировки — обязательный шаблон (№1025)', () => {
  test('пустой PATCH не завершает рекогносцировку', () => {
    expect(reconChecklistIncomplete([])).toBe(true)
  })

  test('все пункты шаблона завершены независимо от присланного required', () => {
    expect(reconChecklistIncomplete(completeTemplate)).toBe(false)
  })

  test('обязательный нешаблонный пункт тоже блокирует завершение', () => {
    expect(
      reconChecklistIncomplete([
        ...completeTemplate,
        {
          id: 'custom-check',
          label: 'Дополнительная проверка',
          state: 'UNCHECKED' as const,
          required: true,
          done: false,
          result: null,
          comment: '',
        },
      ]),
    ).toBe(true)
  })
})
