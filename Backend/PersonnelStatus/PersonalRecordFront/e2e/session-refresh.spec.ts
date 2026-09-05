/**
 * Продление access-токена при живой сессии (Plane №383).
 *
 * ДЕФЕКТ, КОТОРЫЙ ЭТА ПРОБА СТЕРЕЖЁТ. Сессия NextAuth действовала тридцать
 * дней, access-токен Django — восемь часов, а продлевать его не умел никто:
 * колбэк `jwt` кладёт токены только в момент входа. Через восемь часов портал
 * открывался как рабочий — меню на месте, на форму входа не выкидывает, — но
 * ВСЕ запросы к бэку отвечали 401, и в теле каждого экрана стояло «не удалось
 * загрузить». Симптом неотличим от «стенд не поднялся», и разбор уходил в
 * стенд, который здоров. Заказчик сказал «не работает проект» 03.09.2026.
 *
 * ПОЧЕМУ ПРОБА ПОДДЕЛЫВАЕТ COOKIE, А НЕ ЖДЁТ ВОСЕМЬ ЧАСОВ. Дождаться
 * истечения нельзя, а укорачивать `ACCESS_TOKEN_LIFETIME` на бэкенде значило
 * бы проверять не тот стенд, на котором работают люди. Поэтому проба
 * собирает cookie сессии сама — тем же `encode` и тем же секретом, которыми
 * её собирает приложение, — и помечает срок истёкшим. Всё остальное
 * (продление, отказ, поведение экрана) настоящее.
 *
 * ТРИ СЛУЧАЯ, и они разные по смыслу:
 *   1. срок вышел, refresh живой  → приходит НОВЫЙ токен, сессия без ошибки;
 *   2. срок вышел, refresh мёртв  → сессия несёт `error` и токена НЕ отдаёт;
 *   3. человек оказался на форме входа после (2) → форма говорит, почему.
 */
import { expect, test } from '@playwright/test'
import { encode } from 'next-auth/jwt'
import fs from 'node:fs'
import path from 'node:path'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { isTokenRejected, makeOnce } from '../lib/refresh-policy'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

/** Секрет подписи сессии. Тот же, которым подписывает приложение: иначе оно
 *  не примет собранную cookie и проба проверяла бы отказ разбора, а не
 *  продление. Из окружения или из `.env.local` стенда — в репозиторий
 *  секрет не попадает. */
function sessionSecret(): string | null {
  if (process.env.NEXTAUTH_SECRET !== undefined) return process.env.NEXTAUTH_SECRET
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8')
    const line = raw.split('\n').find((l) => l.startsWith('NEXTAUTH_SECRET='))
    return line === undefined ? null : line.slice('NEXTAUTH_SECRET='.length).trim()
  } catch {
    return null
  }
}

/** Пара токенов прямо с бэкенда — вход через NextAuth здесь не нужен: пробе
 *  нужен ЖИВОЙ refresh, а не браузерная сессия. */
async function tokenPair(): Promise<{ access: string; refresh: string }> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  expect(res.ok, 'бэкенд не выдал пару токенов').toBeTruthy()
  return (await res.json()) as { access: string; refresh: string }
}

/** Cookie сессии с ИСТЁКШИМ сроком access-токена. */
async function expiredSessionCookie(
  secret: string,
  access: string,
  refresh: string,
): Promise<string> {
  return await encode({
    secret,
    token: {
      id: '1',
      name: STAND_USERNAME,
      accessToken: access,
      refreshToken: refresh,
      accessTokenExpires: Date.now() - 1000,
    },
  })
}

async function sessionWith(cookie: string): Promise<{
  error?: string
  user?: { accessToken?: string }
}> {
  const res = await fetch(`${APP}/api/auth/session/`, {
    headers: { cookie: `next-auth.session-token=${cookie}` },
  })
  return (await res.json()) as { error?: string; user?: { accessToken?: string } }
}

test.describe(LIVE ? 'продление сессии' : 'продление сессии (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('истёкший токен при живом refresh продлевается молча', async () => {
    const secret = sessionSecret()
    expect(secret, 'NEXTAUTH_SECRET не найден — подписать cookie нечем').not.toBeNull()
    const pair = await tokenPair()
    const session = await sessionWith(await expiredSessionCookie(secret!, pair.access, pair.refresh))

    expect(session.error, 'сессия с живым refresh не должна нести ошибку').toBeUndefined()
    const got = session.user?.accessToken
    expect(got, 'сессия не отдала токена вовсе').toBeDefined()
    // Именно ЗАМЕНА, а не «токен на месте»: до правки здесь лежал бы тот же
    // протухший токен, и проба, проверяющая только наличие, зеленела бы.
    expect(got, 'токен не заменён — продления не было').not.toBe(pair.access)
  })

  test('мёртвый refresh отдаёт ошибку вместо токена', async () => {
    const secret = sessionSecret()
    expect(secret).not.toBeNull()
    const pair = await tokenPair()
    const session = await sessionWith(
      await expiredSessionCookie(secret!, pair.access, 'не-токен'),
    )

    expect(session.error).toBe('RefreshAccessTokenError')
    // 🔴 ТОКЕН НЕ ОТДАЁТСЯ СОВСЕМ. Оставить мёртвый на месте — значит вернуть
    // ровно тот симптом, из-за которого задача появилась: клиент шлёт его
    // дальше и получает 401 на каждом экране.
    expect(session.user?.accessToken, 'отдан мёртвый токен').toBeUndefined()
  })


  test('временный отказ продления НЕ считается мёртвым токеном', async () => {
    // 🔴 ЧТО ЭТО СТЕРЕЖЁТ (Plane №459). Раньше ВСЕ отказы продления сводились
    // к одному `RefreshAccessTokenError`: 502 при перезапуске Django, 504,
    // `ECONNREFUSED`, заминка DNS были неотличимы от «refresh-токен не
    // годен». Дальше клиент немедленно жёг сессию и стирал cookie, в которой
    // лежал ЖИВОЙ refresh-токен: один перезапуск бэкенда в рабочее время
    // выкидывал из системы каждого, чей access-токен попал в минутное окно
    // продления, и человек терял несохранённый экран, не понимая за что.
    //
    // ПОЧЕМУ ПРАВИЛО ПРОВЕРЯЕТСЯ ПРЯМО, А НЕ ЧЕРЕЗ ЭКРАН. Продление идёт на
    // стороне Next, внутри серверного колбэка NextAuth: ни `page.route`, ни
    // запрос из браузера туда не попадают. Подделать 5xx можно было бы,
    // только подняв фальшивый бэкенд рядом со стендом, — дорого и хрупко.
    // Поэтому решение вынесено в `lib/refresh-policy` и зовётся оттуда же,
    // откуда его зовёт `auth-config`: второй копии правила нет.
    for (const dead of [400, 401, 403]) {
      expect(isTokenRejected(dead), `${dead} — сервер сказал «токен не годен»`).toBe(true)
    }
    for (const temporary of [500, 502, 503, 504, 408, 429]) {
      expect(
        isTokenRejected(temporary),
        `${temporary} — беда сервера, а не мёртвый токен: сессию жечь нельзя`,
      ).toBe(false)
    }
  })

  test('параллельные продления делают ОДИН запрос, а не по одному на каждое', async () => {
    // 🔴 ЧТО ЭТО СТЕРЕЖЁТ (Plane №465, №474). Страницу портала открывают
    // десятки компонентов сразу, и каждый дёргает `/api/auth/session`. Когда
    // access-токен протух, КАЖДЫЙ такой вызов заводил своё продление: за один
    // заход насчитывалось под полторы сотни параллельных
    // `POST /api/token/refresh/`. Побеждала не первая удача, а ПОСЛЕДНИЙ
    // ответ: одного неудачника (502 при перезапуске Django, таймаут) хватало,
    // чтобы затереть cookie, уже обновлённую успешным соседом, и выкинуть
    // человека из совершенно здоровой системы. Плюс мина на будущее: включат
    // `ROTATE_REFRESH_TOKENS` — и при `BLACKLIST_AFTER_ROTATION: True` первый
    // же ответ убьёт токен, которым в ту же секунду пользуются остальные сто.
    //
    // Проверяется счётчиком запусков: правило про «одну работу на ключ»
    // вынесено в `lib/refresh-policy` по той же причине, что и соседнее, —
    // колбэк NextAuth из пробы не позвать.
    const once = makeOnce<number>()
    let runs = 0
    const slow = () =>
      new Promise<number>((resolve) => {
        runs += 1
        setTimeout(() => resolve(runs), 30)
      })

    const answers = await Promise.all(Array.from({ length: 20 }, () => once('токен-A', slow)))
    expect(runs, 'каждый вызов завёл своё продление вместо ожидания первого').toBe(1)
    expect(new Set(answers).size, 'ответы разошлись — ждали не один и тот же').toBe(1)

    // Ключ отпускается ПОСЛЕ работы: иначе продление сделалось бы разовым и
    // все следующие получали бы протухший ответ навсегда — хуже гонки.
    await once('токен-A', slow)
    expect(runs, 'ключ не отпущен: второе продление не состоялось').toBe(2)

    // Отказ отпускает ключ так же, как удача.
    const boom = () => {
      runs += 1
      return Promise.reject(new Error('бэкенд лёг'))
    }
    await expect(once('токен-A', boom)).rejects.toThrow('бэкенд лёг')
    await once('токен-A', slow)
    expect(runs, 'после отказа ключ остался занят').toBe(4)

    // Разные токены — разные работы: общий ключ склеил бы сессии двух людей.
    runs = 0
    await Promise.all([once('токен-A', slow), once('токен-Б', slow)])
    expect(runs, 'два разных токена продлились одним запросом').toBe(2)
  })

  test('десяток одновременных сессий получает ОДИН новый токен', async () => {
    // Живая половина №465: то же самое, но через настоящий стенд. Без
    // склейки каждый из запросов приносит СВОЙ свежий токен — их набирается
    // столько же, сколько запросов; со склейкой ответ у всех один.
    const secret = sessionSecret()
    expect(secret, 'NEXTAUTH_SECRET не найден — подписать cookie нечем').not.toBeNull()
    const pair = await tokenPair()
    const cookie = await expiredSessionCookie(secret!, pair.access, pair.refresh)

    // Прогрев: `next dev` компилирует маршрут на первом обращении, и пока он
    // этим занят, соседний запрос успевает проскочить мимо ещё не созданной
    // склейки. Замерено — на холодном стенде выходило два продления вместо
    // одного; это свойство dev-сервера, а не дефект правила.
    await fetch(`${APP}/api/auth/session/`)

    const sessions = await Promise.all(Array.from({ length: 10 }, () => sessionWith(cookie)))
    for (const session of sessions) {
      expect(session.error, 'параллельное продление уронило сессию').toBeUndefined()
    }
    const tokens = new Set(sessions.map((session) => session.user?.accessToken))
    expect(tokens.has(pair.access), 'кому-то достался протухший токен').toBe(false)
    expect(tokens.size, `продлений было ${tokens.size}, а надо одно`).toBe(1)
  })

  test('форма входа называет причину, по которой человек на ней оказался', async ({ page }) => {
    await page.goto(`${APP}/?reason=expired`)
    await expect(page.getByText('Сессия истекла — войдите заново.')).toBeVisible({
      timeout: 15_000,
    })

    // На обычном входе этой строки нет: сообщение о протухшей сессии на
    // первом заходе читалось бы как поломка.
    await page.goto(`${APP}/`)
    await expect(page.getByRole('button', { name: /Войти/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Сессия истекла — войдите заново.')).toBeHidden()
  })
})
