/**
 * «Сбор сил на ОМ» (`/employees`) закрыт держателю ОДНОГО права на личный
 * состав (Plane №939, решение заказчика 07.09.2026).
 *
 * ЕГО СЛОВА: «acc_dir_head, acc_dir_head_d2, acc_dept_head, acc_dept_head_d2
 * не должны иметь доступ к модулю Сбор сил на ОМ». Раньше (№375, 02.09.2026)
 * здесь стояло обратное: экран открыт читателю по `personnel.view`, чтобы
 * оператор подразделения видел своих людей. Заказчик тогда же ответил, что
 * список людей для него — «модуль Статусы сотрудников», а 07.09 снял пункт у
 * руководителей. Пропуск на `/employees` снова спрашивает только права сбора
 * сил (`forces.*`); `personnel.view` остаётся правом поиска и карточки.
 *
 * ЧТО СТЕРЕЖЁТ ПРОБА — обе половины решения:
 *   1. экран ЗАКРЫТ читателю без прав сбора сил, и пункта в меню у него нет
 *      (иначе гейт снова расширили);
 *   2. своих людей он ПО-ПРЕЖНЕМУ видит — в «Статусах сотрудников» (иначе
 *      закрыли больше, чем просили: заказчик просил снять модуль, а не
 *      список).
 *
 * Учётка `erda` — «Оператор подразделения»: право `personnel.view` есть,
 * прав сбора сил нет. Под администратором проба была бы вакуумной.
 *
 * Без SMOKE_LIVE=1 скипается: нужен стек Django :8100 + Next :3106.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

async function signInAsOperator(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  const res = await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: {
      csrfToken: csrf.csrfToken,
      username: 'erda',
      password: 'erda123',
      json: 'true',
    },
  })
  expect(res.status(), 'учётка оператора подразделения не пустила').toBe(200)
}

async function signInAsAdmin(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  const res = await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: {
      csrfToken: csrf.csrfToken,
      username: STAND_USERNAME,
      password: STAND_PASSWORD,
      json: 'true',
    },
  })
  expect(res.status(), 'учётка стенда не пустила').toBe(200)
}

test.describe(LIVE ? 'сбор сил: пропуск только по правам сбора сил' : 'сбор сил: пропуск только по правам сбора сил (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('оператор без прав сбора сил экрана не видит, а своих людей читает в статусах', async ({
    page,
  }) => {
    await signInAsOperator(page)

    // Половина 1: пункта в меню нет, прямой адрес отвечает отказом раздела.
    await page.goto(`${APP}/statuses`)
    const menu = page.locator('aside')
    await expect(menu.getByRole('link', { name: 'Статусы сотрудников', exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await expect(
      menu.getByRole('link', { name: 'Сбор сил на ОМ', exact: true }),
      'пункт «Сбор сил на ОМ» показан тому, у кого нет прав сбора сил',
    ).toHaveCount(0)

    await page.goto(`${APP}/employees?view=forces`)
    await expect(
      page.getByText('Недостаточно прав для просмотра сбора сил на ОМ'),
      'экран открыт читателю — гейт снова пускает по personnel.view',
    ).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('tab', { name: 'Список сотрудников' })).toHaveCount(0)

    // Половина 2: люди своего подразделения видны в «Статусах сотрудников».
    await page.goto(`${APP}/statuses`)
    await expect(page.getByRole('heading', { name: 'Управление статусами' })).toBeVisible({
      timeout: 30_000,
    })
    await expect
      .poll(async () => page.locator('table tbody tr').count(), { timeout: 30_000 })
      .toBeGreaterThan(0)
  })

  test('фильтр по статусу отбирает людей, а не обнуляет список (Plane №837)', async ({
    page,
  }) => {
    // 🔴 ЧТО ЭТО СТЕРЕЖЁТ. Пункт фильтра отдавал `value={item.label}` —
    // русскую подпись, — а ручка отбирает по КОДУ типа статуса
    // (`staff_unit/views.py`, `status_code`). Замерено на стенде 06.09.2026:
    // `?status=in_service` — 435 строк, `?status=В строю` — НОЛЬ. То есть
    // любой выбор, кроме «Все статусы», давал пустой список, и человек читал
    // это как «таких сотрудников нет». Экран при этом честно печатал «Ничего
    // не найдено»: врал не он, а значение, которое он посылал.
    //
    // Проба идёт ЧЕРЕЗ ЭКРАН, а не запросом: предмет — то, что кладёт в адрес
    // сам фильтр. Запрос с готовым кодом проверял бы сервер, который и так
    // работал.
    //
    // КРАСНАЯ ПРОБА: верни `value={item.label}` в `app/employees/page.tsx` —
    // список опустеет, и проба назовёт это словами.
    // Под администратором: проба про фильтр, а не про права, а оператору
    // подразделения экран с №939 закрыт.
    await signInAsAdmin(page)
    await page.goto(`${APP}/employees?view=forces&tab=table`)

    const filter = page.locator('[aria-label="Фильтр по статусу"]').first()
    await expect(filter, 'фильтра по статусу нет на экране').toBeVisible({
      timeout: 30_000,
    })
    await expect
      .poll(async () => page.locator('table tbody tr').count(), { timeout: 30_000 })
      .toBeGreaterThan(0)

    await filter.click()
    const options = page.getByRole('option')
    await expect(options.first()).toBeVisible({ timeout: 20_000 })
    // Пункты приходят из СЕРВЕРНОГО каталога (Plane №354): в зашитом перечне
    // не было ни «Уточняется», ни «Участие в ОМ» — их появление и означает,
    // что источник сменился. Если каталог не доехал, фильтр остаётся рабочим
    // на запасном перечне, поэтому проверка мягкая: хотя бы один такой пункт.
    const names = await options.allInnerTexts()
    expect(
      names.some((name) => /Уточняется|Участие в ОМ/.test(name)),
      `в фильтре нет статусов серверного каталога: ${names.join(' | ')}`,
    ).toBe(true)

    await page.getByRole('option', { name: 'В строю', exact: true }).click()

    // Отбор ПРИМЕНИЛСЯ: в адресе код, а не подпись.
    await expect
      .poll(async () => new URL(page.url()).searchParams.get('status'), {
        timeout: 20_000,
      })
      .toBe('in_service')
    // И список НЕ ОПУСТЕЛ — это и есть то, чего не было до правки.
    await expect(page.getByText('Ничего не найдено')).toHaveCount(0)
    await expect
      .poll(async () => page.locator('table tbody tr').count(), { timeout: 30_000 })
      .toBeGreaterThan(0)
  })
})
