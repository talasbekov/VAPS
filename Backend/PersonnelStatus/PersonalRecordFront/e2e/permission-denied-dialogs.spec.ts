/**
 * Plane №1041: все действия в пяти диалогах ОМ должны объяснять отказ прав
 * человеческой фразой. Здесь пинится именно подключение общего переводчика:
 * сами обработчики живут внутри компонентов и без него снова покажут
 * DRF-код `PERMISSION_DENIED`.
 */
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { OpsApiError, friendlyOpsErrorMessage } from '../lib/ops-errors'

const FRONT = path.resolve(__dirname, '..')
const SITES = [
  {
    file: 'app/security-ops/events/page.tsx',
    calls: 4,
    messages: [
      'Нет права удалять это мероприятие.',
      'Нет права снимать объект с мероприятия.',
      'Нет права менять старшего объекта.',
      'Нет права менять замещающих объекта.',
    ],
  },
  {
    file: 'features/event-visit-objects/ui/AddDeputyDialog.tsx',
    calls: 1,
    messages: ['Нет права назначать замещающего на этот объект.'],
  },
  {
    file: 'features/event-visit-objects/ui/EventChiefDialog.tsx',
    calls: 1,
    messages: ['Нет права менять старшего мероприятия.'],
  },
  {
    file: 'features/event-visit-objects/ui/AssignChiefDialog.tsx',
    calls: 1,
    messages: ['Нет права назначать старшего объекта.'],
  },
  {
    file: 'features/gvo-section-edit/ui/GvoVisitsDialog.tsx',
    calls: 1,
    messages: ['Нет права менять объекты посещения.'],
  },
] as const

const denied = new OpsApiError({
  status: 403,
  errorCode: '',
  message: 'PERMISSION_DENIED',
  details: {},
  requestId: null,
})

test.describe('диалоги ОМ: понятный отказ прав (Plane №1041)', () => {
  for (const site of SITES) {
    test(`${site.file}: 403 не показывает сырой код`, () => {
      const source = readFileSync(path.join(FRONT, site.file), 'utf8')
      expect(source).toContain('friendlyOpsErrorMessage')
      expect(source.match(/friendlyOpsErrorMessage\(/g)?.length).toBe(site.calls)
      for (const message of site.messages) {
        expect(source).toContain(message)
        expect(friendlyOpsErrorMessage(denied, message)).toBe(message)
      }
    })
  }
})
