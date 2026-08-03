// @vitest-environment jsdom
// Read-only просмотр опубликованной версии паспорта по deep link.
// Гейт (`ops.object.view`) стоит снаружи, в роутере — фикстура прав не нужна.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../../shared/api/testing/server'
import { clearCredential, setCredential } from '../../../shared/auth/credential'
import { ROUTES } from '../../../shared/routes'
import {
  ObjectPassportVersionPage,
  READ_ONLY_HINT,
  VERSION_NOT_FOUND_TEXT,
} from './ObjectPassportVersionPage'

const OBJECT_ID = 'object-1'
const VERSION_ID = 'object-1-passport-v1'
const OBJECT_URL = '*/api/ops/objects/:id/'

const OBJECT_BODY = {
  id: OBJECT_ID,
  name: 'Дворец Независимости',
  code: 'OBJ-001',
  type: 'Государственное учреждение',
  region: 'г. Астана',
  address: 'пр. Мангилик Ел, 55',
  objectState: 'ACTIVE',
  passportState: 'GREEN',
  // Действующая редакция УЖЕ отличается от опубликованной версии — так и
  // проверяется, что страница показывает снимок, а не черновик.
  sectors: [
    {
      id: 'sector-1',
      name: 'Сектор A (переименован после публикации)',
      posts: [
        { id: 'post-1', name: 'КПП-1 (переделан)', task: 'Другая задача', requirements: '' },
      ],
    },
  ],
  passportVersions: [
    {
      id: VERSION_ID,
      versionNumber: 1,
      effectiveFrom: '2026-07-20',
      publishedAt: '2026-07-20T08:00:00+05:00',
      publishedBy: 'demo-seed',
      note: 'Первичная публикация паспорта объекта.',
      sectors: [
        {
          id: 'sector-1',
          name: 'Сектор A',
          posts: [
            { id: 'post-1', name: 'КПП-1', task: 'Контроль въезда', requirements: 'Допуск «Объект A»' },
          ],
        },
      ],
    },
  ],
  createdAt: '2026-07-20T08:00:00+05:00',
  updatedAt: '2026-07-21T08:00:00+05:00',
}

function renderVersion(versionId: string): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter
          initialEntries={[ROUTES.objectPassportVersionTo(OBJECT_ID, versionId)]}
        >
          <Routes>
            <Route path={ROUTES.objectPassportVersion} element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
  render(<ObjectPassportVersionPage />, { wrapper: Wrapper })
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'operator-1' })
  server.use(http.get(OBJECT_URL, () => HttpResponse.json(OBJECT_BODY)))
})

afterEach(() => {
  cleanup()
  clearCredential()
})

describe('Версия паспорта объекта (deep link)', () => {
  it('показывает СНИМОК версии, а не действующую редакцию', async () => {
    renderVersion(VERSION_ID)

    expect(
      await screen.findByRole('heading', { name: /Дворец Независимости · версия 1/ }),
    ).toBeInTheDocument()
    expect(screen.getByText('Сектор A')).toBeInTheDocument()
    expect(screen.getByText('КПП-1')).toBeInTheDocument()
    // Черновик (действующая редакция) на страницу версии не протекает.
    expect(
      screen.queryByText('Сектор A (переименован после публикации)'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/КПП-1 \(переделан\)/)).not.toBeInTheDocument()
    expect(screen.getByText(READ_ONLY_HINT)).toBeInTheDocument()
    expect(screen.getByText('Первичная публикация паспорта объекта.')).toBeInTheDocument()
  })

  it('версия read-only: ни одного интерактивного контрола', async () => {
    renderVersion(VERSION_ID)

    await screen.findByRole('heading', { name: /версия 1/ })
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(screen.queryAllByRole('textbox')).toEqual([])
    expect(screen.getAllByRole('link').length).toBeGreaterThan(0)
  })

  it('чужой versionId — названная причина, а не пустая страница', async () => {
    renderVersion('object-9-passport-v7')

    expect(await screen.findByText(VERSION_NOT_FOUND_TEXT)).toBeInTheDocument()
    expect(screen.queryByText('КПП-1')).not.toBeInTheDocument()
  })
})
