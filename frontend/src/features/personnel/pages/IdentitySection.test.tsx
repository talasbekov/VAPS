// @vitest-environment jsdom
// §20.27 «Персональные данные» на экране. Главное, что здесь проверяется:
// после потери полномочия значение НЕ ОСТАЁТСЯ нигде — ни в тексте, ни в
// `title`, ни в `aria-label`, ни в URL, ни в storage.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../shared/api/testing/server'
import { clearCredential, setCredential } from '../../../shared/auth/credential'
import { ToastProvider } from '../../../shared/ui/toast'
import { IdentitySection } from './IdentitySection'
import type { PersonnelDirectoryEntry } from '../api/pending-contracts'

const IIN = '800101300123'
const EMPLOYEE_ID = 'employee-1'
const DISCLOSE_URL = `*/api/ops/personnel-directory/${EMPLOYEE_ID}/identity-disclosure/`
const LOG_URL = `*/api/ops/personnel-directory/${EMPLOYEE_ID}/identity-disclosures/`

function entry(overrides: Partial<PersonnelDirectoryEntry> = {}): PersonnelDirectoryEntry {
  return {
    id: EMPLOYEE_ID,
    fullName: 'Нуртаев Ердаулет Асхатович',
    rankCode: 'COLONEL',
    positionCode: 'SR_OFFICER',
    divisionId: 'division-3',
    personnelNumber: '00428',
    hireDate: '2013-06-01',
    dismissalDate: null,
    employmentStatus: 'WORKING',
    iinMasked: '••••••••0123',
    canRevealIin: true,
    ...overrides,
  }
}

/** Раскрытие с заданным сроком; журнал по умолчанию пуст. */
function mockDisclosure(expiresAt: string): void {
  server.use(
    http.post(DISCLOSE_URL, () =>
      HttpResponse.json({
        disclosureId: 'disclosure-1',
        employeeId: EMPLOYEE_ID,
        iin: IIN,
        disclosedAt: '2026-07-20T08:00:00.000Z',
        expiresAt,
      }),
    ),
    http.get(LOG_URL, () => HttpResponse.json({ results: [] })),
  )
}

function renderSection(employee = entry()): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    )
  }
  render(<IdentitySection employee={employee} />, { wrapper: Wrapper })
}

/** Значение не должно остаться НИГДЕ: ни в тексте, ни в атрибутах, ни в
 * хранилищах, ни в адресе — §20.27 перечисляет их поимённо. */
function expectIinGone(): void {
  expect(document.body.textContent ?? '').not.toContain(IIN)
  expect(document.body.innerHTML).not.toContain(IIN)
  expect(window.location.href).not.toContain(IIN)
  expect(JSON.stringify({ ...localStorage })).not.toContain(IIN)
  expect(JSON.stringify({ ...sessionStorage })).not.toContain(IIN)
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'demo-admin' })
  server.use(http.get(LOG_URL, () => HttpResponse.json({ results: [] })))
})

afterEach(() => {
  cleanup()
  clearCredential()
  vi.useRealTimers()
})

describe('Идентификационные данные (§20.27)', () => {
  it('по умолчанию показана маска, полного значения на экране нет', async () => {
    renderSection()
    expect(await screen.findByText('••••••••0123')).toBeInTheDocument()
    expectIinGone()
  })

  it('без права раскрытия кнопка выключена, а причина названа ВИДИМЫМ текстом', async () => {
    renderSection(entry({ canRevealIin: false }))
    expect(await screen.findByRole('button', { name: 'Раскрыть ИИН' })).toBeDisabled()
    // Выключенная кнопка не получает фокус — `title` недостижим с клавиатуры.
    expect(screen.getByText(/personnel\.identity\.reveal/)).toBeInTheDocument()
  })

  it('раскрытие требует цели: тело запроса несёт её, отказ сервера показан', async () => {
    const bodies: unknown[] = []
    server.use(
      http.post(DISCLOSE_URL, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json(
          {
            error_code: 'PURPOSE_REQUIRED',
            message: 'Укажите цель раскрытия — не короче 10 символов.',
            details: {},
            request_id: null,
            timestamp: '2026-07-20T08:00:00.000Z',
          },
          { status: 422 },
        )
      }),
      http.get(LOG_URL, () => HttpResponse.json({ results: [] })),
    )
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: 'Раскрыть ИИН' }))
    await userEvent.type(screen.getByLabelText(/Цель раскрытия/), 'нет')
    await userEvent.click(screen.getByRole('button', { name: 'Раскрыть' }))

    expect(await screen.findByText(/Укажите цель раскрытия/)).toBeInTheDocument()
    expect(bodies).toEqual([{ purpose: 'нет' }])
    expectIinGone()
  })

  it('после раскрытия значение видно вместе со сроком полномочия', async () => {
    mockDisclosure('2999-01-01T00:00:00.000Z')
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: 'Раскрыть ИИН' }))
    await userEvent.type(
      screen.getByLabelText(/Цель раскрытия/),
      'Сверка данных при оформлении допуска',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Раскрыть' }))

    expect(await screen.findByText(IIN)).toBeInTheDocument()
    expect(screen.getByText(/полномочие действует до/)).toBeInTheDocument()
    // Значение НЕ продублировано в атрибуты — §20.27 «не оставляй значение в
    // Tooltip и aria-label».
    const holder = screen.getByText(IIN)
    expect(holder.getAttribute('title')).toBeNull()
    expect(holder.getAttribute('aria-label')).toBeNull()
    expect(window.location.href).not.toContain(IIN)
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(IIN)
  })

  it('«Скрыть» убирает значение из DOM целиком, а не только с глаз', async () => {
    mockDisclosure('2999-01-01T00:00:00.000Z')
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: 'Раскрыть ИИН' }))
    await userEvent.type(
      screen.getByLabelText(/Цель раскрытия/),
      'Сверка данных при оформлении допуска',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Раскрыть' }))
    expect(await screen.findByText(IIN)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Скрыть' }))
    await waitFor(() => expect(screen.queryByText(IIN)).not.toBeInTheDocument())
    expectIinGone()
    expect(screen.getByText('••••••••0123')).toBeInTheDocument()
  })

  it('истёкшее полномочие само стирает значение — без действий пользователя', async () => {
    // Срок уже в прошлом относительно часов клиента: полномочие выдано, но
    // действовать ему нечем. Экран обязан вернуться к маске сам.
    mockDisclosure('2020-01-01T00:00:00.000Z')
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: 'Раскрыть ИИН' }))
    await userEvent.type(
      screen.getByLabelText(/Цель раскрытия/),
      'Сверка данных при оформлении допуска',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Раскрыть' }))

    await waitFor(() => expect(screen.getByText('••••••••0123')).toBeInTheDocument())
    expectIinGone()
  })

  it('журнал раскрытий: 403 объяснён своим правом, а не выдан за «обращений не было»', async () => {
    server.use(
      http.get(LOG_URL, () =>
        HttpResponse.json(
          {
            error_code: 'PERMISSION_DENIED',
            message: 'Недостаточно прав.',
            details: {},
            request_id: null,
            timestamp: '2026-07-20T08:00:00.000Z',
          },
          { status: 403 },
        ),
      ),
    )
    renderSection()

    expect(await screen.findByText(/читается по своему праву/)).toBeInTheDocument()
    expect(screen.queryByText('Обращений к идентификатору не было.')).not.toBeInTheDocument()
  })

  it('журнал показывает кто, когда и зачем — и не показывает что именно увидели', async () => {
    server.use(
      http.get(LOG_URL, () =>
        HttpResponse.json({
          results: [
            {
              disclosureId: 'disclosure-1',
              employeeId: EMPLOYEE_ID,
              actorUserId: 'demo-admin',
              purpose: 'Сверка данных при оформлении допуска',
              disclosedAt: '2026-07-20T08:00:00.000Z',
              expiresAt: '2026-07-20T08:15:00.000Z',
            },
          ],
        }),
      ),
    )
    renderSection()

    expect(await screen.findByText(/Сверка данных при оформлении допуска/)).toBeInTheDocument()
    expect(screen.getByText(/demo-admin/)).toBeInTheDocument()
    expectIinGone()
  })
})
