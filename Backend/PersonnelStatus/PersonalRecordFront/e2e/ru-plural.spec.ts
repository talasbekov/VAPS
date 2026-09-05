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

  /**
   * Ответ департамента ведёт штаб В САМ СБОР (Plane №779).
   *
   * Ссылки у этого уведомления не было ОСОЗНАННО: вкладка «Сборы» и открытая
   * карточка сбора жили в состоянии компонента, адреса у них не
   * существовало, и увести человека на `/employees/` значило бы высадить его
   * на первой вкладке искать сбор руками. У соседнего уведомления (запрос
   * управлению) адрес есть с №392 — разница была не в замысле, а в том, что
   * состояние не доехало до URL.
   *
   * 🔴 ПРОВЕРЯЕТСЯ И ВЕТКА БЕЗ `eventId`: уведомления старой формы (до №677)
   * его не несут, и ссылка на них обязана вести хотя бы на вкладку сборов, а
   * не собираться в `…&collection=undefined`.
   */
  test('ответ департамента ведёт в сам сбор, а не на первую вкладку (Plane №779)', () => {
    const row = (payload: Record<string, unknown>): OpsNotification => ({
      id: 1,
      recipient: '7',
      kind: 'FORCES_RESPONSE',
      business_date: '2026-09-05',
      payload,
      read_at: null,
      created_at: '2026-09-05T00:00:00Z',
    })

    const full = describeOpsNotification(
      row({
        eventId: '5541',
        eventCode: 'ОМ-2026-26',
        eventTitle: 'Проба ответа',
        businessDate: '2026-09-05',
        departmentName: 'Первый департамент',
        requested: 3,
        allocating: 2,
      }),
    )
    expect(full.title).toBe('Первый департамент выделяет 2 из 3')
    expect(full.link).toBe('/employees/?view=forces&tab=collections&collection=5541')

    // Ноль — это ОТКАЗ, а не «выделяет нисколько»; ссылка при этом та же.
    const refused = describeOpsNotification(
      row({ eventId: '5541', departmentName: 'Первый департамент', requested: 3, allocating: 0 }),
    )
    expect(refused.title).toBe('Первый департамент: отказ по запросу сил')
    expect(refused.link).toBe('/employees/?view=forces&tab=collections&collection=5541')

    // Старая форма без `eventId` — вкладка сборов, а не «collection=undefined».
    const legacy = describeOpsNotification(
      row({ departmentName: 'Первый департамент', requested: 3, allocating: 1 }),
    )
    expect(legacy.link).toBe('/employees/?view=forces&tab=collections')
    expect(legacy.link).not.toContain('undefined')
  })

  /**
   * Напоминание за час до заступления называет СВОИМИ словами и ведёт в
   * карточку ОМ (Plane №564; правило — №427, `[ОЗН-06]`).
   *
   * У `ACKNOWLEDGEMENT_DUE_SOON` не было своей ветки: уведомление падало в
   * общую и печаталось сначала как «Отставание по сдаче · Подразделений без
   * сдачи: 0», а после №677 — как «Уведомление раздела ·
   * ACKNOWLEDGEMENT_DUE_SOON». Ссылки не было ни в том, ни в другом случае.
   * Требование выполнено на сервере (`acknowledgement_reminders.py` шлёт
   * поимённый список) и не выполнялось на экране.
   *
   * 🔴 ПРОВЕРЯЕТСЯ ИМЕННО ТО, ЧТО НУЖНО ЧИТАТЕЛЮ: фамилии, а не число.
   * Вопрос руководителя за час до заступления один — кому звонить.
   */
  test('напоминание за час называет неподтвердивших поимённо (Plane №564)', () => {
    const row = (names: string[]): OpsNotification => ({
      id: 1,
      recipient: '7',
      kind: 'ACKNOWLEDGEMENT_DUE_SOON',
      business_date: '2026-09-05',
      payload: {
        eventId: '42',
        eventCode: 'ОМ-2026-7',
        eventTitle: 'Проба напоминания',
        businessDate: '2026-09-05',
        objectName: 'Мейрам',
        asSupervisor: true,
        oneHourBefore: true,
        unconfirmed: names.map((employeeName, index) => ({
          employeeId: String(index + 1),
          employeeName,
        })),
      },
      read_at: null,
      created_at: '2026-09-05T00:00:00Z',
    })

    const one = describeOpsNotification(row(['Абаев А.']))
    expect(one.title).toBe('Через час заступление ОМ-2026-7: Абаев А.')
    expect(one.message).toBe('Проба напоминания · объект «Мейрам» · 2026-09-05')
    // Ссылка ведёт в карточку ОМ: этап «Ознакомление» там же, и руководитель
    // может отметить «лично» за позвонившего.
    expect(one.link).toBe('/security-ops/events/42/')

    // Двое — оба поимённо; трое и больше — первые двое и «ещё N»: заголовок
    // обязан читаться с одного взгляда, весь список ждёт в карточке.
    expect(describeOpsNotification(row(['Абаев А.', 'Беков Б.'])).title).toBe(
      'Через час заступление ОМ-2026-7: Абаев А., Беков Б.',
    )
    expect(
      describeOpsNotification(row(['Абаев А.', 'Беков Б.', 'Валиев В.', 'Гали Г.'])).title,
    ).toBe('Через час заступление ОМ-2026-7: Абаев А., Беков Б. и ещё 2')

    // Имён нет вовсе (кадровая запись без ФИО) — честнее назвать число, чем
    // печатать пустоту после двоеточия. Склонение — общим правилом.
    expect(describeOpsNotification(row(['', ''])).title).toBe(
      'Через час заступление ОМ-2026-7: 2 сотрудника не подтвердили',
    )
    expect(describeOpsNotification(row(['', '', '', '', ''])).title).toBe(
      'Через час заступление ОМ-2026-7: 5 сотрудников не подтвердили',
    )

    // И главное: ни следа чужой подписи, из-за которой заведена карточка.
    expect(one.title).not.toContain('Отставание по сдаче')
    expect(one.message).not.toContain('Подразделений без сдачи')
    expect(one.message).not.toContain('ACKNOWLEDGEMENT_DUE_SOON')
  })
})
