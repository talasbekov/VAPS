/**
 * Замечание согласования СТАРОЙ формы не ломает экран (Plane №503).
 *
 * 🔴 ПРОБА ЧИСТАЯ И НЕ ТРЕБУЕТ `SMOKE_LIVE`. Предмет — как экран читает строку,
 * у которой нет половины ключей. Живой путь для неё недостижим: данные стенда
 * чинит миграция `0095` (Plane №502), и старой строки там больше нет вовсе —
 * а защита экрана нужна ровно на случай базы, поднятой из старого дампа. Тот
 * же приём, что у `route-map-coverage.spec.ts`: без переменной окружения проба
 * даёт «passed», а не «skipped».
 */
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { remarkIsOpen, remarkStatusOf } from '../entities/security-event'
import type { ApprovalRemark } from '../entities/security-event'

const OLD_OPEN = { text: 'Не устранено', resolved: false } as unknown as ApprovalRemark
const OLD_DONE = { text: 'Устранено', resolved: true } as unknown as ApprovalRemark

test.describe('замечание согласования старой формы', () => {
  test('состояние выводится из resolved, а не теряется (Plane №503)', () => {
    /**
     * 🔴 ЧТО ЭТО СТЕРЕЖЁТ. До №386 у замечания было булево `resolved`, а не
     * тройственный `status`. У такой строки `REMARK_STATUS_CLASS[remark.status]`
     * и `REMARK_STATUS_LABEL[remark.status]` давали `undefined`: плашка теряла
     * оформление — `className` буквально оканчивался словом «undefined» — и
     * оставалась БЕЗ ПОДПИСИ. Человек видел серую пустую плашку и не мог
     * понять, открыто замечание или закрыто.
     *
     * Мутация, на которой проба обязана краснеть: вернуть `remark.status` в
     * место вызова.
     */
    expect(remarkStatusOf(OLD_OPEN)).toBe('OPEN')
    expect(remarkStatusOf(OLD_DONE)).toBe('RESOLVED')
  })

  test('новая форма читается как есть, незнакомое — как открытое', () => {
    expect(remarkStatusOf({ status: 'DISAGREED' } as ApprovalRemark)).toBe('DISAGREED')
    expect(remarkStatusOf({ status: 'RESOLVED' } as ApprovalRemark)).toBe('RESOLVED')
    // Незнакомый код — «Открыто», а не пустота: замечание, о состоянии
    // которого мы не знаем, обязано держать внимание, а не исчезать.
    expect(remarkStatusOf({ status: 'ЧТО_УГОДНО' } as unknown as ApprovalRemark)).toBe('OPEN')
  })

  test('«открыто» спрашивают одной функцией — счётчики её тоже знают', () => {
    // 🔴 ЗАЧЕМ ОТДЕЛЬНАЯ ПРОВЕРКА (доводка по ревью №825). Правило жило
    // ВНУТРИ `ApprovalStage`, и знал его один экран из четырёх: реестр ОМ
    // считал «Возвращено · N замечаний» и бейдж «Срочно», «Расстановка» —
    // «N без ответа» у объекта и у поста, и все трое сравнивали СЫРОЙ
    // `status` с `'OPEN'`. На старой строке это давало ноль: буквально
    // «Возвращено · 0 замечаний» — тот самый вырожденный бейдж из №584.
    expect(remarkIsOpen(OLD_OPEN)).toBe(true)
    expect(remarkIsOpen(OLD_DONE)).toBe(false)
    expect(remarkIsOpen({ status: 'DISAGREED' } as ApprovalRemark)).toBe(false)
  })

  test('ни один читатель замечаний не сравнивает сырой status с OPEN', () => {
    // 🔴 СТОРОЖ КЛАССА, А НЕ СЛУЧАЯ. Четыре читателя разошлись молча
    // однажды — разойдутся и снова, как только появится пятый счётчик.
    // Проверяется ТЕКСТ исходников: нормализация обязана идти через
    // `remarkIsOpen`/`remarkStatusOf`, а не через сравнение поля.
    const ROOT = path.join(__dirname, '..')
    const SUSPECTS = [
      'app/security-ops/events/page.tsx',
      'features/security-event-stages/ui/PlacementStage.tsx',
      'features/security-event-stages/ui/ApprovalStage.tsx',
      'features/security-event-stages/ui/ClosedView.tsx',
    ]
    const guilty: string[] = []
    for (const file of SUSPECTS) {
      const text = readFileSync(path.join(ROOT, file), 'utf8')
      // Сравнение ЛЮБОГО `…status` с кодом замечания в файле, который эти
      // замечания читает. Строка-определение перечня статусов не в счёт:
      // она живёт в сущности, а сюда не попадает.
      for (const hit of text.matchAll(/\.status\s*===\s*["'](OPEN|RESOLVED|DISAGREED)["']/g)) {
        guilty.push(`${file}: ${hit[0]}`)
      }
    }
    expect(
      guilty,
      'читатель замечаний сравнивает сырой status: у строки старой формы его ' +
        'нет вовсе, и счётчик молча покажет ноль — зовите remarkIsOpen',
    ).toEqual([])
  })
})
