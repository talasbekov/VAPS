/**
 * Реестр «в разработке»: правила чтения (Plane №540/№597).
 *
 * 🔴 ПРОБА ЧИСТАЯ И НЕ ТРЕБУЕТ `SMOKE_LIVE`. Предмет — правило чтения реестра,
 * а не то, как оно выглядит на экране: браузер тут ничего не добавит, а
 * привязка к стенду сделала бы пробу медленной и мигающей. Тот же приём, что у
 * `route-map-coverage.spec.ts`: без переменной окружения проба даёт «passed», а
 * не «skipped», иначе молчание читалось бы как зелень.
 */
import { expect, test } from '@playwright/test'
import {
  inDevelopmentOfRoute,
  inDevelopmentOfStage,
  inDevelopmentSummary,
} from '../shared/config/in-development'

test.describe('реестр «в разработке»', () => {
  test('пустой список означает «записи нет», а не пустую метку (Plane №540, №597)', () => {
    /**
     * 🔴 ЧТО ЭТО СТЕРЕЖЁТ. Запись этапа `APPROVAL` при закрытии №446 не удалили,
     * а ОПУСТОШИЛИ: `{ pending: [] }`. Объект истинный, поэтому бейдж
     * рисовался, а подпись собиралась голой — «В разработке: » без единого
     * пункта, и в `title`, и в `aria-label`. На согласованном по спецификации
     * этапе висела метка «сюда не смотри, ещё не готово», и объяснения при
     * наведении не было.
     *
     * Проверяется ПРАВИЛО, а не факт про `APPROVAL`: следующий, кто закроет
     * последнюю карточку, опустошит список тем же движением.
     *
     * Мутация, на которой проба обязана краснеть: вернуть `BY_STAGE[stage] ??
     * null` без проверки длины.
     */
    expect(inDevelopmentOfStage('APPROVAL')).toBeNull()

    // И ни одна оставшаяся запись не смеет быть пустой: подпись, собранная из
    // неё, обязана называть хотя бы один пункт.
    const stages = [
      'BULLETIN', 'RECON', 'DEMAND', 'FORCES', 'PLACEMENT',
      'APPROVAL', 'ACKNOWLEDGEMENT', 'CONDUCT', 'CLOSED',
    ] as const
    for (const stage of stages) {
      const note = inDevelopmentOfStage(stage)
      if (note === null) continue
      expect(note.pending.length, `этап ${stage}: пустая запись`).toBeGreaterThan(0)
      expect(inDevelopmentSummary(note)).not.toBe('В разработке: ')
    }
  })

  test('запись адреса тоже не бывает пустой', () => {
    // То же правило со стороны маршрутов: реестр один, и лазейка в одной из
    // двух функций сделала бы правило половинчатым.
    for (const route of ['/security-ops/events', '/security-ops/profile', '/employees', '/statuses']) {
      const note = inDevelopmentOfRoute(route)
      if (note === null) continue
      expect(note.pending.length, `адрес ${route}: пустая запись`).toBeGreaterThan(0)
    }
    // Адрес без записи — по-прежнему `null`, а не пустая заметка.
    expect(inDevelopmentOfRoute('/dashboard')).toBeNull()
    expect(inDevelopmentOfRoute(null)).toBeNull()
  })
})
