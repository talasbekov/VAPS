// @vitest-environment jsdom
// QA-добор стори 10.9 (workflow qa-generate-e2e-tests) — ВЕТКА «СБОРКА ВНЕ GIT».
//
// ═══ ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ ═══
// AC-1 объявляет пустой `__BUILD_SHA__` штатным состоянием («сборка вне git»),
// AC-4 требует, чтобы при нём метка сборки НЕ рендерилась. Проверить это
// внутри changelog-routing.test.tsx нельзя:
//   · `vi.mock` поднимается в начало файла и подменил бы константы ВСЕМ
//     соседним тестам, которые судят футер по НАСТОЯЩЕЙ версии сборки —
//     то есть лечение оказалось бы хуже болезни;
//   · `vi.doMock` + `vi.resetModules()` + динамический импорт `./App` даёт
//     ВТОРОЙ экземпляр модуля AuthContext, а `Providers` статического графа
//     наполняет первый: рендер падает «useAuth вызван вне <AuthProvider>»
//     (поймано красной пробой при написании этого добора).
// Отдельный файл — единственный способ, при котором и мок честный, и соседи
// целы. Граф здесь один: замокан только `shared/version`.
//
// ═══ ПОЧЕМУ БЕЗ МОКА НЕЛЬЗЯ ═══
// `define` действует и в vitest (ловушка 1 спеки), поэтому на любой машине с
// git `BUILD_SHA` — реальный sha коммита и НИКОГДА не пуст. Ветка `build === ''`
// недостижима по построению — ровно тот класс, который AC-9 называет
// украшением: «каждая ветка карты отказов обязана иметь тест с фикстурой»
// (урок 10.5, HIGH). До этого файла обе ветки метки сборки были не покрыты
// ничем: греп по `сборка|buildLabel|BUILD_SHA` в тестах давал 0 строк.
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server } from '../shared/api/testing/server'
import { clearCredential, setCredential } from '../shared/auth/credential'
import { ROUTES } from '../shared/routes'
import { AppRoutes } from './App'
import { Providers } from './providers'

// Подменяется ТОЛЬКО BUILD_SHA. versionLabel/buildLabel/APP_VERSION остаются
// настоящими: подменять поведение функций значило бы тестировать мок, а не
// каркас — гасить метку обязан САМ футер, а не подсунутая реализация.
vi.mock('../shared/version', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/version')>()),
  BUILD_SHA: '',
}))

// Radix DropdownMenu в jsdom: полифиллы per-file (общий setup 8.4 не трогаем).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= () => {}
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.releasePointerCapture ??= () => {}

afterEach(() => {
  cleanup()
  clearCredential()
  sessionStorage.clear()
})

function grantPermissions(permissions: string[]) {
  setCredential({ kind: 'dev', userId: 'operator-omd-7' })
  server.use(
    http.get('*/api/operations/my-permissions/', () =>
      HttpResponse.json({ permissions }),
    ),
  )
}

function renderAt(entry: string) {
  return render(
    <Providers>
      <MemoryRouter initialEntries={[entry]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
}

describe('футер при пустом sha — сборка вне git (AC-1, AC-4)', () => {
  it('мок доехал: BUILD_SHA действительно пуст', async () => {
    // Негативный контроль. Без него весь файл был бы вакуумен: не сработавший
    // мок оставил бы настоящий sha, метка отрисовалась бы, и ассерты ниже
    // краснели бы «по делу» — но по совершенно другой причине.
    const { BUILD_SHA } = await import('../shared/version')
    expect(BUILD_SHA).toBe('')
  })

  it('🔴 метки сборки НЕТ, а версия на месте', async () => {
    grantPermissions(['status.view'])
    renderAt(ROUTES.home)

    expect(
      await screen.findByRole('heading', { name: /Дашборд/ }),
    ).toBeInTheDocument()

    const footer = screen.getByRole('contentinfo')
    // «неизвестно» пользователю не рендерим (buildLabel), но и ссылку версии
    // пустой sha гасить не должен — читать версию нужно ИМЕННО в сломанном контуре
    expect(
      within(footer).getByRole('link', { name: /^Версия \d/ }),
    ).toBeInTheDocument()
    expect(within(footer).queryByText(/^сборка/)).not.toBeInTheDocument()
  })

  it('🔴 висячего разделителя «·» тоже нет', async () => {
    // ТОЧЕЧНЫЙ ассерт на разделитель, а не только на текст метки: `buildLabel('')`
    // и так отдаёт пустую строку, поэтому снятый гард `build === '' ? null`
    // отрисовал бы «Версия 0.1.0 ·» — метки нет, а мусор есть, и ассерт
    // предыдущего теста остался бы ЗЕЛЁНЫМ. Класс «дубль-гард → вакуумная
    // проба» (урок 10.6, MEDIUM): у ветки обязан быть один владелец, и здесь
    // это футер.
    grantPermissions(['status.view'])
    renderAt(ROUTES.home)

    expect(
      await screen.findByRole('heading', { name: /Дашборд/ }),
    ).toBeInTheDocument()

    const footer = screen.getByRole('contentinfo')
    expect(footer.textContent).not.toContain('·')
  })

  it('🔴 страница журнала при пустом sha тоже без метки сборки', async () => {
    // Вторая копия того же условия живёт в ChangelogPage — гард там свой, и
    // проверять его надо отдельно (иначе «одна ветка покрыта» превратилось бы
    // в «покрыт один из двух её владельцев»).
    grantPermissions([])
    renderAt(ROUTES.changelog)

    expect(
      await screen.findByRole('heading', { level: 1, name: /Журнал/ }),
    ).toBeInTheDocument()

    // скоуп на <main>: на /changelog подпись версии есть И в футере, И в
    // секции страницы — голый getByText нашёл бы два узла (поймано прогоном)
    const page = within(screen.getByRole('main'))
    expect(page.getByText(/^Версия \d/)).toBeInTheDocument()
    expect(page.queryByText(/^сборка/)).not.toBeInTheDocument()
    // и в футере тоже — оба владельца ветки проверены одним заходом
    expect(
      within(screen.getByRole('contentinfo')).queryByText(/^сборка/),
    ).not.toBeInTheDocument()
  })
})
