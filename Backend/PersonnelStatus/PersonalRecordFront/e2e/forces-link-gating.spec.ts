/**
 * Глубокие ссылки «Сбор сил на ОМ» следуют ключу модуля (Plane №939; ревью №825
 * 08.09.2026).
 *
 * №939 закрыл пункт меню «Сбор сил на ОМ» руководителям (`acc_dir_head_d2`
 * и др.), но ссылки на него с этапов ОМ и из «Статусов» остались видны и вели
 * на «Доступ закрыт» — тот самый дефект, что №350 чинил для меню. Теперь
 * каждая такая ссылка стоит под `forcesOpen` — результатом
 * `moduleOpenFor("/employees", …)`, того же ключа, что у пункта меню.
 *
 * ПОЧЕМУ СТАТИЧЕСКАЯ ПРОБА, А НЕ ЖИВАЯ. Все три ссылки живут в ветках,
 * зависящих от данных: подвал рекогносцировки — только у старшего объекта,
 * пустое состояние расстановки — у ОМ без состава, подпись в «Статусах» — у
 * строки с кадровым кодом участия без мероприятия в разделе. Живая проба
 * стерегла бы одну ветку из трёх и требовала бы фикстуры на каждую персону;
 * сторож по исходникам стережёт все три и краснеет на любой новой ссылке в
 * модуль без гейта. Снимки экрана правки — `.shot-tmp-939/`.
 *
 * `SMOKE_LIVE` не нужен (см. route-map-coverage.spec.ts: скип читается как
 * зелень).
 *
 * КРАСНАЯ НА МУТАЦИИ: убери `forcesOpen &&` у любой из ссылок — проба назовёт
 * файл и строку.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { expect, test } from '@playwright/test'

const ROOT = path.resolve(__dirname, '..')

/** Файлы, где живут ссылки в модуль «Сбор сил». Новый файл со ссылкой без
 * гейта первая проба найдёт сама — по всему дереву исходников. */
const SOURCE_DIRS = ['app', 'components', 'features', 'widgets', 'entities']

function* tsxFiles(dir: string): Generator<string> {
  const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs')
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) yield* tsxFiles(full)
    else if (/\.tsx$/.test(name)) yield full
  }
}

test.describe('ссылки в «Сбор сил» по ключу модуля', () => {
  test('каждая ссылка на /employees вне меню стоит под forcesOpen', () => {
    const unguarded: string[] = []
    let guarded = 0
    for (const dir of SOURCE_DIRS) {
      for (const file of tsxFiles(path.join(ROOT, dir))) {
        const lines = readFileSync(file, 'utf8').split('\n')
        lines.forEach((line, index) => {
          if (!/href=["'`]\/employees/.test(line)) return
          // Пункт меню и пропуск страницы решают доступ сами (`portal-access`).
          if (/components\/navigation|dashboard-layout|app\/employees\//.test(file)) return
          // Гейт — в этой же или в предыдущих двенадцати строках (JSX-ветка с комментарием над `href`).
          const window = lines.slice(Math.max(0, index - 12), index + 1).join('\n')
          if (/forcesOpen/.test(window)) guarded += 1
          else unguarded.push(`${path.relative(ROOT, file)}:${index + 1}`)
        })
      }
    }
    expect(guarded, 'ни одной ссылки под гейтом не найдено — проба вакуумна').toBeGreaterThanOrEqual(4)
    expect(unguarded, 'ссылки в «Сбор сил» без гейта forcesOpen (№939)').toEqual([])
  })
})
