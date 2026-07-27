// @vitest-environment jsdom
// §21.31/§21.33/§21.34 — форма создания дежурства.
//
// Проверяется РОВНО то, чем форма отличается от сервера: она ничего не решает
// сама. Причина недоступности объекта, «что подбор не учитывает» и severity
// конфликта приходят готовыми — тесты подсовывают ответы, ЗАВЕДОМО расходящиеся
// с тем, что форма могла бы вывести сама (тот же приём, что в
// MonthlyDutyPlanSection.test.tsx с KPI 42 при одной смене в сетке).
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../../shared/api/testing/server'
import { clearCredential, setCredential } from '../../../shared/auth/credential'
import { ToastProvider } from '../../../shared/ui/toast'
import { CreateDutyShiftForm } from './CreateDutyShiftForm'
import type { DutyTypeDefinition } from '../model/types'

const ME_URL = '*/api/operations/my-permissions/'
const PLAN_OBJECTS_URL = '*/api/ops/duty-plan-objects/'
const CANDIDATES_URL = '*/api/ops/duty-candidates/'
const CREATE_URL = '*/api/ops/duty-shifts/'

const DUTY_TYPES: DutyTypeDefinition[] = [
  {
    dutyTypeCode: 'PROTECTED_OBJECT_DAILY',
    safeLabel: 'Суточное дежурство на охраняемом объекте',
    targetType: 'PROTECTED_OBJECT',
    defaultDurationMinutes: 1440,
    requiresSenior: false,
    restAfterMinutes: 720,
    restPolicy: 'SOFT_OVERRIDE',
    requiresCurrentPassport: true,
  },
]

const AVAILABLE_OBJECT = {
  objectId: 'object-1',
  objectName: 'Дворец Независимости',
  objectCode: 'OBJ-001',
  passportState: 'GREEN',
  applicableVersionId: 'v1',
  applicableVersionNumber: 1,
  applicableVersionEffectiveFrom: '2026-01-01',
  sectors: [
    {
      sectorId: 'sector-a',
      sectorName: 'Сектор A',
      posts: [
        { postId: 'post-1', postName: 'КПП-1', task: 'Контроль въезда', requirements: 'Допуск A' },
      ],
    },
  ],
  blockReason: null,
}

// Паспорт ЗЕЛЁНЫЙ, версия есть, посты есть — и всё равно заблокирован. Форма
// обязана показать серверную причину, а не переспорить её своими данными.
const BLOCKED_OBJECT = {
  ...AVAILABLE_OBJECT,
  objectId: 'object-2',
  objectName: 'Дом Министерств',
  objectCode: 'OBJ-002',
  blockReason: 'Причина от сервера: объект закрыт на реконструкцию.',
}

const CANDIDATES = {
  businessDate: '2026-07-24',
  results: [
    {
      employeeName: 'Ахметов Б.',
      unitName: '1-й отдел охраны',
      positionName: 'Старший инспектор',
      nearestDutyDate: '2026-07-28',
      busyOnRequestedDate: false,
    },
  ],
  unavailableAttributes: [
    { code: 'AVAILABILITY', label: 'Доступность', reason: 'Employee Status Repository нет.' },
  ],
}

function mockForm(
  options: { objects?: unknown[]; onCreate?: Parameters<typeof http.post>[1] } = {},
): void {
  server.use(
    http.get(ME_URL, () => HttpResponse.json({ permissions: ['ops.duty.manage'] })),
    http.get(PLAN_OBJECTS_URL, () =>
      HttpResponse.json({
        businessDate: '2026-07-24',
        results: options.objects ?? [AVAILABLE_OBJECT, BLOCKED_OBJECT],
      }),
    ),
    http.get(CANDIDATES_URL, () => HttpResponse.json(CANDIDATES)),
    http.post(
      CREATE_URL,
      options.onCreate ??
        (() => HttpResponse.json({ id: 'duty-new', businessDate: '2026-07-24' })),
    ),
  )
}

function renderForm(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    )
  }
  render(<CreateDutyShiftForm dutyTypes={DUTY_TYPES} defaultBusinessDate="2026-07-24" />, {
    wrapper: Wrapper,
  })
}

// jsdom не реализует методы <dialog> — тот же минимальный полифилл, что в
// `shared/ui/ConflictDialog.test.tsx` (только open-семантика; top-layer и
// фокус-трап здесь не ассертятся, они нативные).
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'planner-1' })
})

afterEach(() => {
  cleanup()
  clearCredential()
})

describe('CreateDutyShiftForm — §21.31 создание дежурства', () => {
  it('без ops.duty.manage форма не рендерится вовсе', async () => {
    server.use(http.get(ME_URL, () => HttpResponse.json({ permissions: ['ops.duty.view'] })))
    renderForm()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Создать дежурство' })).not.toBeInTheDocument(),
    )
  })

  it('показывает продолжительность и правила отдыха ИЗ ВИДА дежурства, не своими константами', async () => {
    mockForm()
    renderForm()
    await userEvent.click(await screen.findByRole('button', { name: 'Создать дежурство' }))

    // 720 минут = 12 ч: если бы форма хардкодила «24 часа» (§21.35 это прямо
    // запрещает), здесь было бы 24.
    expect(
      await screen.findByText(/Продолжительность 24 ч · обязательный отдых 12 ч/),
    ).toBeInTheDocument()
    expect(screen.getByText(/нарушение обходится с обоснованием/)).toBeInTheDocument()
    expect(screen.getByText(/актуальный паспорт обязателен/)).toBeInTheDocument()
  })

  it('заблокированный объект остаётся в списке, а причина приходит от сервера дословно', async () => {
    mockForm()
    renderForm()
    await userEvent.click(await screen.findByRole('button', { name: 'Создать дежурство' }))

    const objectSelect = await screen.findByLabelText('Объект')
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /Дом Министерств/ })).toBeInTheDocument(),
    )
    // Объект НЕ спрятан — §21.31 «состояние данных»: исчезнувший объект
    // читался бы как несуществующий.
    await userEvent.selectOptions(objectSelect, 'object-2')
    expect(
      await screen.findByText('Причина от сервера: объект закрыт на реконструкцию.'),
    ).toBeInTheDocument()
    // Пост у заблокированного объекта не предлагается, отправка невозможна.
    expect(screen.queryByLabelText('Пост')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Создать дежурство' })).toBeDisabled()
  })

  it('§21.33: показывает занятость кандидата и ЧТО подбор не учитывает', async () => {
    mockForm()
    renderForm()
    await userEvent.click(await screen.findByRole('button', { name: 'Создать дежурство' }))

    await waitFor(() =>
      expect(
        screen.getByRole('option', { name: /Ахметов Б\..*ближайшее дежурство 2026-07-28/ }),
      ).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByText(/Что подбор не учитывает/))
    expect(screen.getByText(/Employee Status Repository нет\./)).toBeInTheDocument()
  })

  it('отправляет снимок сектора и поста выбранной версии паспорта', async () => {
    let body: Record<string, unknown> | null = null
    mockForm({
      onCreate: async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ id: 'duty-new' })
      },
    })
    renderForm()
    await userEvent.click(await screen.findByRole('button', { name: 'Создать дежурство' }))

    await userEvent.selectOptions(await screen.findByLabelText('Объект'), 'object-1')
    expect(await screen.findByText('Паспорт: ред. 1 от 2026-01-01')).toBeInTheDocument()
    await userEvent.selectOptions(await screen.findByLabelText('Пост'), 'sector-a::post-1')
    expect(screen.getByText(/Задача: Контроль въезда\. Требования: Допуск A/)).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Сотрудник'), 'Ахметов Б.')
    await userEvent.type(screen.getByLabelText(/Примечание/), 'Усиление')
    await userEvent.click(screen.getByRole('button', { name: 'Создать дежурство' }))

    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toEqual({
      businessDate: '2026-07-24',
      dutyTypeCode: 'PROTECTED_OBJECT_DAILY',
      objectId: 'object-1',
      sectorId: 'sector-a',
      postId: 'post-1',
      employeeName: 'Ахметов Б.',
      note: 'Усиление',
    })
  })

  it('§21.34: 409 открывает общий ConflictDialog, повтор уходит с override_reason', async () => {
    const bodies: Record<string, unknown>[] = []
    mockForm({
      onCreate: async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        bodies.push(body)
        if (body.override !== true) {
          return HttpResponse.json(
            {
              error_code: 'DUTY_CONFLICT_DETECTED',
              message: 'Нарушение обязательного отдыха.',
              details: { conflicts: [{ conflict_code: 'REST_AFTER_DUTY' }] },
              request_id: null,
              timestamp: '2026-07-24T09:00:00+05:00',
            },
            { status: 409 },
          )
        }
        return HttpResponse.json({ id: 'duty-new' })
      },
    })
    renderForm()
    await userEvent.click(await screen.findByRole('button', { name: 'Создать дежурство' }))
    await userEvent.selectOptions(await screen.findByLabelText('Объект'), 'object-1')
    await userEvent.selectOptions(await screen.findByLabelText('Пост'), 'sector-a::post-1')
    await userEvent.selectOptions(screen.getByLabelText('Сотрудник'), 'Ахметов Б.')
    await userEvent.click(screen.getByRole('button', { name: 'Создать дежурство' }))

    // Диалог — ОБЩИЙ shared/ui/ConflictDialog, а не свой: его подпись и правило
    // «10–500 символов» приходят оттуда.
    expect(
      await screen.findByText('Конфликт: Нарушение обязательного отдыха.'),
    ).toBeInTheDocument()
    expect(screen.getByText('REST_AFTER_DUTY')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(/Причина/), 'Некем заменить, приказ №5')
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить оверрайд' }))

    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1]).toMatchObject({
      override: true,
      override_reason: 'Некем заменить, приказ №5',
      // Исходное тело обязано доехать целиком: повтор — та же смена, а не
      // пустой запрос с одним флагом.
      objectId: 'object-1',
      postId: 'post-1',
      employeeName: 'Ахметов Б.',
    })
  })

  it('422 показывается текстом формы и НЕ открывает диалог обхода', async () => {
    mockForm({
      onCreate: () =>
        HttpResponse.json(
          {
            error_code: 'DUTY_CONFLICT_HARD',
            message: 'Ахметов Б.: 2 дежурства в один день (2026-07-24).',
            details: {},
            request_id: null,
            timestamp: '2026-07-24T09:00:00+05:00',
          },
          { status: 422 },
        ),
    })
    renderForm()
    await userEvent.click(await screen.findByRole('button', { name: 'Создать дежурство' }))
    await userEvent.selectOptions(await screen.findByLabelText('Объект'), 'object-1')
    await userEvent.selectOptions(await screen.findByLabelText('Пост'), 'sector-a::post-1')
    await userEvent.selectOptions(screen.getByLabelText('Сотрудник'), 'Ахметов Б.')
    await userEvent.click(screen.getByRole('button', { name: 'Создать дежурство' }))

    expect(
      await screen.findByText('Ахметов Б.: 2 дежурства в один день (2026-07-24).'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Подтвердить оверрайд' })).not.toBeInTheDocument()
  })
})
