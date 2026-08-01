// @vitest-environment jsdom
// Стори 10.9 — страница журнала (AC-8, AC-9, AC-10).
//
// Ветка «есть строки» достижима ТОЛЬКО через проп `fixes` — это осознанный шов
// (Решение №4), а не украшение: без него до E13 она была бы недостижима и
// покрыта нулём тестов. Урок 10.5 (HIGH): каждая ветка карты отказов обязана
// иметь тест с фикстурой, иначе она украшение.
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_VERSION, BUILD_SHA, buildLabel } from '../../shared/version'
import type { FixEntry } from './changelog'
import { ChangelogPage } from './ChangelogPage'

afterEach(() => {
  cleanup()
  vi.resetModules()
  vi.doUnmock('../../shared/version')
})

// Различимы по ВСЕМ полям: одинаковые значения сделали бы ассерт порядка
// вакуумным («сравнение с самим собой», ретро E9).
const FIX_OLD: FixEntry = {
  id: 'fix-001',
  version: '0.1.0',
  releasedAt: '2026-03-04',
  summary: 'Расход дня не сходился после отмены секондмента',
}
const FIX_NEW: FixEntry = {
  id: 'fix-002',
  version: '0.2.0',
  releasedAt: '2026-07-19',
  summary: 'Светофор показывал «нет данных» вместо опоздания',
}

describe('ChangelogPage — секция версии (AC-8.1)', () => {
  it('рендерит РЕАЛЬНУЮ версию сборки, а не заглушку', () => {
    render(<ChangelogPage />)

    // regex, а НЕ литеральный номер: литерал сгниёт на первом же бампе и
    // сломается, если в env гейта окажется VAPS_APP_VERSION (AC-4).
    //
    // 🔴 `\d` в конце — не педантизм: канон-строка секции «Версия приложения»
    // тоже начинается со слова «Версия», и голый /^Версия / нашёл ДВА узла
    // (поймано на первом же прогоне). Подпись версии отличается тем, что за
    // словом идёт НОМЕР.
    expect(screen.getByText(/^Версия \d/)).toHaveTextContent(APP_VERSION)
  })

  it('секция «Версия приложения» существует как заголовок', () => {
    render(<ChangelogPage />)

    expect(
      screen.getByRole('heading', { name: 'Версия приложения' }),
    ).toBeInTheDocument()
  })

  it('H1 страницы — журнал, а не раздел портала', () => {
    render(<ChangelogPage />)

    expect(
      screen.getByRole('heading', { level: 1, name: /Журнал/ }),
    ).toBeInTheDocument()
  })

  // ═══ QA-добор 10.9: МЕТКА СБОРКИ ═══
  // AC-8.1 требует рендерить «реальные APP_VERSION и (при непустом) sha», но
  // на момент QA-прохода метку сборки не ассертил НИ ОДИН тест проекта — ни
  // здесь, ни в changelog-routing.test.tsx (греп по `сборка|buildLabel|
  // BUILD_SHA` в тестах дал 0 строк). Обе ветки условия `build === '' ? null`
  // были украшением в смысле урока 10.5: удали блок целиком — всё зелёное.
  /**
   * Блок секции версии — тот самый CardContent, где живут подпись версии и
   * метка сборки. Нужен, чтобы считать УЗЛЫ, а не только текст: см. соседний
   * тест про пустой sha.
   */
  function versionBlock(): HTMLElement {
    const block = screen.getByText(/^Версия \d/).parentElement
    if (block === null) throw new Error('секция версии не найдена')
    return block
  }

  it('🔴 при непустом sha метка сборки ОТРИСОВАНА и несёт реальный sha', () => {
    // BUILD_SHA в vitest — реальный sha коммита (define действует и в тестах,
    // ловушка 1 спеки). Ассертим форму и производную от значения, а НЕ литерал:
    // литеральный sha сгнил бы на следующем же коммите.
    expect(BUILD_SHA).not.toBe('')

    render(<ChangelogPage />)

    expect(screen.getByText(buildLabel(BUILD_SHA))).toBeInTheDocument()
    expect(screen.getByText(/^сборка \S/)).toHaveTextContent(BUILD_SHA)
    expect(versionBlock().querySelectorAll('p')).toHaveLength(2)
  })

  it('🔴 пустой sha → метки сборки НЕТ (сборка вне git не рендерит «неизвестно»)', async () => {
    // Единственный способ дойти до этой ветки: на машине с git BUILD_SHA
    // никогда не пуст, и ветка недостижима по построению — ровно тот класс,
    // что AC-9 называет украшением. doMock (не vi.mock) — потому что он НЕ
    // поднимается наверх файла и потому не портит соседние тесты, которые
    // судят страницу по НАСТОЯЩИМ константам сборки.
    vi.resetModules()
    vi.doMock('../../shared/version', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../shared/version')>()),
      BUILD_SHA: '',
    }))
    const { ChangelogPage: Page } = await import('./ChangelogPage')

    render(<Page />)

    // версия на месте — пустой sha гасит ТОЛЬКО метку сборки
    expect(screen.getByText(/^Версия \d/)).toBeInTheDocument()
    expect(screen.queryByText(/^сборка/)).not.toBeInTheDocument()
    // 🔴 СЧЁТ УЗЛОВ, а не только текста. Без него тест вакуумен: `buildLabel('')`
    // и так отдаёт пустую строку, поэтому снятый гард `build === '' ? null`
    // отрисовал бы ПУСТОЙ <p> — текстовый ассерт выше остался бы зелёным
    // (класс «дубль-гард → вакуумная проба», урок 10.6 MEDIUM). Узел считаем —
    // и гард снова становится единственным владельцем ветки.
    expect(versionBlock().querySelectorAll('p')).toHaveLength(1)
  })
})

describe('ChangelogPage — пустое состояние (AC-8, Решение №5)', () => {
  it('без фикстуры: объяснение показано, таблица НЕ нарисована', () => {
    render(<ChangelogPage />)

    expect(screen.getByText('Исправлений пока нет.')).toBeInTheDocument()
    // «таблица с шапкой НЕ рисуется» — иначе пустая шапка выглядела бы сбоем
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('явно пустой список ведёт себя как отсутствие пропа', () => {
    render(<ChangelogPage fixes={[]} />)

    expect(screen.getByText('Исправлений пока нет.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

describe('ChangelogPage — ветка «есть строки» (AC-9)', () => {
  it('строки фикстуры отрисованы всеми полями', () => {
    render(<ChangelogPage fixes={[FIX_OLD, FIX_NEW]} />)

    const table = screen.getByRole('table')
    expect(within(table).getByText(FIX_NEW.summary)).toBeInTheDocument()
    expect(within(table).getByText(FIX_OLD.summary)).toBeInTheDocument()
    expect(within(table).getByText('0.2.0')).toBeInTheDocument()
    // дата — перестановкой строки (AC-10), а не через Date
    expect(within(table).getByText('19.07.2026')).toBeInTheDocument()
    expect(within(table).getByText('04.03.2026')).toBeInTheDocument()
    expect(screen.queryByText('Исправлений пока нет.')).not.toBeInTheDocument()
  })

  it('🔴 НОВЫЕ СВЕРХУ — порядок ассертится позицией, а не наличием', () => {
    render(<ChangelogPage fixes={[FIX_OLD, FIX_NEW]} />)

    const rows = screen.getAllByRole('row').slice(1) // без строки шапки
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent(FIX_NEW.summary)
    expect(rows[1]).toHaveTextContent(FIX_OLD.summary)
  })

  it('обратный порядок входа даёт ТОТ ЖЕ вывод — сортирует страница, не вход', () => {
    render(<ChangelogPage fixes={[FIX_NEW, FIX_OLD]} />)

    const rows = screen.getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent(FIX_NEW.summary)
    expect(rows[1]).toHaveTextContent(FIX_OLD.summary)
  })

  it('колонки названы канон-строками', () => {
    render(<ChangelogPage fixes={[FIX_NEW]} />)

    const table = screen.getByRole('table')
    expect(
      within(table).getByRole('columnheader', { name: 'Версия' }),
    ).toBeInTheDocument()
    expect(
      within(table).getByRole('columnheader', { name: 'Дата' }),
    ).toBeInTheDocument()
    expect(
      within(table).getByRole('columnheader', { name: 'Что исправлено' }),
    ).toBeInTheDocument()
  })

  it('проп не мутирует переданный массив', () => {
    const input: readonly FixEntry[] = [FIX_OLD, FIX_NEW]
    render(<ChangelogPage fixes={input} />)

    expect(input[0]).toBe(FIX_OLD)
    expect(input[1]).toBe(FIX_NEW)
  })
})
