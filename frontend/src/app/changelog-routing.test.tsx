// @vitest-environment jsdom
// Стори 10.9 — футер каркаса и разводка /changelog (AC-4, AC-5, AC-6, AC-12).
//
// ⚠️ ФАЙЛ ОБЯЗАН ЛЕЖАТЬ В src/app/, а не в слоте фичи: из features/** импорт
// AppRoutes запрещён boundaries/dependencies, и блок навешен на src/**/*.{ts,tsx}
// БЕЗ исключения для тестов. Образец — print-expense-routing.test.tsx (10.7).
//
// 🔴 ПОЧЕМУ ТЕСТ ИДЁТ ЧЕРЕЗ НАСТОЯЩИЙ AppLayout, А НЕ ЧЕРЕЗ ГОЛЫЙ ФУТЕР:
// красная проба QA 11.4 доказала, что компонент шапки можно ЦЕЛИКОМ выдернуть
// из каркаса и 527 тестов останутся зелёными, если его судят в изоляции.
// Футер живёт инлайном в AppLayout (Решение №1) и проверяется только отсюда.
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { server } from '../shared/api/testing/server'
import { clearCredential, setCredential } from '../shared/auth/credential'
import { ACCESS_DENIED_TEXT, PERMISSIONS_ERROR_TEXT } from '../shared/auth/guards'
import { ROUTES } from '../shared/routes'
import { APP_VERSION, BUILD_SHA, buildLabel } from '../shared/version'
import { AppRoutes } from './App'
import { Providers } from './providers'

// Radix DropdownMenu в jsdom: полифиллы per-file (общий setup 8.4 не трогаем).
// Каркас тянет DropdownMenu — без них монтирование AppLayout падает.
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

// clearCredential именно в afterEach: упавший раньше тест утёк бы credential
// соседям (находка ревью 10.6, MEDIUM)
afterEach(() => {
  cleanup()
  clearCredential()
  sessionStorage.clear()
})

const DIVISION_ID = '7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'
const BUSINESS_DATE = '2026-07-19'

/** Право в тестах не появляется само — нужны ОБА шага (ловушка 10.6 №0). */
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

/** Оба запроса печатной формы — onUnhandledRequest:'error' уронил бы любой незамоканный. */
function stubExpensePrintData() {
  const columns = {
    IN_SERVICE: 71,
    ON_DUTY: 13,
    AFTER_DUTY: 9,
    COMMAND: 5,
    TRAINING: 3,
    VACATION: 8,
    SICK: 6,
    DETACHED: 2,
    BEFORE_DUTY: 1,
    OTHER: 4,
    PENDING: 7,
  }
  const totals = {
    staff_total: 140,
    list_total: 129,
    vacancies: 11,
    attached: 12,
    columns,
  }
  server.use(
    http.get('*/api/operations/expense-reports/period/', () =>
      HttpResponse.json({
        pages: [
          {
            business_date: BUSINESS_DATE,
            totals,
            rows: [
              {
                division_id: DIVISION_ID,
                name: 'Шығыс басқармасы',
                ...totals,
              },
            ],
          },
        ],
      }),
    ),
    http.get('*/api/core/divisions/', () =>
      HttpResponse.json({
        count: 1,
        next: null,
        previous: null,
        results: [
          { id: DIVISION_ID, name: 'Шығыс басқармасы', parent: null, is_active: true },
        ],
      }),
    ),
  )
}

describe('футер каркаса (AC-4)', () => {
  it('на разделе портала есть РОВНО ОДИН contentinfo, а в нём — ссылка версии', async () => {
    grantPermissions(['status.view'])
    renderAt(ROUTES.home)

    // ждём, пока каркас смонтируется (раздел за RequirePermission)
    expect(
      await screen.findByRole('heading', { name: /Дашборд/ }),
    ).toBeInTheDocument()

    const footers = screen.getAllByRole('contentinfo')
    expect(footers).toHaveLength(1)

    // 🔴 regex, НЕ литеральный номер: литерал сгниёт на первом же бампе версии
    // и сломается, если в env гейта окажется VAPS_APP_VERSION (AC-4).
    // `\d` — потому что канон-строка «Версия приложения» на странице журнала
    // тоже начинается со слова «Версия» (поймано в ChangelogPage.test.tsx).
    const link = within(footers[0]).getByRole('link', { name: /^Версия \d/ })
    expect(link).toHaveTextContent(APP_VERSION)
    expect(link).toHaveAttribute('href', ROUTES.changelog)
  })

  // ═══ QA-добор 10.9: МЕТКА СБОРКИ В ФУТЕРЕ ═══
  // AC-4 требует «при непустом sha — метка сборки», но её не ассертил ни один
  // тест проекта (греп по `сборка|buildLabel|BUILD_SHA` в тестах → 0 строк).
  // Весь блок `{build === '' ? null : (…)}` можно было удалить из AppLayout,
  // и 783 теста остались бы зелёными — ровно тот класс, что 11.4 показала на
  // компоненте шапки.
  it('🔴 в футере есть метка сборки с реальным sha, и она отделена «·»', async () => {
    expect(BUILD_SHA).not.toBe('')
    grantPermissions(['status.view'])
    renderAt(ROUTES.home)

    expect(
      await screen.findByRole('heading', { name: /Дашборд/ }),
    ).toBeInTheDocument()

    const footer = screen.getByRole('contentinfo')
    // производная от значения, а НЕ литерал: sha меняется каждым коммитом
    expect(within(footer).getByText(buildLabel(BUILD_SHA))).toBeInTheDocument()
    expect(footer).toHaveTextContent(BUILD_SHA)
    // разделитель — часть контракта «Версия X · сборка Y»; он aria-hidden,
    // поэтому проверяется текстом узла, а не ролью
    expect(footer.textContent).toContain('·')
  })

  // Ветка «пустой sha» живёт в ОТДЕЛЬНОМ файле changelog-footer-nosha.test.tsx:
  // подменять BUILD_SHA приходится hoisted-моком на весь модуль, а здесь это
  // испортило бы соседние тесты, судящие футер по НАСТОЯЩИМ константам сборки.
  // Через doMock + resetModules сделать нельзя: свежий граф даёт второй
  // экземпляр AuthContext, и Providers из статического графа его не наполняет
  // («useAuth вызван вне <AuthProvider>» — поймано красной пробой).

  it('футер виден и на другом разделе — он в каркасе, а не на экране', async () => {
    grantPermissions(['audit.view'])
    renderAt(ROUTES.audit)

    expect(
      await screen.findByRole('heading', { name: 'Аудит' }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1)
  })

  it('🔴 футер БЕЗ списочной разметки: ни одного listitem от каркаса', async () => {
    // Не стилистика: харнес e2e-harness/notifications.tsx монтирует настоящий
    // AppLayout, а ЧЕТЫРЕ чужих e2e-ассерта считают listitem ПО ВСЕЙ СТРАНИЦЕ
    // (notifications.spec.ts:313,322-323,374 и e2e-live/notifications-live.spec.ts:195-196).
    // Один из них живёт в e2e-live/, который в этой стори вообще не прогоняется —
    // значит ограничение обязано держаться ПО ПОСТРОЕНИЮ, а не по прогону.
    grantPermissions(['status.view'])
    renderAt(ROUTES.home)

    expect(
      await screen.findByRole('heading', { name: /Дашборд/ }),
    ).toBeInTheDocument()
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).queryAllByRole('listitem')).toHaveLength(0)
    expect(within(footer).queryAllByRole('list')).toHaveLength(0)
  })

  it('на печатном роуте /print/test футера НЕТ (сиблинг layout-route)', async () => {
    grantPermissions(['status.view'])
    renderAt(ROUTES.printTest)

    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
  })

  it('на печатной форме расхода футера НЕТ — бумага не несёт каркас', async () => {
    grantPermissions(['daily_report.generate', 'status.view'])
    stubExpensePrintData()
    renderAt(ROUTES.printExpenseTo(DIVISION_ID, BUSINESS_DATE))

    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(document.querySelector('main.print-root')).toBeInTheDocument()
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
  })
})

describe('вход в журнал — ссылка версии (AC-4, правило «роут без входа — мёртвый продукт»)', () => {
  it('клик по версии в футере ОТКРЫВАЕТ страницу журнала', async () => {
    grantPermissions(['status.view'])
    const user = userEvent.setup()
    renderAt(ROUTES.home)

    expect(
      await screen.findByRole('heading', { name: /Дашборд/ }),
    ).toBeInTheDocument()

    await user.click(
      within(screen.getByRole('contentinfo')).getByRole('link', {
        name: /^Версия \d/,
      }),
    )

    expect(
      await screen.findByRole('heading', { level: 1, name: /Журнал/ }),
    ).toBeInTheDocument()
    // журнал живёт ВНУТРИ каркаса — футер на месте и после перехода
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
  })
})

describe('доступ к журналу (AC-6)', () => {
  it('🔴 permissions: [] → журнал РЕНДЕРИТСЯ, а не «Доступ запрещён»', async () => {
    // credential ставится ОБЯЗАТЕЛЬНО: без него тест был бы зелёным по
    // отсутствию credential (редирект на /login) и про гейт не доказывал бы ничего
    grantPermissions([])
    renderAt(ROUTES.changelog)

    expect(
      await screen.findByRole('heading', { level: 1, name: /Журнал/ }),
    ).toBeInTheDocument()
    expect(screen.queryByText(ACCESS_DENIED_TEXT)).not.toBeInTheDocument()
    // секции на месте — страница настоящая, а не пустая оболочка
    expect(
      screen.getByRole('heading', { name: 'Версия приложения' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Закрытые исправления' }),
    ).toBeInTheDocument()
  })

  it('без credential прямой заход на журнал → редирект на /login', async () => {
    // RequireAuth даёт родительский layout-route — своей обёртки не добавляли
    renderAt(ROUTES.changelog)

    expect(
      await screen.findByLabelText('Идентификатор (X-User-Id)'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
  })

  it('журнал НЕ добавлен в NAV_SECTIONS — вход только через футер (AC-7)', async () => {
    const { NAV_SECTIONS } = await import('../shared/routes')
    expect(
      NAV_SECTIONS.some((section) => section.route === ROUTES.changelog),
    ).toBe(false)
    // 6 существующих + 2 Smart Josparlau (commandCenter, securityEvents, Этап 2)
    // + 1 (objects, Этап 5) + 1 (serviceAnalytics, Этап 7) + 1 (duties, Этап 7)
    // + 1 (dictionaries, §30) + 1 (calendar, §25)
    // + 1 (serviceReports, §22.18, Этап 40) + 1 (feedback, §28)
    // + 1 (settings, §29) + 1 (ratings, §19.4) — changelog среди них нет
    expect(NAV_SECTIONS).toHaveLength(18)
  })
})

describe('футер переживает отказ прав (AC-5, NFR-8)', () => {
  // Цена дефолтных ретраев Query: запрос прав ретраится ВТРОЕ (~7 с до
  // финального error) — providers.tsx:34-40 глушит ретраи только МУТАЦИЙ.
  // Ловушка «локальный QueryClient с retry:false» здесь НЕ применима: тест
  // обязан идти через настоящий Providers, на нём держится Решение №1.
  // Образец таймаутов — app-layout.qa.test.tsx:179-190.
  it(
    '🔴 500 на my-permissions: сайдбар пуст, «не удалось проверить права» — А ВЕРСИЯ ВИДНА',
    { timeout: 15_000 },
    async () => {
      setCredential({ kind: 'dev', userId: 'operator-omd-7' })
      server.use(
        http.get('*/api/operations/my-permissions/', () =>
          HttpResponse.json({ detail: 'boom' }, { status: 500 }),
        ),
      )
      renderAt(ROUTES.home)

      const alert = await screen.findByRole('alert', {}, { timeout: 12_000 })
      expect(alert).toHaveTextContent(PERMISSIONS_ERROR_TEXT)

      const nav = screen.getByRole('navigation', { name: 'Разделы' })
      expect(within(nav).queryAllByRole('link')).toHaveLength(0)

      // ВОТ РАДИ ЧЕГО ВСЁ: версию читают ровно тогда, когда что-то сломалось.
      // Футер не делает ни одного запроса — достигается по построению, тест
      // это закрепляет.
      const footer = screen.getByRole('contentinfo')
      expect(
        within(footer).getByRole('link', { name: /^Версия \d/ }),
      ).toBeInTheDocument()
    },
  )
})
