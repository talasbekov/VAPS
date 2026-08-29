/**
 * Карта маршрутов портала: список, по которому ходит обход, и список,
 * объявленный файловой системой. ОБЩИЙ МОДУЛЬ, а не часть спеки обхода
 * (Plane №319).
 *
 * Почему вынесено. Сверку этих двух списков («карта маршрутов покрыта
 * обходом») держала внутри себя спека обхода, а обход гоняется БЛОКАМИ по
 * персонам (`-g "persona ..."`) — и сверка, стоящая вне персон, не попадала ни
 * в один блок. За полный прогон 29.08.2026 её не запустили ни разу, и она всё
 * это время была красной: два объявленных маршрута обход не покрывал вовсе.
 * «Обход зелёный» означало меньше, чем читалось.
 *
 * Списки нужны обеим сторонам — и обходу, и переехавшей сверке, — поэтому
 * живут здесь, а не копией в каждой. Копия разошлась бы молча, и сверка
 * подтверждала бы саму себя.
 */
import fs from 'node:fs'
import path from 'node:path'

const APP_DIR = path.join(__dirname, '..', 'app')

// Параметрические сегменты подставляет РЕЗОЛВЕР из живого API (`{key}`), а не
// константа: id стенда живут в БД и меняются с пересидом.
export interface RouteSpec {
  template: string
  needs?: readonly string[]
  /** Маршрут вне DashboardLayout (вход) — скоуп обхода = вся страница. */
  chromeless?: boolean
}

export const ROUTES: readonly RouteSpec[] = [
  { template: '/', chromeless: true },
  { template: '/dashboard' },
  // Оба вида модуля, а не один: с Plane №273 по умолчанию открывается
  // «Ежедневный расход организации», и обход, ходивший только по адресу без
  // параметра, перестал бы заглядывать в «Сбор сил на ОМ» вовсе.
  { template: '/employees' },
  { template: '/employees?view=forces' },
  { template: '/organization' },
  { template: '/statuses' },
  { template: '/reports' },
  { template: '/settings' },
  // Экраны раздела доступа (Plane №36, шаги «П-6»…«П-8»). В обходе их не было
  // с самого заведения: сторож карты маршрутов краснел, пока полный смоук не
  // гоняли. Раздел закрыт правом `admin.roles` — персона без него видит
  // «Доступ закрыт», и это тоже осмысленный ответ страницы, а не 404.
  { template: '/settings/permissions' },
  { template: '/settings/roles' },
  { template: '/settings/users' },
  { template: '/feedback' },
  { template: '/feedback/{feedbackId}', needs: ['feedbackId'] },
  // «Мой профиль» открывается любому вошедшему: кадровой записи у персоны
  // может не быть, и тогда экран показывает причину — это не отказ.
  { template: '/security-ops/profile' },
  { template: '/security-ops/command-center' },
  // Маршруты «Сбор сил на ОМ», «Календарь смен», «Боевые группы» и «Расход
  // дня (ОМ)» удалены 21.08.2026 вместе с экранами — обходить нечего.
  { template: '/security-ops/events' },
  { template: '/security-ops/events/{eventId}', needs: ['eventId'] },
  // Маршрутов «Реестр ГВО» здесь БОЛЬШЕ НЕТ (Plane «Реестр ОМ-35.8»): модуль
  // снят, сводка открывается панелью в карточке ОМ, сводный взгляд — вкладкой
  // `?view=gvo` реестра, и обход проходит их вместе со своими экранами.

  { template: '/security-ops/persons' },
  { template: '/security-ops/laws' },
  { template: '/security-ops/objects' },
  { template: '/security-ops/objects/{objectId}', needs: ['objectId'] },
  {
    template: '/security-ops/objects/{objectId}/passports/{passportVersionId}',
    needs: ['objectId', 'passportVersionId'],
  },
  // «План дежурств» и карточка смены удалены 13.08.2026 — обходить нечего;
  { template: '/security-ops/analytics' },
  { template: '/security-ops/analytics/operations' },
  { template: '/security-ops/ratings' },
  { template: '/security-ops/ratings/workspace' },
  { template: '/security-ops/ratings/evaluations' },
  {
    template: '/security-ops/ratings/employees/{ratingEmployeeId}',
    needs: ['ratingEmployeeId'],
  },
  { template: '/security-ops/ratings/audit' },
  { template: '/security-ops/ratings/export' },
  { template: '/security-ops/ratings/analytics' },
  { template: '/security-ops/service-reports' },
  { template: '/security-ops/service-reports/history' },
  { template: '/security-ops/service-reports/{reportJobId}', needs: ['reportJobId'] },
  { template: '/security-ops/audit' },
  { template: '/security-ops/dictionaries' },
  { template: '/security-ops/dictionaries/{dictionaryCode}', needs: ['dictionaryCode'] },
  // Справочники ШТАТА (должности и звания) — свой раздел со своим макетом, а
  // не вид `dictionaries/{code}` выше. Добавлены по Plane №319: проба «карта
  // маршрутов покрыта обходом» их не находила, но сама в блоки `-g "persona"`
  // не входит, поэтому за весь прогон её никто не запускал и молчание читалось
  // как покрытие.
  {
    template: '/security-ops/dictionaries/personnel/{staffDictionaryKind}',
    needs: ['staffDictionaryKind'],
  },
  { template: '/security-ops/vehicles' },
  { template: '/security-ops/settings' },
  { template: '/security-ops/changelog' },
  { template: '/security-ops/feedback' },
  { template: '/security-ops/feedback/{feedbackId}', needs: ['feedbackId'] },
  // Бывшие адреса встроенной SPA: страница-редирект. Обходим один вход —
  // он и проверяет, что редирект жив, а не отдаёт 404.
  { template: '/ops/objects' },
]

/**
 * Дрейф карты маршрутов ловится ЗДЕСЬ, а не тишиной: новая `app/**\/page.tsx`,
 * не внесённая в список выше, красит отдельный тест. Без этой сверки обход
 * молча переставал бы покрывать свежие разделы — ровно тот отказ, который смоук
 * обязан ловить. Источник — файловая система, потому что роутинг у Next
 * файловый: списка маршрутов в коде не существует, и «забыл дописать» здесь
 * физически невозможно.
 */
export function declaredPortalRoutes(): string[] {
  const out: string[] = []
  const walk = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // route groups `(...)` в путь не входят; api-роуты — не страницы
        if (entry.name === 'api') continue
        const seg = entry.name.startsWith('(') ? '' : `/${entry.name}`
        walk(path.join(dir, entry.name), prefix + seg)
      } else if (entry.name === 'page.tsx') {
        out.push(prefix === '' ? '/' : prefix)
      }
    }
  }
  walk(APP_DIR, '')
  return out.map((r) =>
    // [id] и [[...slug]] → единый плейсхолдер, как в шаблонах ROUTES
    r.replace(/\/\[\[?\.{0,3}([^\]]+)\]?\]/g, '/:x'),
  )
}

