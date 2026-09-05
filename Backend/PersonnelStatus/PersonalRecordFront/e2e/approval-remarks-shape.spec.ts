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
import { remarkStatusOf } from '../features/security-event-stages/ui/ApprovalStage'
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
})
