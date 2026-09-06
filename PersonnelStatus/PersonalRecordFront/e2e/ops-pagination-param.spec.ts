/**
 * Списки раздела ОМ спрашиваются `limit`, а не `page_size` (Plane №870, №321).
 *
 * 🔴 ЧТО СТЕРЕЖЁМ. Раздел ОМ пагинируется `LimitOffsetPagination`
 * (`DefaultPagination`, `default_limit=50`) — она понимает `limit`/`offset`, а
 * `page_size` ИГНОРИРУЕТ и молча отдаёт умолчание. Замерено 06.09.2026 на
 * живой ручке `/api/operations/status-types/`:
 *
 *     ?page_size=5 → 19 строк (все, параметр не применён)
 *     ?limit=5     → 5 строк
 *
 * Молчание и есть дефект: попросивший всё получает часть и не может отличить
 * «больше нет» от «больше не дали».
 *
 * 🔴 ПОЧЕМУ ПРОБА, А НЕ КОММЕНТАРИЙ. Комментарий об этой ловушке уже стоял в
 * `lib/api.ts` (разбор №321) — и вызов двумястами строк НИЖЕ, в том же файле,
 * всё равно был написан с `page_size`. Слова не удержали; `page_size` —
 * правильное имя почти на всех остальных ручках проекта, и следующий, кто
 * напишет вызов по образцу соседней строки, наступит туда же.
 *
 * Приём тот же, что у `right-hint-pattern`, `own-fixture-pattern` и
 * `route-map-coverage`: проба читает ИСХОДНИКИ и без `SMOKE_LIVE` даёт
 * «passed», а не «skipped», — иначе сторож молча пропускался бы.
 */
import { expect, test } from '@playwright/test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')

/** Каталоги БОЕВОГО кода. Здесь исключений нет и быть не должно. */
const PRODUCTION_DIRS = [
  'app',
  'components',
  'entities',
  'features',
  'hooks',
  'lib',
  'shared',
  'widgets',
  'mocks',
]

/**
 * 🔴 ХРАПОВИК ТОЛЬКО ДЛЯ ПРОБ, а не разрешение. На 06.09.2026 пробы несут 64
 * таких вызова в 32 файлах — они тоже получают 50 строк вместо запрошенных, и
 * это уже стоило разбора: комментарий в `bulletin-stage` объясняет пропажу
 * своей фикстуры словами «реестр стенда перевалил за page_size», хотя параметр
 * не применяется вовсе и потолок берётся из умолчания.
 *
 * Сметать 32 файла заодно с боевой правкой нельзя: половину держат соседние
 * сессии. Долг вынесен карточкой Plane №872; список сюда НЕ дописывается — он
 * только сокращается, и `сторож не гниёт` краснеет на файле, который больше
 * не нарушает.
 */
const KNOWN_PROBE_CALLS = new Map<string, number>([
  ['ack-opened-and-phone.spec.ts', 1],
  ['acknowledgement-stage.spec.ts', 3],
  ['approval-print.spec.ts', 2],
  ['approval-return.spec.ts', 1],
  ['approval-rights.spec.ts', 2],
  ['approval-route.spec.ts', 1],
  ['approval-stage.spec.ts', 1],
  ['command-center.spec.ts', 1],
  ['conduct-evaluations.spec.ts', 3],
  ['daily-expense.spec.ts', 1],
  ['department-requests.spec.ts', 1],
  ['events-registry.spec.ts', 5],
  ['force-collections.spec.ts', 2],
  ['forces-gathering.spec.ts', 4],
  ['gvo-sections.spec.ts', 1],
  ['in-development-badge.spec.ts', 1],
  ['mock-contract.spec.ts', 13],
  ['my-profile.spec.ts', 2],
  ['placement-pool.spec.ts', 2],
  ['placement-stage.spec.ts', 1],
  ['probe-events.ts', 1],
  ['protected-persons.spec.ts', 3],
  ['recon-stage.spec.ts', 2],
  ['stage-override.spec.ts', 1],
  ['stand-chief.ts', 1],
  ['stand-roster.ts', 1],
  ['status-catalog-source.spec.ts', 1],
  ['status-event-link.spec.ts', 1],
  ['ui-access-rule.spec.ts', 1],
  ['vehicles-registry.spec.ts', 1],
  ['visit-approve-blocker.spec.ts', 1],
  ['visit-page.spec.ts', 2],
])

/** Адрес раздела ОМ, спрошенный с `page_size`, — в одной строке с ним. */
const OPS_WITH_PAGE_SIZE = /\/api\/(?:operations|ops)\/[^"'`\n]*page_size/g

function countIn(text: string): number {
  return (text.match(OPS_WITH_PAGE_SIZE) ?? []).length
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

test.describe('пагинация раздела ОМ', () => {
  test('боевой код не спрашивает списки раздела через page_size', () => {
    const offenders: string[] = []
    for (const dir of PRODUCTION_DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        const found = countIn(readFileSync(file, 'utf8'))
        if (found > 0) offenders.push(`${file.slice(ROOT.length + 1)}: ${found}`)
      }
    }
    expect(
      offenders,
      'раздел ОМ игнорирует `page_size` и молча отдаёт 50 строк — спрашивайте ' +
        '`limit` (Plane №870, замер: ?page_size=5 → 19 строк, ?limit=5 → 5)',
    ).toEqual([])
  })

  test('сторож не гниёт: починенная проба снимается из списка', () => {
    const stale: string[] = []
    const grown: string[] = []
    for (const [name, known] of KNOWN_PROBE_CALLS) {
      const found = countIn(readFileSync(join(__dirname, name), 'utf8'))
      if (found === 0) stale.push(name)
      if (found > known) grown.push(`${name}: было ${known}, стало ${found}`)
    }
    expect(stale, 'проба больше не нарушает — снимите её из KNOWN_PROBE_CALLS').toEqual([])
    expect(grown, 'в известной пробе вызовов СТАЛО БОЛЬШЕ — это новая беда').toEqual([])
  })
})
