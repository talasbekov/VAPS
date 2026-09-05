/**
 * Согласование существительного с числом (Plane №585, №562).
 *
 * 🔴 ПОЧЕМУ ЭТА ПРОБА НЕ ЖИВАЯ И НЕ ТРЕБУЕТ `SMOKE_LIVE`. Она проверяет ЧИСТОЕ
 * правило языка и чистую сборку строки уведомления — ни браузера, ни стенда для
 * этого не нужно, а привязка к стенду сделала бы её медленной и мигающей. Тот
 * же приём, что у `route-map-coverage.spec.ts`: без переменной окружения она
 * даёт «passed», а не «skipped», — иначе молчание читалось бы как зелень.
 *
 * ЧТО СТЕРЕЖЁТ. Правило писали заново в каждом месте, где оно понадобилось, и
 * оно расходилось: в бейдже реестра 21 давало «21 замечание», а в уведомлении о
 * ТОМ ЖЕ возврате — «21 замечаний»; уведомление о запросе сил не склоняло вовсе
 * («Выделите 1 сотрудников»). Числа второго десятка — не редкость: столько
 * замечаний бывает у объекта с большим расчётом.
 */
import { expect, test } from '@playwright/test'
import { EMPLOYEES, REMARKS, ruCount, ruPlural } from '../lib/ru-plural'
import { describeOpsNotification } from '../features/notifications/api/notifications-api'
import type { OpsNotification } from '../lib/api'

test.describe('склонение по числу', () => {
  test('второй десяток не путается с хвостом: 11-14 отдельно от 1-4', () => {
    // Ровно те числа, на которых ломается тернарник без `% 100`.
    expect(REMARKS.map((_, i) => i)).toHaveLength(3)
    expect(ruPlural(1, REMARKS)).toBe('замечание')
    expect(ruPlural(2, REMARKS)).toBe('замечания')
    expect(ruPlural(5, REMARKS)).toBe('замечаний')
    expect(ruPlural(11, REMARKS)).toBe('замечаний')
    expect(ruPlural(12, REMARKS)).toBe('замечаний')
    expect(ruPlural(14, REMARKS)).toBe('замечаний')
    expect(ruPlural(21, REMARKS)).toBe('замечание')
    expect(ruPlural(22, REMARKS)).toBe('замечания')
    expect(ruPlural(24, REMARKS)).toBe('замечания')
    expect(ruPlural(25, REMARKS)).toBe('замечаний')
    expect(ruPlural(0, REMARKS)).toBe('замечаний')
    expect(ruPlural(101, REMARKS)).toBe('замечание')
    expect(ruPlural(111, REMARKS)).toBe('замечаний')
    expect(ruCount(21, REMARKS)).toBe('21 замечание')
  })

  test('уведомление о возврате расстановки склоняет замечания (Plane №585)', () => {
    const row = (remarksOpen: number): OpsNotification => ({
      id: 1,
      recipient: '7',
      kind: 'PLACEMENT_RETURNED',
      business_date: '2026-09-05',
      payload: {
        remarksOpen,
        objectName: 'Мейрам',
        eventCode: 'ОМ-2026-1',
        eventTitle: 'Проба',
        businessDate: '2026-09-05',
        eventId: '1',
        visitObjectId: '2',
      },
      read_at: null,
      created_at: '2026-09-05T00:00:00Z',
    })
    // 🔴 Мутация, на которой проба обязана краснеть: вернуть тернарник без
    // `% 100` — 21 снова станет «21 замечаний».
    expect(describeOpsNotification(row(21)).title).toContain('возвращена: 21 замечание')
    expect(describeOpsNotification(row(11)).title).toContain('возвращена: 11 замечаний')
    expect(describeOpsNotification(row(2)).title).toContain('возвращена: 2 замечания')
  })

  test('запрос сил называет число сотрудников по-русски (Plane №562)', () => {
    const row = (need: number): OpsNotification => ({
      id: 1,
      recipient: '7',
      kind: 'FORCES_REQUEST',
      business_date: '2026-09-05',
      payload: {
        need,
        eventCode: 'ОМ-2026-1',
        eventTitle: 'Проба',
        businessDate: '2026-09-05',
        departmentName: 'Первый департамент',
        allocationId: 'alloc-1',
      },
      read_at: null,
      created_at: '2026-09-05T00:00:00Z',
    })
    // Единица — «сотрудника»: «Выделите 1 сотрудников» было самым частым
    // значением этого уведомления и самой заметной ошибкой.
    expect(describeOpsNotification(row(1)).title).toBe('Выделите 1 сотрудника на ОМ-2026-1')
    // Одушевлённый винительный: и у 2-4, и у 5+ — «сотрудников».
    expect(describeOpsNotification(row(2)).title).toBe('Выделите 2 сотрудников на ОМ-2026-1')
    expect(describeOpsNotification(row(5)).title).toBe('Выделите 5 сотрудников на ОМ-2026-1')
    expect(ruPlural(1, EMPLOYEES)).toBe('сотрудника')
  })
})
