/**
 * Правила прав экрана согласования — ВЫЧИСЛЕНИЕМ, а не браузером
 * (Plane №802; сами правила — №573, №574, №575).
 *
 * 🔴 ПОЧЕМУ НЕ ЖИВОЙ ПРОБОЙ. Три правки этих правил уехали БЕЗ пробы, и не
 * по небрежности: живая проверка через `toBeDisabled()` ничего не различает —
 * кнопка «Отправить на согласование» выключается ещё и по пустому маршруту, и
 * на фикстуре стенда выключена всегда, так что ОБЕ мутации проходили
 * зелёными. Проверка через подпись точнее, но подмена ответа
 * `/api/operations/my-permissions/` до расчёта не доходила: права приезжали
 * настоящие (у админа они «*»).
 *
 * Предмет тут чисто вычислительный — сети в нём нет вовсе. Значит и проверять
 * его надо вычислением: входы задаются прямо, выходы читаются прямо, и каждое
 * правило краснеет на СВОЕЙ мутации. Живая проба персон (`approval-rights`)
 * остаётся на месте: она отвечает на другой вопрос — что видит конкретная
 * учётка заказчика.
 *
 * `SMOKE_LIVE` не нужен, как и сверке маршрутов: без переменной проба даёт
 * «passed», а не «skipped», иначе молчание читалось бы как зелень.
 */
import { expect, test } from '@playwright/test'

import { approvalRightsOf } from '../features/security-event-stages/ui/ApprovalStage'

/** Смотрящий без единого права раздела и без кадровой записи. */
const NOBODY = {
  loading: false,
  canManage: false,
  canApprove: false,
  myId: null,
  visit: null,
} as const

test.describe('права экрана согласования', () => {
  test('отказ прав — НЕ загрузка: кнопки выключены, а не приглашают (Plane №573)', () => {
    // Пока права ЕДУТ — кнопки открыты намеренно: мигание «нельзя → можно»
    // вводит в заблуждение сильнее, чем секунда доступной кнопки, а сервер
    // всё равно стоит за ними.
    const loading = approvalRightsOf({ ...NOBODY, loading: true })
    expect(loading.manageRoute).toBe(true)
    expect(loading.send).toBe(true)
    expect(loading.approve).toBe(true)
    expect(loading.returnBack).toBe(true)

    // 🔴 А ПОСЛЕ ОТКАЗА — выключены. Здесь стояло `permissions === undefined`,
    // истинное и после 403/500 навсегда: окно в секунду превращалось в
    // вечность, человек жал и получал голый отказ сервера.
    const refused = approvalRightsOf(NOBODY)
    expect(refused.manageRoute, 'после отказа прав маршрут открыт').toBe(false)
    expect(refused.send, 'после отказа прав «Отправить» открыта').toBe(false)
    expect(refused.approve, 'после отказа прав «Согласовать» открыта').toBe(false)
    expect(refused.returnBack, 'после отказа прав «Вернуть» открыта').toBe(false)
  })

  test('«Вернуть» гейтится тем же правом, что «Согласовать» (Plane №574)', () => {
    // Обе кнопки зовут ОДНУ ручку решения согласующего, и сервер гейтит её
    // `assignment.approve`. Право `assignment.return` закрывает другую ручку,
    // которую экран не зовёт вовсе.
    const approver = approvalRightsOf({ ...NOBODY, canApprove: true })
    expect(approver.approve).toBe(true)
    expect(approver.returnBack, '«Вернуть» спрятана у того, кто может решать').toBe(true)

    // И наоборот: без права решения обе закрыты — иначе кнопка отвечала бы 403.
    const outsider = approvalRightsOf(NOBODY)
    expect(outsider.approve).toBe(false)
    expect(outsider.returnBack).toBe(false)
  })

  test('старший берётся ТОЛЬКО у показанного объекта (Plane №575)', () => {
    const me = '77'
    // Старший ПОКАЗАННОГО объекта отправляет и отвечает на замечания без
    // `event.manage` — так же считает сервер (`_object_lead_override`).
    const chief = approvalRightsOf({
      ...NOBODY,
      myId: me,
      visit: { chiefEmployeeId: me, deputies: [] },
    })
    expect(chief.send, 'старший объекта не может отправить свой объект').toBe(true)
    expect(chief.answerRemarks).toBe(true)
    // Но маршрутом и подписью он не распоряжается: это другие права.
    expect(chief.manageRoute).toBe(false)
    expect(chief.approve).toBe(false)

    // 🔴 ОБЪЕКТА НЕТ — СТАРШЕГО НЕТ. Здесь стоял запасной путь на
    // `event.chiefEmployeeId`: старший МЕРОПРИЯТИЯ получал включённые кнопки,
    // отвечающие голым 403, потому что сервер принимает исключительно
    // старшего объекта и при его отсутствии отказывает прямо.
    const noVisit = approvalRightsOf({ ...NOBODY, myId: me, visit: null })
    expect(noVisit.send, 'без объекта отправка открыта — сервер ответит 403').toBe(false)
    expect(noVisit.answerRemarks).toBe(false)

    // Старший ДРУГОГО объекта — посторонний для этого.
    const otherChief = approvalRightsOf({
      ...NOBODY,
      myId: me,
      visit: { chiefEmployeeId: '99', deputies: [] },
    })
    expect(otherChief.send, 'старший чужого объекта отправляет этот').toBe(false)

    // Замещающий, ВЕДУЩИЙ объект, отвечает на замечания, но не отправляет —
    // разные права.
    const deputy = approvalRightsOf({
      ...NOBODY,
      myId: me,
      visit: {
        chiefEmployeeId: '99',
        deputies: [{ employeeId: me, canEditPlacement: true }],
      },
    })
    expect(deputy.answerRemarks, 'замещающий не может ответить на замечание').toBe(true)
    expect(deputy.send, 'замещающий отправляет объект на согласование').toBe(false)

    // 🔴 НАБЛЮДАТЕЛЬ — НЕ ЗАМЕЩАЮЩИЙ (Plane №572). Флаг `canEditPlacement`
    // отличает того, кто ВЕДЁТ объект, от внесённого «в список». Сервер
    // теперь спрашивает его же, и экран, показывающий кнопку тому, кому
    // сервер откажет, приглашает к действию, которого не будет.
    const watcher = approvalRightsOf({
      ...NOBODY,
      myId: me,
      visit: {
        chiefEmployeeId: '99',
        deputies: [{ employeeId: me, canEditPlacement: false }],
      },
    })
    expect(
      watcher.answerRemarks,
      'наблюдателю показаны кнопки ответа на замечание — сервер их отобьёт',
    ).toBe(false)

    // Строка БЕЗ флага — старая форма: умолчание модели «ведёт», и отнимать
    // право у тех, кто его имел, правка не должна.
    const legacy = approvalRightsOf({
      ...NOBODY,
      myId: me,
      visit: { chiefEmployeeId: '99', deputies: [{ employeeId: me }] },
    })
    expect(legacy.answerRemarks, 'старая строка замещающего потеряла право').toBe(true)

    // Учётка без кадровой записи не совпадает ни с кем — даже когда у объекта
    // старшего нет вовсе (`null === null` дало бы ложное совпадение).
    const unlinked = approvalRightsOf({
      ...NOBODY,
      myId: null,
      visit: { chiefEmployeeId: null, deputies: [] },
    })
    expect(unlinked.send, 'учётка без кадровой записи стала старшим объекта').toBe(false)
  })
})
