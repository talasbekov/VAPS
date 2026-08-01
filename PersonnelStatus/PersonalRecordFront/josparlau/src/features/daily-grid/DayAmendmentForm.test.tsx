// @vitest-environment jsdom
// Story 10.6 — форма исправления сдачи (AC-2, AC-7).
//
// Что этот файл доказывает: форма собирает РОВНО два поля, не пускает отправку
// с пустыми (после trim) значениями и проходима с клавиатуры. Сеть здесь не
// участвует — форма её не знает: `onSubmit` отдаёт тело наверх, POST шлёт
// панель (`DaySubmissionPanel.test.tsx` проверяет уже провод).
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { SANCTION_MAX } from './amendment'
import { DayAmendmentForm } from './DayAmendmentForm'
import type { DayAmendmentFormProps } from './DayAmendmentForm'

afterEach(() => cleanup())

const BUSINESS_DATE = '2026-07-19'

function renderForm(over: Partial<DayAmendmentFormProps> = {}) {
  const props: DayAmendmentFormProps = {
    businessDate: BUSINESS_DATE,
    isPending: false,
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  }
  render(<DayAmendmentForm {...props} />)
  return props
}

function submitButton() {
  return screen.getByRole('button', { name: 'Подтвердить исправление' })
}

it('AC-2: форма собирает РОВНО два поля — «Причина» и «Санкция»', () => {
  renderForm()

  expect(screen.getByLabelText('Причина')).toBeInTheDocument()
  expect(screen.getByLabelText(/Санкция/)).toBeInTheDocument()
  // Ровно два — третьего поля ввода на форме нет. Провенанс (triggered_by_
  // status_id) бэк не принимает вовсе (ЛОВУШКА №4 5.8b), и поле под него на
  // экране обещало бы влияние, которого нет.
  const form = screen.getByRole('form', { name: 'Исправление сдачи' })
  expect(form.querySelectorAll('input, textarea')).toHaveLength(2)
})

it('AC-2: кнопка подтверждения НЕактивна, пока оба поля пусты', () => {
  renderForm()
  expect(submitButton()).toBeDisabled()
})

it('AC-2: заполнена только причина → кнопка всё ещё НЕактивна', async () => {
  const user = userEvent.setup()
  renderForm()

  await user.type(screen.getByLabelText('Причина'), 'Ошибка в ростере')

  expect(submitButton()).toBeDisabled()
})

it('AC-2: причина из одних ПРОБЕЛОВ не считается заполненной (мерим после trim)', async () => {
  const user = userEvent.setup()
  renderForm()

  await user.type(screen.getByLabelText('Причина'), '     ')
  await user.type(screen.getByLabelText(/Санкция/), 'Выговор')

  expect(submitButton()).toBeDisabled()
})

it('AC-2: оба поля заполнены → кнопка активна', async () => {
  const user = userEvent.setup()
  renderForm()

  await user.type(screen.getByLabelText('Причина'), 'Ошибка в ростере')
  await user.type(screen.getByLabelText(/Санкция/), 'Выговор')

  expect(submitButton()).toBeEnabled()
})

it(`AC-2: у санкции виден счётчик и предел ${SANCTION_MAX}`, async () => {
  const user = userEvent.setup()
  renderForm()

  const sanction = screen.getByLabelText(/Санкция/)
  expect(sanction).toHaveAttribute('maxLength', String(SANCTION_MAX))
  expect(screen.getByTestId('sanction-counter')).toHaveTextContent(`0/${SANCTION_MAX}`)

  await user.type(sanction, 'Выговор')

  expect(screen.getByTestId('sanction-counter')).toHaveTextContent(`7/${SANCTION_MAX}`)
})

it('AC-3: onSubmit получает тело РОВНО {reason, sanction}, обрезанные trim()', async () => {
  const user = userEvent.setup()
  const props = renderForm()

  await user.type(screen.getByLabelText('Причина'), '  Ошибка в ростере  ')
  await user.type(screen.getByLabelText(/Санкция/), '  Выговор  ')
  await user.click(submitButton())

  expect(props.onSubmit).toHaveBeenCalledTimes(1)
  expect(props.onSubmit).toHaveBeenCalledWith({
    reason: 'Ошибка в ростере',
    sanction: 'Выговор',
  })
})

it('«Отмена» закрывает форму и отправку НЕ делает', async () => {
  const user = userEvent.setup()
  const props = renderForm()

  await user.type(screen.getByLabelText('Причина'), 'Ошибка в ростере')
  await user.type(screen.getByLabelText(/Санкция/), 'Выговор')
  await user.click(screen.getByRole('button', { name: 'Отмена' }))

  expect(props.onCancel).toHaveBeenCalledTimes(1)
  expect(props.onSubmit).not.toHaveBeenCalled()
})

it('AC-7: клавиатурный путь — tab + ввод + Enter на кнопке даёт ОДИН вызов с верным телом', async () => {
  // ⚠️ Ассерт на ОТПРАВЛЕННОМ теле, а не на document.activeElement: «фокус
  // куда-то встал» — известная вакуумная форма (инциденты 9.9, 11.4).
  const user = userEvent.setup()
  const props = renderForm()

  await user.tab() // → «Причина»
  await user.keyboard('Ошибка в ростере')
  await user.tab() // → «Санкция»
  await user.keyboard('Выговор')
  await user.tab() // → «Подтвердить исправление»
  await user.keyboard('{Enter}')

  expect(props.onSubmit).toHaveBeenCalledTimes(1)
  expect(props.onSubmit).toHaveBeenCalledWith({
    reason: 'Ошибка в ростере',
    sanction: 'Выговор',
  })
})

it('AC-7: implicit submission — Enter в однострочной «Санкции» отправляет форму', async () => {
  // В textarea Enter — перевод строки, поэтому implicit submission возможен
  // только из однострочного поля. Без <form> Enter не отправил бы НИЧЕГО:
  // у панели-прецедента все кнопки type="button" и формы нет вовсе.
  const user = userEvent.setup()
  const props = renderForm()

  await user.type(screen.getByLabelText('Причина'), 'Ошибка в ростере')
  await user.type(screen.getByLabelText(/Санкция/), 'Выговор{Enter}')

  expect(props.onSubmit).toHaveBeenCalledTimes(1)
})

it('пустая форма + Enter → отправки НЕТ (владелец гарда — disabled на кнопке)', async () => {
  // Ревью 10.6 закрыло наблюдение Б QA-прогона: дубль-гард `if (!canSubmit)
  // return` из `handleSubmit` снят как недостижимый (implicit submission и в
  // chromium, и в user-event идёт ЧЕРЕЗ кнопку по умолчанию — до тела
  // handleSubmit пустая форма не доезжает). Пока гарда было два, они взаимно
  // перекрывались и этот тест не мог покраснеть ни от одного одиночного
  // дефекта («дублирующие гарды → вакуумная проба»). Теперь владелец ОДИН:
  // красная проба ревью — снять `disabled={!canSubmit}` → этот тест 🔴.
  const user = userEvent.setup()
  const props = renderForm()

  await user.type(screen.getByLabelText(/Санкция/), '{Enter}')

  expect(props.onSubmit).not.toHaveBeenCalled()
})

it('AC-3: isPending → кнопка заблокирована (второй отправки из формы не будет)', async () => {
  const user = userEvent.setup()
  const props = renderForm({ isPending: true })

  await user.type(screen.getByLabelText('Причина'), 'Ошибка в ростере')
  await user.type(screen.getByLabelText(/Санкция/), 'Выговор')

  expect(submitButton()).toBeDisabled()
  await user.click(submitButton())
  expect(props.onSubmit).not.toHaveBeenCalled()
})

it('дата дня названа в подтверждении — оператор видит, ЧТО правит', () => {
  renderForm()
  expect(
    screen.getByText(`Исправить сдачу за ${BUSINESS_DATE}?`),
  ).toBeInTheDocument()
})
