// @vitest-environment jsdom
// Story 10.9: страница журнала «сообщено → исправлено» — статический рендер
// manifest-каркаса (shared/lib/appManifest), БЕЗ сети/роутера: компонент не
// зовёт useQuery и не рисует ссылок, обвязка Providers/MemoryRouter не нужна.
// Пустые состояния (AC-3) — через подменённый проп manifest (изолированный
// рендер), дефолтный рендер — против импортированного APP_MANIFEST (не дубль).
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { APP_MANIFEST } from '../../shared/lib/appManifest'
import type { AppManifest } from '../../shared/lib/appManifest'
import {
  ChangelogPage,
  E13_NOTE_TEXT,
  EMPTY_JOURNAL_TEXT,
  NO_FIXES_TEXT,
} from './ChangelogPage'

afterEach(cleanup)

describe('ChangelogPage: рендер manifest-каркаса (AC-2)', () => {
  it('H1 «Сообщено → исправлено» + записи APP_MANIFEST: версия и дата каждой', () => {
    render(<ChangelogPage />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Сообщено → исправлено' }),
    ).toBeInTheDocument()
    for (const entry of APP_MANIFEST.entries) {
      // ассерты против импортированного каркаса, не дубль-литералов;
      // точный матч, не RegExp: '.' в 'v0.1.0' без экранирования матчил бы
      // лишнее, а при >1 записи неякорный regex дал бы multiple-match
      expect(
        screen.getByRole('heading', { name: entry.version }),
      ).toBeInTheDocument()
      expect(screen.getByText(entry.date)).toBeInTheDocument()
    }
    // честная пометка: наполнение из багрепортов приедет в E13 (константа,
    // не regex /E13/ — тот полувакуумен и ломается при втором упоминании E13)
    expect(screen.getByText(E13_NOTE_TEXT)).toBeInTheDocument()
  })

  it('инвариант manifest: версия приложения = версия верхней записи (единый источник, новые сверху)', () => {
    // «единый источник версии» — иначе version и entries[0].version — два
    // независимых литерала, дрейф не ловится ни типом, ни футером (AC-1)
    expect(APP_MANIFEST.entries[0]?.version).toBe(APP_MANIFEST.version)
  })

  it('запись с fixes → список исправлений рендерится пунктами', () => {
    const manifest: AppManifest = {
      version: 'v9.9.9',
      entries: [
        {
          version: 'v9.9.9',
          date: '2026-01-01',
          fixes: ['Починили дату сдачи', 'Убрали дубль строки расхода'],
        },
      ],
    }
    render(<ChangelogPage manifest={manifest} />)

    expect(
      screen.getByRole('list', { name: 'Исправления v9.9.9' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Починили дату сдачи')).toBeInTheDocument()
    expect(
      screen.getByText('Убрали дубль строки расхода'),
    ).toBeInTheDocument()
    expect(screen.queryByText(NO_FIXES_TEXT)).not.toBeInTheDocument()
  })
})

describe('ChangelogPage: честные пустые состояния (AC-3)', () => {
  it('fixes: [] → явный текст «исправлений нет», не пустой блок', () => {
    const manifest: AppManifest = {
      version: 'v0.2.0',
      entries: [{ version: 'v0.2.0', date: '2026-02-02', fixes: [] }],
    }
    render(<ChangelogPage manifest={manifest} />)

    expect(screen.getByText(NO_FIXES_TEXT)).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('entries: [] → явный текст пустого журнала', () => {
    const manifest: AppManifest = { version: 'v0.0.1', entries: [] }
    render(<ChangelogPage manifest={manifest} />)

    expect(screen.getByText(EMPTY_JOURNAL_TEXT)).toBeInTheDocument()
  })
})
