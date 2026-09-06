/**
 * Подготовка мероприятий для живых проб — ОДНА реализация на все спеки.
 *
 * Вынесено из `forces-gathering.spec.ts` при Plane №271 Ш-2: вторая проба
 * тоже начинается с «ОМ, доведённого до посчитанной потребности», а копия
 * подготовки означала бы две реализации одного, которые разойдутся при первой
 * же правке цепочки стадий. Импортировать из спеки нельзя — её тесты
 * зарегистрировались бы дважды.
 *
 * 🔴 ПРОБЫ ДОЛЖНЫ ЗАВОДИТЬ СВОЁ, А НЕ БРАТЬ СТЕНДОВОЕ. Фикстуры смоука общие,
 * и спека, взявшая чужое мероприятие, зелена в одиночку и красна в полном
 * прогоне: сосед успевает перевести его в состояние, где правка отбивается.
 */
import { probeTitle } from './probe-events'
import { anyChiefId } from './stand-chief'

const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

/** Ответ ручки стенда, разобранный из JSON. Форма у каждой ручки своя. */
import { assertStep } from './fixture-step'

type StandResponse = any

export type StandCall = (
  method: string,
  path: string,
  body?: unknown,
) => Promise<StandResponse>

/**
 * Обёртка над API стенда: заголовки, тело и разбор — ОДИН раз на весь смоук.
 *
 * 🔴 ШЕСТНАДЦАТЬ КОПИЙ ОДНОГО (Plane №822, замерено 06.09.2026:
 * `grep -rl 'publishedVersionCount > 0' e2e/*.ts` даёт 16 файлов). У каждой
 * спеки свой `call`, свой поиск объекта с паспортом и своё сообщение об
 * ошибке. Когда контракт заведения ОМ менялся — обязательный `kind` с
 * 23.08 — править надо было все шестнадцать; правили не все, и копии
 * расходятся молча.
 */
export function standCall(token: string): StandCall {
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  return async (method, path, body) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    // 🔴 ШАГ-ПЕРЕХОД, ОТБИТЫЙ СЕРВЕРОМ, РОНЯЕТ ПОДГОТОВКУ ЗДЕСЬ (Plane №812,
    //    №813; пропуск найден ревью, задача №825). Это ОБЩАЯ фикстура трёх
    //    спек, и до сих пор она была единственным местом, где шаги молчали:
    //    сторож `fixture-steps-checked` читал только `*.spec.ts` и помощника
    //    не видел вовсе. Между тем именно здесь идут `recon/complete/` и
    //    `recon/import-from-passport/` — те самые переходы, ради которых
    //    карточка и заведена, и результат `recon/complete/` тут же
    //    разбирается по полям: отказ давал `undefined` вместо кода, и проба
    //    умирала десятью строками ниже с «элемент не найден».
    await assertStep(res, method, path)
    return res.json().catch(() => ({}))
  }
}

/** Объект стенда с опубликованным паспортом — без него ОМ не завести. */
export async function objectWithPassport(call: StandCall): Promise<{ id: string }> {
  const objects = await call('GET', '/api/ops/security-events/bindable-objects/')
  const object = (objects.results ?? []).find(
    (item: { publishedVersionCount: number }) => item.publishedVersionCount > 0,
  )
  if (object === undefined) throw new Error('на стенде нет объекта с паспортом')
  return object
}

/**
 * СВОЁ мероприятие с объектом — заведённое пробой, а не найденное на стенде.
 *
 * 🔴 ЗАЧЕМ СВОЁ, А НЕ ПЕРВОЕ ПОДХОДЯЩЕЕ (Plane №822). Пробы, которые ПРАВЯТ
 * состояние, не имеют права брать чужую строку: стенд один на все сессии.
 * Замерено 05.09.2026 на `recon-stage`: проба на общем ОМ давала ✓ ✘ ✓ ✘ без
 * единой правки кода, причём падение было ровно тем симптомом, который она
 * стережёт, — то есть врало про дефект.
 *
 * Читающим пробам первый подходящий по-прежнему годится: они ничего не меняют.
 *
 * 🔴 ЧЕГО ЭТОТ ПОМОЩНИК НЕ ЛЕЧИТ — знать заранее, а не выяснять заново
 * (замер 06.09.2026, №822 дал четыре РАЗНЫХ подвида, свой ОМ лечит два):
 *   • «первую строку ТАБЛИЦЫ» в интерфейсе: `page.locator('table tbody
 *     tr').first()` на `/statuses` берёт того, кого поставила соседняя
 *     сессия. Лечится выбором своего человека ПО ИМЕНИ (Ш-5);
 *   • исчерпание кадрового пула: своё мероприятие есть, а свободных людей на
 *     его день уже нет — их заняли ПРЕДЫДУЩИЕ пробы того же прогона. Лечится
 *     своей деловой датой (Ш-6), и потому `businessDate` здесь ОБЯЗАТЕЛЬНЫЙ
 *     параметр без умолчания: общая дата у двух спек воспроизводит ровно ту
 *     беду, от которой уходим.
 *
 * `kind` обязателен с 23.08: без него создание отбивается 400, и вся
 * подготовка дальше бьёт по `/security-events/undefined/`.
 */
export async function createOwnEvent(
  call: StandCall,
  token: string,
  { name, businessDate }: { name: string; businessDate: string },
): Promise<StandResponse & { id: string; code: string }> {
  const object = await objectWithPassport(call)
  const created = await call('POST', '/api/ops/security-events/', {
    // Метка `(e2e)` ставится помощником, а не руками (Plane №457): строку без
    // неё не находит ни уборка прогона, ни `purge_probe_events`, а сама проба
    // удалить её не сможет — своё удаление сервер отбивает, пока у ОМ есть
    // расстановка.
    title: probeTitle(name),
    objectId: object.id,
    businessDate,
    kind: 'INTERNAL',
    chiefEmployeeId: await anyChiefId(token),
  })
  // Ответ сервера возвращается ЦЕЛИКОМ, а не двумя полями: для пробы заведения
  // предмет проверки — само состояние заведения, и урезать его здесь значило бы
  // заставить её сходить за тем же вторым запросом.
  return { ...created, id: String(created.id), code: created.code }
}

export async function prepareDemandEvent(
  token: string,
  businessDate = '2026-08-26',
  // `id` дописан к возврату (Plane №675): пробам нужен адрес ручек самого
  // мероприятия (оповещение, довыделение), и искать его по коду через реестр
  // значило бы завести второй способ узнать то, что здесь уже известно.
): Promise<{ id: string; code: string; total: number }> {
  const call = standCall(token)
  const created = await createOwnEvent(call, token, {
    name: 'Проба раскладки сил',
    businessDate,
  })
  const base = `/api/ops/security-events/${created.id}`
  await call('PATCH', `${base}/bulletin/`, {
    briefDescription: 'Проба раскладки.',
    initialTasks: '—',
  })
  // 🔴 ЗДЕСЬ БЫЛ МЁРТВЫЙ ШАГ `bulletin/complete/` (Plane №812; в девяти
  //    спеках он снят коммитом 315e0968, а в ОБЩЕЙ фикстуре остался —
  //    пропуск найден ревью, задача №825). ОМ, заведённый С ОБЪЕКТОМ, встаёт
  //    сразу на рекогносцировку, и завершать бюллетень нечего: сервер отвечал
  //    INVALID_STAGE_TRANSITION, а фикстура шла дальше молча. Пока шаги не
  //    проверялись, это было незаметно; теперь `standCall` роняет подготовку
  //    на первом же отбитом шаге, и мёртвую строку надо снять, а не глушить.
  await call('POST', `${base}/recon/import-from-passport/`)
  const afterImport = await call('GET', `${base}/`)
  const posts = afterImport.reconSectorPosts.map(
    (post: Record<string, unknown>, index: number) =>
      index === 0 ? { ...post, need: 4 } : post,
  )
  await call('PATCH', `${base}/recon/`, {
    checklist: afterImport.reconChecklist.map((item: Record<string, unknown>) => ({
      ...item,
      state: 'NORMAL',
      done: true,
      result: 'MATCHES',
    })),
    sectorPosts: posts,
  })
  const demand = await call('POST', `${base}/recon/complete/`)
  return { id: created.id, code: demand.code, total: demand.forceDemandTotal }
}
