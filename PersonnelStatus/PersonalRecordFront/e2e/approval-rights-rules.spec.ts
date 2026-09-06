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
 *
 * 🔴 КРАСНОТА НА МУТАЦИЯХ — с указанием, ГДЕ каждая живёт (дописано после
 * ревью коммита be1afdff, задача №825; до этого списка не было, и именно
 * поэтому не заметили, что две мутации из трёх переехали из расчёта в
 * необследованную обёртку):
 *   • №574, `returnBack: loading || canApprove` → `loading` или
 *     `canApprove && canReturn` — красит «Вернуть гейтится тем же правом».
 *   • право `event.manage` перестало ограничивать (`const manage = loading`)
 *     — красит «ведущий мероприятие распоряжается маршрутом». БЕЗ этого
 *     случая расчёт мог вовсе не читать `canManage`, и проба оставалась
 *     зелёной: во всех прежних случаях он был ложью.
 *   • №575, запасной путь на `event.chiefEmployeeId` — ЖИВЁТ В ОБЁРТКЕ
 *     `useApprovalRights`, не в расчёте: его возврат требует нового поля
 *     входа, которого проба не задаёт, и вычислением он не ловится вовсе.
 *     Стережётся ПИНОМ ПО ФОРМЕ ИСХОДНИКА (последний тест), тем же приёмом,
 *     что `react-list-keys` и `right-hint-pattern`.
 *   • №573, `loading: isLoading` → `loading: permissions === undefined` —
 *     ТОЖЕ в обёртке и тем же пином.
 */
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { approvalRightsOf } from '../features/security-event-stages/ui/ApprovalStage'

const SCREEN = join(__dirname, '..', 'features/security-event-stages/ui/ApprovalStage.tsx')

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

  test('ведущий мероприятие распоряжается маршрутом, но не подписывает', () => {
    // 🔴 ЕДИНСТВЕННЫЙ СЛУЧАЙ, ГДЕ `canManage` ИСТИНА (дописан по ревью, №825).
    //    Во всех остальных он ложь, и расчёт мог перестать читать право
    //    `event.manage` вовсе — мутант `const manage = loading` проходил
    //    зелёным по всем четырём тестам. Право, молча переставшее
    //    ограничивать, — ровно тот класс, ради которого карточка заведена.
    const lead = approvalRightsOf({ ...NOBODY, canManage: true })
    expect(lead.manageRoute, 'ведущий мероприятие не правит маршрут').toBe(true)
    expect(lead.send, 'ведущий мероприятие не отправляет на согласование').toBe(true)
    expect(lead.answerRemarks, 'ведущий мероприятие не отвечает на замечания').toBe(true)
    // Но подпись — другое право: `event.manage` её не даёт.
    expect(lead.approve, '`event.manage` дал право подписи').toBe(false)
    expect(lead.returnBack, '`event.manage` дал право возврата').toBe(false)
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

    // Замещающий отвечает на замечания, но не отправляет — разные права.
    const deputy = approvalRightsOf({
      ...NOBODY,
      myId: me,
      visit: { chiefEmployeeId: '99', deputies: [{ employeeId: me }] },
    })
    expect(deputy.answerRemarks, 'замещающий не может ответить на замечание').toBe(true)
    expect(deputy.send, 'замещающий отправляет объект на согласование').toBe(false)

    // Замещающих у объекта нет ВОВСЕ — ключа в ответе может не быть, и
    // `?? []` в расчёте держится этим случаем, а не соглашением.
    const noDeputies = approvalRightsOf({
      ...NOBODY,
      myId: me,
      visit: { chiefEmployeeId: '99' },
    })
    expect(noDeputies.answerRemarks, 'объект без замещающих открыл ответы').toBe(false)

    // Учётка без кадровой записи не совпадает ни с кем — даже когда у объекта
    // старшего нет вовсе. Оговорка: ложное совпадение `null === null` здесь
    // закрывает УЖЕ проверка `myId !== null`, а не сравнение старшего;
    // случай оставлен как пин поведения, но мутант, снявший `chiefId !== null`,
    // им не ловится (уточнено ревью, №825).
    const unlinked = approvalRightsOf({
      ...NOBODY,
      myId: null,
      visit: { chiefEmployeeId: null, deputies: [] },
    })
    expect(unlinked.send, 'учётка без кадровой записи стала старшим объекта').toBe(false)
  })

  test('обёртка собирает вход честно: загрузка — это isLoading, старший — только у объекта', () => {
    // 🔴 ПИН ПО ФОРМЕ ИСХОДНИКА, А НЕ ПО ПОВЕДЕНИЮ, и это осознанно. Две из
    //    трёх правок карточки живут не в расчёте, а в шестистрочной обёртке
    //    `useApprovalRights`, которая собирает вход из хуков. Вычислением их
    //    не поймать: их возврат требует НОВОГО поля входа, которого проба не
    //    задаёт, — мутант просто не касается расчёта. Живая проба персон тоже
    //    слепа: там ручка прав ОТВЕЧАЕТ, то есть `permissions !== undefined`.
    //    Приём тот же, что у `react-list-keys` и `right-hint-pattern`: читаем
    //    исходник и стережём форму.
    const source = readFileSync(SCREEN, 'utf8')
    const wrapper = source.slice(
      source.indexOf('function useApprovalRights'),
      source.indexOf('function useApprovalRights') + 600,
    )
    expect(wrapper, 'обёртка `useApprovalRights` не найдена').toContain('approvalRightsOf({')
    expect(
      wrapper,
      'загрузка снова считается по `permissions === undefined` — после 403 это истинно навсегда (Plane №573)',
    ).toContain('loading: isLoading')
    expect(
      wrapper.includes('permissions ==='),
      'в обёртке вернулось сравнение с `undefined` вместо признака загрузки (Plane №573)',
    ).toBe(false)
    expect(
      wrapper.includes('chiefEmployeeId'),
      'в обёртку вернулся запасной путь на старшего МЕРОПРИЯТИЯ (Plane №575)',
    ).toBe(false)
  })
})
