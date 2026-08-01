// @vitest-environment jsdom
// Юнит-гвард печатного канона (8.8, AC 7): jsdom CSS не парсит (Ловушка 11) —
// ассертим РАЗМЕТКУ (classList, структура, глифы); computed styles и загрузку
// шрифтов судит только e2e-смок (e2e/print.spec.ts, реальный браузер).
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PrintTestPage } from './PrintTestPage'

afterEach(cleanup)

// Покрытие обоих сабсетов кириллицы: Ә Ғ Қ Ң Ө Ү Һ — cyrillic-ext; Ұ І — cyrillic
const KAZAKH_GLYPHS = ['Ә', 'Ғ', 'Қ', 'Ң', 'Ө', 'Ұ', 'Ү', 'Һ', 'І']

describe('PrintTestPage: печатный канон (ARCH-FE-014/L255)', () => {
  it('classList КАЖДОГО элемента ⊆ /^print-/ — ни одного UI-класса на бумаге', () => {
    render(<PrintTestPage />)
    const offenders = Array.from(document.querySelectorAll('*'))
      .flatMap((el) => Array.from(el.classList))
      .filter((cls) => !/^print-/.test(cls))
    expect(offenders).toEqual([])
  })

  it('шапка на казахском содержит реальные глифы казахской кириллицы', () => {
    render(<PrintTestPage />)
    const header = document.querySelector('.print-root header')
    expect(header).not.toBeNull()
    const text = header?.textContent ?? ''
    for (const glyph of KAZAKH_GLYPHS) {
      expect(text).toContain(glyph)
    }
  })

  it('мини-эталон doc-print: таблица с ИИН-маской, жирный итог «Общее» в tfoot, примечание, экранная подсказка', () => {
    render(<PrintTestPage />)
    // итоговая строка — именно в tfoot (жирность задаёт print.css)
    expect(document.querySelector('tfoot')?.textContent).toContain('Общее')
    // ИИН — только маской ****** + last4 (контракт doc-print)
    expect(screen.getAllByText(/^\*{6}\d{4}$/).length).toBeGreaterThan(0)
    // примечание 8pt и экранная подсказка (no-print) присутствуют в разметке
    expect(document.querySelector('.print-note')).toBeInTheDocument()
    expect(document.querySelector('.print-screen-hint')).toBeInTheDocument()
  })
})
