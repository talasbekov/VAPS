// @vitest-environment jsdom
// Компонентные тесты глобального тоста (канал «5xx/network» ARCH-FE-015, AC 5):
// авто-dismiss по TOAST_AUTO_DISMISS_MS (fake timers — константа экспортирована
// именно для этого), замена сообщения с перезарядкой таймера, guard useToast
// вне провайдера. jest-dom — per-file (общий vitest.setup.ts гоняется и в
// node-тестах 8.4).
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TOAST_AUTO_DISMISS_MS, ToastProvider, useToast } from './toast'

// vitest globals выключены → авто-cleanup RTL не регистрируется сам
afterEach(cleanup)
afterEach(() => {
  vi.useRealTimers()
})

function ToastProbe({ message, label }: { message: string; label: string }) {
  const { toast } = useToast()
  return (
    <button type="button" onClick={() => toast(message)}>
      {label}
    </button>
  )
}

describe('ToastProvider: aria-live регион', () => {
  it('toast(message) показывает сообщение; авто-скрытие ровно через TOAST_AUTO_DISMISS_MS', () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <ToastProbe message="Сервис недоступен" label="Показать" />
      </ToastProvider>,
    )
    // постоянный live-регион: существует и ДО сообщения (screen-reader'ы не
    // ловят динамически созданные регионы)
    const status = screen.getByRole('status')
    expect(status).toBeEmptyDOMElement()

    fireEvent.click(screen.getByRole('button', { name: 'Показать' }))
    expect(status).toHaveTextContent('Сервис недоступен')

    act(() => vi.advanceTimersByTime(TOAST_AUTO_DISMISS_MS - 1))
    expect(status).toHaveTextContent('Сервис недоступен')
    act(() => vi.advanceTimersByTime(1))
    expect(status).toBeEmptyDOMElement()
  })

  it('второй toast заменяет сообщение и перезаряжает таймер (дедлайн первого не гасит второе)', () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <ToastProbe message="Первое сообщение" label="Первый" />
        <ToastProbe message="Второе сообщение" label="Второй" />
      </ToastProvider>,
    )
    const status = screen.getByRole('status')

    fireEvent.click(screen.getByRole('button', { name: 'Первый' }))
    act(() => vi.advanceTimersByTime(TOAST_AUTO_DISMISS_MS - 2000))
    fireEvent.click(screen.getByRole('button', { name: 'Второй' }))
    expect(status).toHaveTextContent('Второе сообщение')

    // дедлайн ПЕРВОГО тоста уже позади — второе живёт свои полные 6 секунд
    act(() => vi.advanceTimersByTime(TOAST_AUTO_DISMISS_MS - 1))
    expect(status).toHaveTextContent('Второе сообщение')
    act(() => vi.advanceTimersByTime(1))
    expect(status).toBeEmptyDOMElement()
  })

  it('useToast вне ToastProvider кидает понятную ошибку (guard монтажа из app)', () => {
    // рендер-ошибка без error boundary всплывает из render; React дублирует
    // её в console.error — глушим, чтобы не шуметь в выводе vitest
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<ToastProbe message="x" label="Показать" />)).toThrow(
      /вне ToastProvider/,
    )
    consoleError.mockRestore()
  })
})
