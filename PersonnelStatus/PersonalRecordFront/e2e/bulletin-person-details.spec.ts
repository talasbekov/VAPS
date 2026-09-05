/**
 * Атрибуты визита главного лица в окне «Создать бюллетень» (Plane №631, №630).
 *
 * 🔴 ПРОБА ЧИСТАЯ И НЕ ТРЕБУЕТ `SMOKE_LIVE`. Обе потери, которые она стережёт,
 * были ТИХИМИ — ни отказа, ни сообщения, — и заметить их можно только сверив
 * сохранённое с введённым. Функция `personDetailsOf` чистая, живой стенд ей не
 * нужен, а привязка к стенду сделала бы пробу медленной и мигающей: тот же
 * приём, что у `route-map-coverage.spec.ts` — без переменной окружения проба
 * даёт «passed», а не «skipped», иначе молчание читалось бы как зелень.
 *
 * Живой путь через форму пробовался и снят осознанно: он требует ДВУХ полных
 * проходов по окну создания, ловит пересоздание кнопки реестра и падает на
 * справочнике лиц, который на dev-стенде отвечает не всегда. Проба про
 * ЛОГИКУ не должна зависеть от того, ответил ли справочник.
 */
import { expect, test } from '@playwright/test'
import {
  personDetailsOf,
  type FormValues,
} from '../features/create-security-event/ui/CreateSecurityEventDialog'

const BASE: FormValues = {
  kind: 'INTERNAL',
  businessDate: '2026-11-10',
  businessDateEnd: '2026-11-12',
  eventTime: '',
  timeMark: '',
  flight: '',
  title: 'Проба',
  protectedPersonIds: ['7'],
  objectId: '',
  countryId: '1',
  cityId: '1',
  address: '',
  chiefEmployeeId: '',
} as unknown as FormValues

const values = (patch: Partial<FormValues>): FormValues => ({ ...BASE, ...patch })

test.describe('атрибуты визита главного лица', () => {
  test('вылет пишется днём ОКОНЧАНИЯ, прилёт — днём начала (Plane №631)', () => {
    // 🔴 Мутация, на которой проба обязана краснеть: собрать `departureAt` из
    // `businessDate` — у ОМ 10.11-12.11 вылет уедет на 10.11.
    const [departure] = personDetailsOf(
      values({ timeMark: 'departure', eventTime: '19:45' })
    )
    expect(departure.departureAt).toBe('2026-11-12T19:45')

    // Прилёт — другой край периода, и брать для обоих один значило бы
    // утверждать, что лицо улетело в день приезда.
    const [arrival] = personDetailsOf(values({ timeMark: 'arrival', eventTime: '09:15' }))
    expect(arrival.arrivalAt).toBe('2026-11-10T09:15')

    // Дата окончания не названа — другого дня у мероприятия просто нет.
    const [fallback] = personDetailsOf(
      values({ timeMark: 'departure', eventTime: '19:45', businessDateEnd: '' })
    )
    expect(fallback.departureAt).toBe('2026-11-10T19:45')
  })

  test('борт доезжает без времени, а момент не выдумывается (Plane №630)', () => {
    // «Время» НЕОБЯЗАТЕЛЬНО, а «Борт» включается одной лишь пометкой
    // вылет/прилёт: выход по пустому времени терял борт молча.
    //
    // 🔴 Мутация, на которой проба обязана краснеть: вернуть выход при
    // `eventTime === ''` — список станет пустым, и борт исчезнет.
    const [onlyFlight] = personDetailsOf(
      values({ timeMark: 'departure', flight: 'KC-747' })
    )
    expect(onlyFlight.flightDeparture).toBe('KC-747')
    // Момент НЕ придуман: пустая ячейка — честный ответ «сведений нет».
    expect(onlyFlight.departureAt).toBeUndefined()

    // И наоборот: время без борта — момент есть, борт пуст.
    const [onlyTime] = personDetailsOf(
      values({ timeMark: 'arrival', eventTime: '09:15' })
    )
    expect(onlyTime.arrivalAt).toBe('2026-11-10T09:15')
    expect(onlyTime.flightArrival).toBe('')
  })

  test('без пометки и без содержимого деталей нет вовсе', () => {
    // Пометка — единственный признак, что час относится к прилёту или вылету;
    // без неё писать некуда.
    expect(personDetailsOf(values({ eventTime: '09:15', flight: 'KC-747' }))).toEqual([])
    // Пометка есть, но сказать нечего — пустая строка деталей была бы записью
    // «мы что-то знаем» там, где не знаем ничего.
    expect(personDetailsOf(values({ timeMark: 'departure' }))).toEqual([])
    // Лица нет — атрибуты визита принадлежат ГЛАВНОМУ лицу.
    expect(
      personDetailsOf(values({ timeMark: 'departure', flight: 'KC-747', protectedPersonIds: [] }))
    ).toEqual([])
  })
})
