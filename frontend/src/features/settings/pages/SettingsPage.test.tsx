// @vitest-environment jsdom
// «Настройки» §29: экран администрирования политики. Проверяется ЖИВОЙ путь
// через MSW — список, правка с причиной, отказы 400/422 и состояние
// «просмотр без изменения», которое приходит С СЕРВЕРА.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'

import { server } from '../../../shared/api/testing/server'
import { clearCredential, setCredential } from '../../../shared/auth/credential'
import { ToastProvider } from '../../../shared/ui/toast'
import { SettingsPage } from './SettingsPage'

afterEach(() => {
  cleanup()
  clearCredential()
  sessionStorage.clear()
})

// jsdom не реализует методы <dialog> — минимальный полифилл open-семантики,
// тот же, что в ConflictDialog.test.tsx.
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
}

const PARAMETER = {
  settingCode: 'ATTENTION.ACKNOWLEDGEMENT_MISSING.PARAMETER',
  kind: 'NUMBER' as const,
  sectionCode: 'ATTENTION_POLICY' as const,
  groupCode: 'ACKNOWLEDGEMENT_MISSING',
  field: 'PARAMETER' as const,
  safeLabel: 'Срок упреждения по отметке об ознакомлении',
  description: 'За сколько суток до заступления отсутствие отметки становится наблюдением.',
  valueType: 'DAYS' as const,
  value: 3,
  minValue: 1,
  maxValue: 30,
  updatedAt: null,
  updatedBy: null,
  editable: true,
  lockedReason: null,
  action: { canEdit: true, disabledReason: null },
}

const WARNING = {
  ...PARAMETER,
  settingCode: 'ATTENTION.CONFLICT_SHARE.WARNING_FROM',
  groupCode: 'CONFLICT_SHARE',
  field: 'WARNING_FROM' as const,
  safeLabel: 'Доля конфликтных записей — порог предупреждения',
  valueType: 'PERCENT' as const,
  value: 18,
  minValue: 1,
  maxValue: 100,
}

/** Правило конфликтов §21.35 — вторая секция экрана и единственная запись-режим. */
const REST_MODE = {
  settingCode: 'CONFLICT.REST_AFTER_DUTY.MODE',
  kind: 'CHOICE' as const,
  sectionCode: 'CONFLICT_RULES' as const,
  groupCode: 'REST_AFTER_DUTY',
  field: 'MODE' as const,
  safeLabel: 'Режим обязательного отдыха после дежурства',
  description: 'Как поступать с назначением, попадающим в период обязательного отдыха.',
  valueType: 'MODE' as const,
  value: 'SOFT_OVERRIDE',
  options: [
    { value: 'HARD_BLOCK', safeLabel: 'Жёсткий запрет', description: 'Назначение отвергается.' },
    {
      value: 'SOFT_OVERRIDE',
      safeLabel: 'Обход с обоснованием',
      description: 'Назначение подтверждается с причиной.',
    },
  ],
  updatedAt: null,
  updatedBy: null,
  editable: true,
  lockedReason: null,
  action: { canEdit: true, disabledReason: null },
}

/** §21.34: пересечение — hard-конфликт, режим не переключается НИ ДЛЯ КОГО. */
const OVERLAP_LOCKED = {
  ...REST_MODE,
  settingCode: 'CONFLICT.DUTY_OVERLAP.MODE',
  groupCode: 'DUTY_OVERLAP',
  safeLabel: 'Режим пересечения дежурств',
  value: 'HARD_BLOCK',
  options: [REST_MODE.options[0]],
  editable: false,
  lockedReason: 'Пересечение с другим дежурством — hard-конфликт (§21.34).',
  action: {
    canEdit: false,
    disabledReason: 'Пересечение с другим дежурством — hard-конфликт (§21.34).',
  },
}

function withAction<T extends { action: { canEdit: boolean } }>(item: T, canEdit: boolean) {
  return canEdit
    ? item
    : {
        ...item,
        action: { canEdit: false, disabledReason: 'Право на администрирование не выдано.' },
      }
}

function listResponse(canManage: boolean) {
  return HttpResponse.json({
    results: [
      withAction(PARAMETER, canManage),
      withAction(WARNING, canManage),
      withAction(REST_MODE, canManage),
      OVERLAP_LOCKED,
    ],
    sectionVersions: {
      ATTENTION_POLICY: 'attention-policy-2026.07.1',
      CONFLICT_RULES: 'conflict-rules-2026.07.1',
      PASSPORT_FRESHNESS: 'passport-freshness-2026.07.1',
    },
  })
}

function seedHandlers(options: {
  canManage: boolean
  patch?: Parameters<typeof server.use>[0]
  changeLog?: unknown[]
}) {
  server.use(
    http.get('*/api/ops/settings/', () => listResponse(options.canManage)),
    http.get('*/api/ops/setting-changes/', () =>
      HttpResponse.json({ results: options.changeLog ?? [] }),
    ),
    ...(options.patch === undefined ? [] : [options.patch]),
  )
}

function renderPage() {
  setCredential({ kind: 'dev', userId: 'demo-admin' })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SettingsPage />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('SettingsPage (§29)', () => {
  it('печатает действующую версию политики и значения с их единицами', async () => {
    seedHandlers({ canManage: true })
    renderPage()

    expect(await screen.findByText(/attention-policy-2026\.07\.1/)).toBeInTheDocument()
    expect(screen.getByText('3 сут.')).toBeInTheDocument()
    expect(screen.getByText('18 %')).toBeInTheDocument()
    expect(screen.getAllByText('не менялось')).toHaveLength(4)
  })

  it('без права изменения кнопок нет — решение приходит с сервера, а не из вёрстки', async () => {
    seedHandlers({ canManage: false })
    renderPage()

    // Причина у КАЖДОЙ записи своя и приходит с сервера: у трёх — нехватка
    // права, у запертого правила §21.34 — другая, и она видна даже там, где
    // право есть.
    expect(await screen.findAllByText(/Право на администрирование не выдано\./)).toHaveLength(3)
    expect(
      screen.getByText(/Пересечение с другим дежурством — hard-конфликт/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Изменить' })).not.toBeInTheDocument()
  })

  it('сохраняет новое значение вместе с причиной', async () => {
    const bodies: Record<string, unknown>[] = []
    seedHandlers({
      canManage: true,
      patch: http.patch('*/api/ops/settings/:settingCode/', async ({ request, params }) => {
        bodies.push({
          settingCode: decodeURIComponent(params.settingCode as string),
          ...((await request.json()) as Record<string, unknown>),
        })
        return HttpResponse.json({
          setting: { ...PARAMETER, value: 7 },
          sectionVersions: {
            ATTENTION_POLICY: 'attention-policy-2026.07.2',
            CONFLICT_RULES: 'conflict-rules-2026.07.1',
            PASSPORT_FRESHNESS: 'passport-freshness-2026.07.1',
          },
          event: {
            id: 'e1',
            settingCode: PARAMETER.settingCode,
            safeLabel: PARAMETER.safeLabel,
            sectionCode: 'ATTENTION_POLICY',
            oldValue: '3',
            newValue: '7',
            reason: 'Срок увеличен приказом по управлению',
            actorUserId: 'demo-admin',
            changedAt: '2026-07-20T09:00:00+05:00',
            policyVersionAfter: 'attention-policy-2026.07.2',
          },
        })
      }),
    })
    const user = userEvent.setup()
    renderPage()

    await user.click((await screen.findAllByRole('button', { name: 'Изменить' }))[0])
    const dialog = await screen.findByRole('dialog')
    const valueInput = within(dialog).getByLabelText(/Значение \(сут\.\)/)
    await user.clear(valueInput)
    await user.type(valueInput, '7')
    await user.type(
      within(dialog).getByLabelText(/Причина изменения/),
      'Срок увеличен приказом по управлению',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({
      settingCode: PARAMETER.settingCode,
      value: 7,
      reason: 'Срок увеличен приказом по управлению',
    })
  })

  it('короткая причина не отправляется — кнопка сохранения выключена', async () => {
    seedHandlers({ canManage: true })
    const user = userEvent.setup()
    renderPage()

    await user.click((await screen.findAllByRole('button', { name: 'Изменить' }))[0])
    const dialog = await screen.findByRole('dialog')
    const save = within(dialog).getByRole('button', { name: 'Сохранить' })
    // Пустая причина — заблокировано.
    expect(save).toBeDisabled()
    await user.type(within(dialog).getByLabelText(/Причина изменения/), 'коротко')
    expect(save).toBeDisabled()
    // И РАЗБЛОКИРУЕТСЯ, когда причина достаточной длины: иначе проверка была
    // бы вакуумной — кнопка могла бы быть выключена всегда.
    await user.type(within(dialog).getByLabelText(/Причина изменения/), ' но уже достаточно')
    expect(save).toBeEnabled()
  })

  it('422 (правило политики) показывается как неотменяемый отказ', async () => {
    seedHandlers({
      canManage: true,
      patch: http.patch('*/api/ops/settings/:settingCode/', () =>
        HttpResponse.json(
          {
            error_code: 'SETTING_THRESHOLD_ORDER_INVALID',
            message: 'Порог предупреждения (40) не может быть выше критического (34).',
            details: {},
            request_id: null,
            timestamp: '2026-07-20T09:00:00+05:00',
          },
          { status: 422 },
        ),
      ),
    })
    const user = userEvent.setup()
    renderPage()

    await user.click((await screen.findAllByRole('button', { name: 'Изменить' }))[1])
    const dialog = await screen.findByRole('dialog')
    const valueInput = within(dialog).getByLabelText(/Значение \(%\)/)
    await user.clear(valueInput)
    await user.type(valueInput, '40')
    await user.type(
      within(dialog).getByLabelText(/Причина изменения/),
      'Порог поднят по решению руководителя',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'не может быть выше критического',
    )
    // Форма осталась открытой: правило политики не обходится «причиной», и
    // диалог обхода здесь появиться не должен.
    expect(screen.queryByText(/Конфликт:/)).not.toBeInTheDocument()
  })

  it('400 раскладывается по полям формы', async () => {
    seedHandlers({
      canManage: true,
      patch: http.patch('*/api/ops/settings/:settingCode/', () =>
        HttpResponse.json(
          {
            error_code: 'VALIDATION_ERROR',
            message: 'Проверьте заполнение формы.',
            details: { value: ['Допустимый диапазон — от 1 до 30.'] },
            request_id: null,
            timestamp: '2026-07-20T09:00:00+05:00',
          },
          { status: 400 },
        ),
      ),
    })
    const user = userEvent.setup()
    renderPage()

    await user.click((await screen.findAllByRole('button', { name: 'Изменить' }))[0])
    const dialog = await screen.findByRole('dialog')
    const valueInput = within(dialog).getByLabelText(/Значение \(сут\.\)/)
    await user.clear(valueInput)
    await user.type(valueInput, '29')
    await user.type(
      within(dialog).getByLabelText(/Причина изменения/),
      'Срок увеличен приказом по управлению',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }))

    expect(await within(dialog).findByText('Допустимый диапазон — от 1 до 30.')).toBeInTheDocument()
  })

  it('история изменений печатает old → new, причину и версию политики', async () => {
    seedHandlers({
      canManage: true,
      changeLog: [
        {
          id: 'e1',
          settingCode: PARAMETER.settingCode,
          safeLabel: PARAMETER.safeLabel,
          oldValue: 3,
          newValue: 7,
          reason: 'Срок увеличен приказом по управлению',
          actorUserId: 'demo-admin',
          changedAt: '2026-07-20T09:00:00+05:00',
          policyVersionAfter: 'attention-policy-2026.07.2',
        },
      ],
    })
    renderPage()

    expect(await screen.findByText(/3 → 7/)).toBeInTheDocument()
    expect(screen.getByText(/Причина: Срок увеличен приказом по управлению/)).toBeInTheDocument()
    expect(screen.getByText(/версия политики attention-policy-2026\.07\.2/)).toBeInTheDocument()
  })

  it('пустая история подписана словами, а не пустым местом', async () => {
    seedHandlers({ canManage: true })
    renderPage()
    expect(await screen.findByText(/политика действует в исходной редакции/)).toBeInTheDocument()
  })
})
