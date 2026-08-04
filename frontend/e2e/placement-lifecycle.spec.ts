// Story 16.8i — e2e полного интерактивного цикла Расстановки в РЕАЛЬНОМ
// chromium против e2e-harness/placement.html (dist-e2e, порт 4174).
//
// Зачем это поверх ~50 jsdom-тестов 16.8h1-5. Модальность <dialog>
// (ReturnVersionDialog/ConflictDialog), реальная навигация между /placement
// и /placement/:id — тот же класс пробелов, что duty-plan-lifecycle.spec.ts
// (14.12b) закрывал для своего экрана: jsdom эмулирует эти вещи, а не
// воспроизводит. Сеть перехвачена page.route — реальный fetch, реальные
// статусы, реальный конверт §36.
//
// Scope Decision (create-story): useCreatePlacementDraft (16.8h1) нигде не
// используется ни в одном UI-компоненте — ни одна стори 16.8h2-5 построила
// кнопку/форму создания черновика. Сценарий СЕЕТ начальный DRAFT напрямую
// (тот же приём, что duty-plan-lifecycle.spec.ts сеет данные без клика
// "создать" для некоторых шагов) — тестируется только РЕАЛЬНО построенная
// интерактивная часть: список → деталь → submit → return (модалка) → новый
// драфт → submit → approve (реальный 409-конфликт → ConflictDialog →
// override) → acknowledge.
//
// Один сценарий, весь цикл — состояния зависят друг от друга
// последовательно (return создаёт НОВЫЙ драфт с ДРУГИМ id).
import { expect, test, type Page } from '@playwright/test'

const HARNESS = 'http://localhost:4174/e2e-harness/placement.html'

interface Assignment {
  id: number
  employee_id: string
  post: number
  conflict_severity: 'SOFT' | 'HARD' | ''
  conflict_codes: string[]
  acknowledged_at: string | null
  ack_escalated_at: string | null
}

interface Version {
  id: number
  event: number
  status: 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'APPROVED'
  version: number
  is_current: boolean
  signature_hash: string
  created_at: string
  updated_at: string
  assignments: Assignment[]
}

interface JournalEntry {
  id: number
  event: number
  entry_type: 'BRIEFING' | 'DIRECTIVE' | 'INCIDENT'
  text: string
  post: number | null
  participant_ids: string[]
  photo_attachment_id: string | null
  created_by: string | null
  created_at: string
}

function paginated<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results }
}

function stripAssignments(v: Version) {
  const copy: Partial<Version> = { ...v }
  delete copy.assignments
  return copy
}

async function stubApi(page: Page) {
  let nextVersionId = 1
  const versions: Version[] = [
    {
      id: nextVersionId++,
      event: 5,
      status: 'DRAFT',
      version: 1,
      is_current: true,
      signature_hash: '',
      created_at: '2026-08-04T09:00:00Z',
      updated_at: '2026-08-04T09:00:00Z',
      assignments: [
        {
          id: 1,
          employee_id: '11111111-1111-1111-1111-111111111111',
          post: 3,
          conflict_severity: 'SOFT',
          conflict_codes: ['DOUBLE_ASSIGNMENT_CONFLICT'],
          acknowledged_at: null,
          ack_escalated_at: null,
        },
      ],
    },
  ]
  let nextAssignmentId = 2

  await page.route('**/api/operations/my-permissions/', (route) =>
    route.fulfill({ json: { permissions: ['assignment.create'] } }),
  )

  // Same harness-hygiene as duty-plan.tsx: AppLayout unconditionally renders
  // ConnectionIndicator → GET /api/notifications/ + a real WebSocket.
  await page.route('**/api/notifications/**', (route) =>
    route.fulfill({ json: { count: 0, next: null, previous: null, results: [] } }),
  )
  await page.routeWebSocket(/\/ws\/notifications\//, () => {})

  await page.route('**/api/operations/assignment-versions/', (route) =>
    route.fulfill({ json: paginated(versions.map(stripAssignments)) }),
  )

  await page.route(/\/api\/operations\/assignment-versions\/(\d+)\/$/, async (route) => {
    const id = Number(route.request().url().match(/assignment-versions\/(\d+)\//)?.[1])
    const version = versions.find((v) => v.id === id)!
    await route.fulfill({ json: version })
  })

  await page.route(
    /\/api\/operations\/assignment-versions\/(\d+)\/conflicts\/$/,
    async (route) => {
      const id = Number(
        route.request().url().match(/assignment-versions\/(\d+)\/conflicts/)?.[1],
      )
      const version = versions.find((v) => v.id === id)!
      await route.fulfill({
        json: version.assignments.filter((a) => a.conflict_severity !== ''),
      })
    },
  )

  await page.route(
    /\/api\/operations\/assignment-versions\/(\d+)\/submit\/$/,
    async (route) => {
      const id = Number(
        route.request().url().match(/assignment-versions\/(\d+)\/submit/)?.[1],
      )
      const version = versions.find((v) => v.id === id)!
      version.status = 'SUBMITTED'
      await route.fulfill({ json: version })
    },
  )

  await page.route(
    /\/api\/operations\/assignment-versions\/(\d+)\/return\/$/,
    async (route) => {
      const id = Number(
        route.request().url().match(/assignment-versions\/(\d+)\/return/)?.[1],
      )
      const version = versions.find((v) => v.id === id)!
      const body = JSON.parse(route.request().postData() ?? '{}') as { reason?: string }
      if (!body.reason?.trim()) {
        await route.fulfill({
          status: 400,
          json: {
            error_code: 'VALIDATION_ERROR',
            message: 'reason обязателен.',
            details: { reason: ['Обязательное поле.'] },
            request_id: null,
            timestamp: new Date().toISOString(),
          },
        })
        return
      }
      version.status = 'RETURNED'
      version.is_current = false
      const newDraft: Version = {
        id: nextVersionId++,
        event: version.event,
        status: 'DRAFT',
        version: version.version + 1,
        is_current: true,
        signature_hash: '',
        created_at: '2026-08-04T09:05:00Z',
        updated_at: '2026-08-04T09:05:00Z',
        // Real backend resets conflict/ack state on the copied rows AND
        // gives them fresh PKs (bulk_create — new rows, not the old ones'
        // ids) — both mirrored here (review lesson from 16.8h1's own mock;
        // a REUSED id here collides across versions since acknowledge
        // below searches every version's assignments by id).
        assignments: version.assignments.map((a) => ({
          ...a,
          id: nextAssignmentId++,
          conflict_severity: '' as const,
          conflict_codes: [],
          acknowledged_at: null,
          ack_escalated_at: null,
        })),
      }
      versions.push(newDraft)
      await route.fulfill({
        json: { ...version, new_draft_version: stripAssignments(newDraft) },
      })
    },
  )

  await page.route(
    /\/api\/operations\/assignment-versions\/(\d+)\/approve\/$/,
    async (route) => {
      const id = Number(
        route.request().url().match(/assignment-versions\/(\d+)\/approve/)?.[1],
      )
      const version = versions.find((v) => v.id === id)!
      const body = JSON.parse(route.request().postData() ?? '{}') as {
        override?: boolean
        override_reason?: string
      }
      const hasConflict = version.assignments.some((a) => a.conflict_severity !== '')
      if (hasConflict && !(body.override === true && body.override_reason?.trim())) {
        await route.fulfill({
          status: 409,
          json: {
            error_code: 'SOFT_CONFLICT_DETECTED',
            message: 'В версии есть непросмотренные конфликты назначений.',
            details: {},
            request_id: null,
            timestamp: new Date().toISOString(),
          },
        })
        return
      }
      version.status = 'APPROVED'
      version.signature_hash = 'e2e-signature'
      await route.fulfill({ json: version })
    },
  )

  await page.route(
    /\/api\/operations\/placement-assignments\/(\d+)\/acknowledge\/$/,
    async (route) => {
      const id = Number(
        route.request().url().match(/placement-assignments\/(\d+)\/acknowledge/)?.[1],
      )
      for (const version of versions) {
        const assignment = version.assignments.find((a) => a.id === id)
        if (assignment) {
          assignment.acknowledged_at = '2026-08-04T10:00:00Z'
          await route.fulfill({ json: assignment })
          return
        }
      }
    },
  )

  // Story 17.7e — журнал штаба (17.7a/17.7c).
  const journalEntries: JournalEntry[] = []
  let nextJournalEntryId = 1

  await page.route(
    /\/api\/operations\/security-events\/(\d+)\/journal-entries\/$/,
    async (route) => {
      const eventId = Number(
        route.request().url().match(/security-events\/(\d+)\/journal-entries/)?.[1],
      )
      if (route.request().method() === 'GET') {
        await route.fulfill({
          json: journalEntries.filter((e) => e.event === eventId),
        })
        return
      }
      const body = JSON.parse(route.request().postData() ?? '{}') as {
        entry_type: 'BRIEFING' | 'DIRECTIVE'
        text: string
      }
      const entry: JournalEntry = {
        id: nextJournalEntryId++,
        event: eventId,
        entry_type: body.entry_type,
        text: body.text,
        post: null,
        participant_ids: [],
        photo_attachment_id: null,
        created_by: 'placement-operator-e2e',
        created_at: '2026-08-04T10:30:00Z',
      }
      journalEntries.push(entry)
      await route.fulfill({ status: 201, json: entry })
    },
  )

  // Story 17.7e — каскадная замена выбывшего (17.7b/17.7d).
  await page.route(
    /\/api\/operations\/assignment-versions\/(\d+)\/replace-departed\/$/,
    async (route) => {
      const id = Number(
        route.request().url().match(/assignment-versions\/(\d+)\/replace-departed/)?.[1],
      )
      const version = versions.find((v) => v.id === id)!
      const body = JSON.parse(route.request().postData() ?? '{}') as {
        departed_employee_id?: string
        reason?: string
        sanction?: string
      }
      version.is_current = false
      const replacement: Version = {
        id: nextVersionId++,
        event: version.event,
        status: 'APPROVED',
        version: version.version + 1,
        is_current: true,
        signature_hash: 'e2e-replacement-signature',
        created_at: '2026-08-04T10:45:00Z',
        updated_at: '2026-08-04T10:45:00Z',
        assignments: version.assignments.map((a) =>
          a.employee_id === body.departed_employee_id
            ? {
                ...a,
                id: nextAssignmentId++,
                employee_id: '99999999-9999-9999-9999-999999999999',
              }
            : { ...a, id: nextAssignmentId++ },
        ),
      }
      versions.push(replacement)
      await route.fulfill({ status: 201, json: replacement })
    },
  )

  return { versions }
}

test('полный цикл: список → деталь → подать → вернуть → новый драфт → подать → утвердить (с конфликтом) → отметить ознакомление', async ({
  page,
}) => {
  await stubApi(page)
  await page.goto(HARNESS)

  // 1. Список → деталь (реальная навигация).
  await expect(page.getByRole('heading', { name: 'Расстановка' })).toBeVisible()
  await page.getByRole('link', { name: 'Событие #5' }).click()
  await expect(page.getByRole('heading', { name: /Версия 1/ })).toBeVisible()

  // 2. Подать на согласование.
  await page.getByRole('button', { name: 'Подать на согласование' }).click()
  await expect(page.getByRole('heading', { name: /На согласовании/ })).toBeVisible()

  // 3. Вернуть на доработку — модалка, редирект на новый драфт.
  await page.getByRole('button', { name: 'Вернуть на доработку' }).click()
  const returnDialog = page.getByRole('dialog')
  await returnDialog.getByLabel('Причина возврата').fill('Проверить состав постов')
  await returnDialog.getByRole('button', { name: 'Вернуть' }).click()
  await expect(returnDialog).not.toBeVisible()
  await expect(page.getByRole('heading', { name: /Версия 2/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Черновик/ })).toBeVisible()

  // 4. Подать новый драфт.
  await page.getByRole('button', { name: 'Подать на согласование' }).click()
  await expect(page.getByRole('heading', { name: /На согласовании/ })).toBeVisible()

  // 5. Утвердить — новый драфт (после return) наследует СБРОШЕННОЕ
  //    conflict-состояние (реальный бэк bulk_create'ит только version/
  //    employee_id/post_id) — этот шаг демонстрирует ЧИСТЫЙ approve, БЕЗ
  //    конфликта. Реальный 409-конфликт → ConflictDialog → override —
  //    отдельный сценарий ниже (v1 несёт исходный SOFT-конфликт).
  await page.getByRole('button', { name: 'Утвердить' }).click()
  await expect(page.getByRole('heading', { name: /Утверждена/ })).toBeVisible()

  // 5.5. Story 17.7e (AC-1): написать запись в журнал штаба через
  // РЕАЛЬНУЮ форму (17.7c) — jsdom-тесты уже покрывают все ветки/ошибки,
  // здесь только happy-path в настоящем браузере.
  await page.getByRole('combobox').selectOption('DIRECTIVE')
  await page.getByPlaceholder('Текст записи').fill('Усилить контроль на посту №2')
  await page.getByRole('button', { name: 'Добавить запись' }).click()
  await expect(page.getByText('Усилить контроль на посту №2')).toBeVisible()

  // 6. Отметить ознакомление.
  await page.getByRole('button', { name: 'Отметить ознакомление' }).click()
  await expect(page.getByRole('button', { name: 'Отметить ознакомление' })).toHaveCount(0)
  // review-note (пробел этой стори): журнал-запись (шаг 5.5) теперь ТОЖЕ
  // несёт "2026" в своей метке времени — /2026/ на всей странице стал
  // неоднозначным, скоуп на таблицу назначений сохраняет исходную
  // проверку узкой.
  await expect(page.getByRole('table').getByText(/2026/)).toBeVisible()
})

test('утверждение с реальным конфликтом требует override через ConflictDialog', async ({
  page,
}) => {
  const { versions } = await stubApi(page)
  // Submit v1 directly through the stub state (bypassing UI clicks not
  // under test here) so this scenario starts at SUBMITTED-with-conflict.
  versions[0].status = 'SUBMITTED'
  await page.goto(HARNESS)

  await page.getByRole('link', { name: 'Событие #5' }).click()
  await expect(page.getByRole('heading', { name: /На согласовании/ })).toBeVisible()

  await page.getByRole('button', { name: 'Утвердить' }).click()
  const conflictDialog = page.getByRole('dialog')
  await expect(conflictDialog).toBeVisible()
  await conflictDialog
    .getByLabel('Причина (10–500 символов)')
    .fill('Разрешено вручную после проверки состава')
  await conflictDialog.getByRole('button', { name: /Подтвердить/ }).click()
  await expect(conflictDialog).not.toBeVisible()
  await expect(page.getByRole('heading', { name: /Утверждена/ })).toBeVisible()
})

test('Story 17.7e (AC-2): «Снять и заменить» — реальный <dialog>, редирект на новую версию', async ({
  page,
}) => {
  const { versions } = await stubApi(page)
  // Начинаем сразу с APPROVED+текущей — та же экономия, что 16.8i's
  // конфликт-сценарий (submit/approve через UI уже покрыты первым тестом).
  versions[0].status = 'APPROVED'
  await page.goto(HARNESS)

  await page.getByRole('link', { name: 'Событие #5' }).click()
  await expect(page.getByRole('heading', { name: /Утверждена/ })).toBeVisible()

  await page.getByRole('button', { name: /Снять и заменить/ }).click()
  const replaceDialog = page.getByRole('dialog')
  await expect(replaceDialog).toBeVisible()
  await replaceDialog.getByLabel('Причина').fill('Выбыл по болезни')
  await replaceDialog.getByLabel('Санкция').fill('Приказ №12')
  await replaceDialog.getByRole('button', { name: 'Заменить' }).click()

  await expect(replaceDialog).not.toBeVisible()
  await expect(page.getByRole('heading', { name: /Версия 2/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Утверждена/ })).toBeVisible()
})
