// @vitest-environment jsdom
// Story 10.4 — экран дерева готовности.
//
// Ловушка №1b: у useQuery остаётся дефолт react-query `retry: 3` (providers.tsx
// гасит ретраи ТОЛЬКО для мутаций) — «1 запрос + 3 ретрая ≈ 7 с до финального
// error». Рендерим с локальным QueryClient({retry: false}), иначе тесты AC-8
// выглядят как зависшие.
//
// Фикстуры кириллические (кириллица кусала дважды за E9).
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'

import { server } from '../../shared/api/testing/server'
import { TrafficLightTreePage } from './TrafficLightTreePage'
import { STATUS_LABEL, TRAFFIC_LIGHT_STATUSES } from './trafficLight'
import type { TrafficLightNode } from './trafficLight'

afterEach(() => cleanup())

const TREE_PATH = '*/api/operations/traffic-light/tree/'

const SHTAB = '11111111-1111-4111-8111-111111111111'
const ROTA_1 = '22222222-2222-4222-8222-222222222222'
const ROTA_2 = '33333333-3333-4333-8333-333333333333'
const VZVOD = '44444444-4444-4444-8444-444444444444'

function node(over: Partial<TrafficLightNode> & { division_id: string }): TrafficLightNode {
  return {
    name: 'Подразделение',
    parent_id: null,
    status: 'GREEN',
    late: false,
    ...over,
  }
}

function useTree(nodes: TrafficLightNode[], businessDate = '2026-07-19') {
  server.use(http.get(TREE_PATH, () => HttpResponse.json({ business_date: businessDate, nodes })))
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <TrafficLightTreePage />
    </QueryClientProvider>,
  )
}

/**
 * СОБСТВЕННАЯ строка узла — без вложенного поддерева.
 *
 * ⚠️ Скоуп критичен для ассерта AC-2: `<li>` узла содержит `<ul>` детей, и
 * `within(<li>)` засчитал бы родителю метку РЕБЁНКА — «родитель не красный»
 * падал бы (или, в зеркальном случае, проходил бы вакуумно).
 */
function rowOf(divisionId: string): HTMLElement {
  const li = document.querySelector<HTMLElement>(`[data-traffic-node="${divisionId}"]`)
  if (li === null) throw new Error(`Узел ${divisionId} не смонтирован`)
  const row = li.firstElementChild
  if (!(row instanceof HTMLElement)) throw new Error(`У узла ${divisionId} нет строки`)
  return row
}

function mountedNodeIds(): string[] {
  return [...document.querySelectorAll('[data-traffic-node]')].map(
    (el) => el.getAttribute('data-traffic-node') as string,
  )
}

describe('AC-1 — экран заменил заглушку', () => {
  it('рендерит H1 «Подразделения» и дерево', async () => {
    useTree([node({ division_id: SHTAB, name: 'Штаб бригады', status: 'RED' })])
    renderPage()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Подразделения' }),
    ).toBeInTheDocument()
    expect(await screen.findByText('Штаб бригады')).toBeInTheDocument()
    // Подпись заглушки ушла вместе с ней.
    expect(screen.queryByText('Экран появится в E9–E10')).not.toBeInTheDocument()
  })
})

describe('AC-3 — пять состояний различимы ТЕКСТОМ, не только цветом', () => {
  it('каждый статус несёт свою текст-метку', async () => {
    useTree(
      TRAFFIC_LIGHT_STATUSES.map((status, i) =>
        node({
          division_id: `0000000${i}-0000-4000-8000-000000000000`,
          name: `Подразделение ${status}`,
          status,
        }),
      ),
    )
    renderPage()

    await screen.findByText('Подразделение GREEN')
    for (const status of TRAFFIC_LIGHT_STATUSES) {
      const row = rowOf(
        `0000000${TRAFFIC_LIGHT_STATUSES.indexOf(status)}-0000-4000-8000-000000000000`,
      )
      expect(within(row).getByText(STATUS_LABEL[status])).toBeInTheDocument()
    }
  })

  it('late рендерится отдельной видимой меткой', async () => {
    useTree([
      node({ division_id: SHTAB, name: 'Штаб', status: 'GREEN', late: true }),
      node({ division_id: ROTA_1, name: 'Рота вовремя', status: 'GREEN', late: false }),
    ])
    renderPage()

    await screen.findByText('Штаб')
    expect(within(rowOf(SHTAB)).getByText('с опозданием')).toBeInTheDocument()
    expect(within(rowOf(ROTA_1)).queryByText('с опозданием')).not.toBeInTheDocument()
  })

  it('счёт «48/48» НЕ рендерится — каскад его не несёт', async () => {
    useTree([node({ division_id: SHTAB, name: 'Штаб', status: 'GREEN' })])
    renderPage()

    await screen.findByText('Штаб')
    expect(screen.queryByText(/\d+\s*\/\s*\d+/)).not.toBeInTheDocument()
  })
})

describe('AC-2 — цвет узла = каскад бэка, НЕ пересчёт UI', () => {
  it('родитель GREEN при КРАСНОМ ребёнке остаётся GREEN (фикстура противоречит локальной свёртке)', async () => {
    // Фикстура намеренно противоречива: локальный worstStatus(детей) дал бы
    // RED. Ассерт вакуумен без этого противоречия — на согласованных данных
    // «из ответа» и «пересчитал сам» неразличимы.
    useTree([
      node({ division_id: SHTAB, name: 'Штаб', status: 'GREEN' }),
      node({ division_id: ROTA_1, name: 'Красная рота', parent_id: SHTAB, status: 'RED' }),
    ])
    renderPage()

    await screen.findByText('Штаб')
    // Корень раскрыт по умолчанию — ребёнок виден.
    expect(within(rowOf(SHTAB)).getByText(STATUS_LABEL.GREEN)).toBeInTheDocument()
    expect(within(rowOf(SHTAB)).queryByText(STATUS_LABEL.RED)).not.toBeInTheDocument()
    expect(within(rowOf(ROTA_1)).getByText(STATUS_LABEL.RED)).toBeInTheDocument()
  })

  it('родитель UNKNOWN при зелёных детях остаётся UNKNOWN', async () => {
    useTree([
      node({ division_id: SHTAB, name: 'Штаб', status: 'UNKNOWN' }),
      node({ division_id: ROTA_1, name: 'Зелёная рота', parent_id: SHTAB, status: 'GREEN' }),
    ])
    renderPage()

    await screen.findByText('Штаб')
    expect(within(rowOf(SHTAB)).getByText(STATUS_LABEL.UNKNOWN)).toBeInTheDocument()
  })
})

describe('AC-5 — раскрытие/сворачивание', () => {
  it('дефолт: раскрыт только корень — внуки не смонтированы', async () => {
    useTree([
      node({ division_id: SHTAB, name: 'Штаб' }),
      node({ division_id: ROTA_1, name: 'Первая рота', parent_id: SHTAB }),
      node({ division_id: VZVOD, name: 'Взвод связи', parent_id: ROTA_1 }),
    ])
    renderPage()

    await screen.findByText('Штаб')
    expect(mountedNodeIds()).toEqual([SHTAB, ROTA_1])
    expect(screen.queryByText('Взвод связи')).not.toBeInTheDocument()
  })

  it('клик по раскрывашке монтирует детей, повторный — размонтирует', async () => {
    const user = userEvent.setup()
    useTree([
      node({ division_id: SHTAB, name: 'Штаб' }),
      node({ division_id: ROTA_1, name: 'Первая рота', parent_id: SHTAB }),
      node({ division_id: VZVOD, name: 'Взвод связи', parent_id: ROTA_1 }),
    ])
    renderPage()

    await screen.findByText('Штаб')
    await user.click(screen.getByRole('button', { name: 'Раскрыть Первая рота' }))
    expect(screen.getByText('Взвод связи')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Свернуть Первая рота' }))
    expect(screen.queryByText('Взвод связи')).not.toBeInTheDocument()
  })

  it('сворачивание корня размонтирует его поддерево', async () => {
    const user = userEvent.setup()
    useTree([
      node({ division_id: SHTAB, name: 'Штаб' }),
      node({ division_id: ROTA_1, name: 'Первая рота', parent_id: SHTAB }),
    ])
    renderPage()

    await screen.findByText('Первая рота')
    await user.click(screen.getByRole('button', { name: 'Свернуть Штаб' }))
    expect(screen.queryByText('Первая рота')).not.toBeInTheDocument()
    expect(mountedNodeIds()).toEqual([SHTAB])
  })

  it('у листа раскрывашки нет', async () => {
    useTree([node({ division_id: SHTAB, name: 'Одинокий штаб' })])
    renderPage()

    await screen.findByText('Одинокий штаб')
    expect(within(rowOf(SHTAB)).queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('AC-6 — фильтр «только отстающие»', () => {
  const LAGGING_TREE = [
    node({ division_id: SHTAB, name: 'Штаб', status: 'RED' }),
    node({ division_id: ROTA_1, name: 'Зелёная рота', parent_id: SHTAB, status: 'GREEN' }),
    node({ division_id: ROTA_2, name: 'Красная рота', parent_id: SHTAB, status: 'RED' }),
    node({ division_id: VZVOD, name: 'Взвод связи', parent_id: ROTA_2, status: 'RED' }),
  ]

  it('зелёное поддерево скрыто; ветка к отстающему РАСКРЫТА автоматически', async () => {
    const user = userEvent.setup()
    useTree(LAGGING_TREE)
    renderPage()

    await screen.findByText('Штаб')
    // До фильтра внук под свёрнутой ротой не смонтирован.
    expect(screen.queryByText('Взвод связи')).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('только отстающие'))

    expect(screen.queryByText('Зелёная рота')).not.toBeInTheDocument()
    expect(screen.getByText('Красная рота')).toBeInTheDocument()
    // Ключевое: фильтр ПОКАЗЫВАЕТ — отстающий внук раскрыт до него, а не
    // остался невидим под свёрнутым предком.
    expect(screen.getByText('Взвод связи')).toBeInTheDocument()
  })

  it('NEUTRAL отстающим не считается и прячется', async () => {
    const user = userEvent.setup()
    useTree([
      node({ division_id: SHTAB, name: 'Штаб', status: 'RED' }),
      node({ division_id: ROTA_1, name: 'Резерв', parent_id: SHTAB, status: 'NEUTRAL' }),
    ])
    renderPage()

    await screen.findByText('Резерв')
    await user.click(screen.getByLabelText('только отстающие'))

    expect(screen.queryByText('Резерв')).not.toBeInTheDocument()
    expect(screen.getByText('Штаб')).toBeInTheDocument()
  })

  it('выключение фильтра ВОЗВРАЩАЕТ ручную раскладку, а не «как при фильтре»', async () => {
    const user = userEvent.setup()
    useTree(LAGGING_TREE)
    renderPage()

    await screen.findByText('Штаб')
    // Ручная раскладка: пользователь СВЕРНУЛ корень.
    await user.click(screen.getByRole('button', { name: 'Свернуть Штаб' }))
    expect(screen.queryByText('Красная рота')).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('только отстающие'))
    expect(screen.getByText('Взвод связи')).toBeInTheDocument() // фильтр раскрыл

    await user.click(screen.getByLabelText('только отстающие'))
    // Раскладка пользователя жива: корень снова свёрнут, фильтр её не затёр.
    expect(screen.queryByText('Красная рота')).not.toBeInTheDocument()
    expect(mountedNodeIds()).toEqual([SHTAB])
  })

  it('клик «Свернуть» по АВТО-раскрытому узлу под фильтром не заносит его в ручную раскладку', async () => {
    // Находка ревью 10.4: старый handleToggle решал add/delete по РУЧНОМУ
    // множеству, а кнопка показывала состояние из effectiveExpanded. Под
    // фильтром авто-раскрытая рота показывала «−», но клик ДОБАВЛЯЛ её в
    // ручную раскладку — противоположно намерению: после выключения фильтра
    // ветка, которую пытались свернуть, оставалась раскрытой.
    const user = userEvent.setup()
    useTree(LAGGING_TREE)
    renderPage()

    await screen.findByText('Штаб')
    await user.click(screen.getByLabelText('только отстающие'))
    expect(screen.getByText('Взвод связи')).toBeInTheDocument()

    // Свернуть авто-раскрытую ветку под фильтром нельзя — она обязана
    // показывать отстающего (клик — видимый no-op)…
    await user.click(screen.getByRole('button', { name: 'Свернуть Красная рота' }))
    expect(screen.getByText('Взвод связи')).toBeInTheDocument()

    // …и НЕ имеет права стать «ручным раскрытием»: после выключения фильтра
    // рота свёрнута, как и была до него.
    await user.click(screen.getByLabelText('только отстающие'))
    expect(screen.queryByText('Взвод связи')).not.toBeInTheDocument()
  })

  it('отстающих нет → пустое состояние с ТЕКСТОМ, не пустой экран', async () => {
    const user = userEvent.setup()
    useTree([
      node({ division_id: SHTAB, name: 'Штаб', status: 'GREEN' }),
      node({ division_id: ROTA_1, name: 'Рота', parent_id: SHTAB, status: 'GREEN' }),
    ])
    renderPage()

    await screen.findByText('Штаб')
    await user.click(screen.getByLabelText('только отстающие'))

    expect(screen.getByText('Отстающих подразделений нет')).toBeInTheDocument()
    expect(mountedNodeIds()).toEqual([])
  })
})

describe('AC-8 — загрузка / ошибка / пустота', () => {
  it('первая загрузка → role="status"', async () => {
    useTree([node({ division_id: SHTAB, name: 'Штаб' })])
    renderPage()

    expect(screen.getByRole('status')).toHaveTextContent('Загрузка структуры подразделений…')
    await screen.findByText('Штаб')
  })

  it('пустой ответ → «Структура не загружена»', async () => {
    useTree([])
    renderPage()

    expect(await screen.findByText('Структура не загружена')).toBeInTheDocument()
  })

  it('500 с конвертом → role="alert"', async () => {
    server.use(
      http.get(TREE_PATH, () =>
        HttpResponse.json(
          {
            error_code: 'INTERNAL_ERROR',
            message: 'Внутренняя ошибка сервера.',
            details: {},
            request_id: null,
            timestamp: '2026-07-19T08:00:00+05:00',
          },
          { status: 500 },
        ),
      ),
    )
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось загрузить дерево готовности.',
    )
  })

  it('сетевой обрыв → role="alert" (NetworkError вне иерархии ApiError)', async () => {
    server.use(http.get(TREE_PATH, () => HttpResponse.error()))
    renderPage()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('403 скоупа до 10.3a ведёт себя как общий отказ чтения — своего текста нет', async () => {
    server.use(
      http.get(TREE_PATH, () =>
        HttpResponse.json(
          {
            error_code: 'PERMISSION_DENIED',
            message: 'Недостаточно прав.',
            details: {},
            request_id: null,
            timestamp: '2026-07-19T08:00:00+05:00',
          },
          { status: 403 },
        ),
      ),
    )
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось загрузить дерево готовности.',
    )
    // «Доступ запрещён» — текст RequirePermission, до экрана он не доходит.
    expect(screen.queryByText('Доступ запрещён')).not.toBeInTheDocument()
  })

  it('сбой ОПРОСА при показанном дереве: баннер поверх, дерево НЕ стёрто', async () => {
    let call = 0
    server.use(
      http.get(TREE_PATH, () => {
        call += 1
        if (call === 1) {
          return HttpResponse.json({
            business_date: '2026-07-19',
            nodes: [node({ division_id: SHTAB, name: 'Штаб бригады', status: 'RED' })],
          })
        }
        return HttpResponse.error()
      }),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <TrafficLightTreePage />
      </QueryClientProvider>,
    )

    await screen.findByText('Штаб бригады')
    // Принудительная перечитка вместо ожидания интервала: тест про поведение
    // при сбое опроса, а не про его расписание (расписание — polling-сюита).
    await queryClient.refetchQueries({ queryKey: ['traffic-light-tree'] })

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    // Дерево ЖИВО под баннером: data и isError сосуществуют, это не «или-или».
    expect(screen.getByText('Штаб бригады')).toBeInTheDocument()
  })
})

describe('AC-9 — защитный разбор мусора: экран не падает', () => {
  it.each([
    ['не-объект', '"мусор"'],
    ['nodes не массив', JSON.stringify({ nodes: 'x' })],
    ['голый массив', JSON.stringify([{ division_id: SHTAB }])],
  ])('%s → пустое состояние вместо падения', async (_label, body) => {
    server.use(
      http.get(TREE_PATH, () =>
        HttpResponse.text(body, { headers: { 'Content-Type': 'application/json' } }),
      ),
    )
    renderPage()

    expect(await screen.findByText('Структура не загружена')).toBeInTheDocument()
  })

  it('неизвестный status → UNKNOWN, сирота → корень, цикл не вешает вкладку', async () => {
    useTree([
      node({ division_id: SHTAB, name: 'Штаб', status: 'ЗЕЛЁНЫЙ' as never }),
      node({ division_id: ROTA_1, name: 'Сирота', parent_id: 'нет-такого-id', status: 'RED' }),
      node({ division_id: ROTA_2, name: 'Цикл А', parent_id: VZVOD, status: 'RED' }),
      node({ division_id: VZVOD, name: 'Цикл Б', parent_id: ROTA_2, status: 'RED' }),
    ])
    renderPage()

    await screen.findByText('Штаб')
    expect(within(rowOf(SHTAB)).getByText(STATUS_LABEL.UNKNOWN)).toBeInTheDocument()
    // Сирота не потерялась — рендерится корнем.
    expect(screen.getByText('Сирота')).toBeInTheDocument()
    // Цикл разорван: ОБА узла присутствуют ровно по разу (не размножены
    // рекурсией и не съедены), экран жив.
    expect(screen.getAllByText(/^Цикл [АБ]$/)).toHaveLength(2)
  })
})

describe('AC-10 — клавиатура', () => {
  it('дерево проходимо Tab, раскрытие по Enter и по Space', async () => {
    const user = userEvent.setup()
    useTree([
      node({ division_id: SHTAB, name: 'Штаб' }),
      node({ division_id: ROTA_1, name: 'Первая рота', parent_id: SHTAB }),
      node({ division_id: VZVOD, name: 'Взвод связи', parent_id: ROTA_1 }),
    ])
    renderPage()

    await screen.findByText('Первая рота')

    // Мышь не используется вовсе: доходим до раскрывашки роты табами.
    const rotaToggle = screen.getByRole('button', { name: 'Раскрыть Первая рота' })
    await user.tab() // фильтр-чекбокс
    await user.tab() // раскрывашка штаба
    await user.tab() // раскрывашка роты
    expect(document.activeElement).toBe(rotaToggle)

    await user.keyboard('{Enter}')
    expect(screen.getByText('Взвод связи')).toBeInTheDocument()

    await user.keyboard(' ')
    expect(screen.queryByText('Взвод связи')).not.toBeInTheDocument()
  })

  it('aria-expanded отражает состояние ветки', async () => {
    const user = userEvent.setup()
    useTree([
      node({ division_id: SHTAB, name: 'Штаб' }),
      node({ division_id: ROTA_1, name: 'Первая рота', parent_id: SHTAB }),
    ])
    renderPage()

    await screen.findByText('Первая рота')
    const toggle = screen.getByRole('button', { name: 'Свернуть Штаб' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    await user.click(toggle)
    expect(screen.getByRole('button', { name: 'Раскрыть Штаб' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })
})
