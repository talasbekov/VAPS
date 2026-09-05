/**
 * Причина, по которой действие закрыто правом, ДОСТИЖИМА (Plane №801).
 *
 * 🔴 ПОЧЕМУ ПРОБА НЕ ЖИВАЯ. Она читает ИСХОДНИК двух экранов и отвечает на
 * один вопрос: не вернулась ли связка «`disabled` по праву + `title` с
 * причиной». Живой прогон на это не годится — подсказки на выключенной кнопке
 * не видно НИ ПРИ КАКОМ поведении браузера, ровно поэтому дефект и жил
 * незамеченным: проверить его можно только по коду. Тот же приём, что у
 * `route-map-coverage` и `ru-plural-single-rule`; без `SMOKE_LIVE` даёт
 * «passed», а не «skipped».
 *
 * ЧТО СТЕРЕГЁТ. Браузер подавляет на выключенном элементе указательные
 * события, а с ними и всплывающую подсказку: `title` показывался бы ровно
 * тогда, когда показаться не может. Человек без права видел серую кнопку и
 * ничего больше. Разбор сделан точечно в №714 и №777, шаблон найден грепом в
 * №801 — двенадцать мест в двух файлах.
 */
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')

/** Экраны, где связка «право → выключенная кнопка» встречается пачкой. */
const SCREENS = [
  'features/forces-split/ui/ForcesSplitPanel.tsx',
  'features/security-event-stages/ui/PlacementStage.tsx',
  'features/security-event-stages/ui/ConductStage.tsx',
  'features/create-security-event/ui/CreateSecurityEventDialog.tsx',
]

test.describe('причина отказа по праву', () => {
  test('`title` больше не стоит на кнопке, выключенной правом', () => {
    for (const path of SCREENS) {
      const source = readFileSync(join(ROOT, path), 'utf8')
      const dead = source.match(/title=\{access\.reason\(/g) ?? []
      expect(dead, `${path}: мёртвая подсказка на выключенной кнопке`).toEqual([])
    }
  })

  test('причина объявлена связью с кнопкой, а не отдельным текстом', () => {
    // У обоих экранов пачки — обёртка `RightGate`, и каждая её кнопка несёт
    // `aria-describedby`: иначе читалка прочла бы причину как текст рядом,
    // неизвестно о чём.
    for (const path of SCREENS.slice(0, 2)) {
      const source = readFileSync(join(ROOT, path), 'utf8')
      const gates = source.match(/<RightGate\s/g) ?? []
      const described = source.match(/aria-describedby=\{describedBy\}/g) ?? []
      expect(gates.length, `${path}: обёрток причины нет вовсе`).toBeGreaterThan(0)
      expect(
        described.length,
        `${path}: обёрток ${gates.length}, а связей с кнопкой ${described.length}`,
      ).toBe(gates.length)
    }
  })

  test('обёртка молчит, когда право есть', () => {
    // Правило самой обёртки: пустая причина — ни строки на экране и
    // `undefined` вместо идентификатора. Иначе у тех, кому всё можно,
    // появилась бы пустая подпись под каждой кнопкой.
    const source = readFileSync(join(ROOT, 'shared/ui/right-gate.tsx'), 'utf8')
    expect(source).toContain('if (text === "") return <>{children(undefined)}</>')
  })
})
