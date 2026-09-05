/**
 * Мок-слой знает про ЭТАПЫ ОБЪЕКТОВ ПОСЕЩЕНИЯ (Plane №792).
 *
 * 🔴 ЧТО ЭТО СТЕРЕЖЁТ. На сервере этап живёт у ОБЪЕКТА (`[МД-04]`, №411/№412),
 * а этап мероприятия — НАИМЕНЬШИЙ среди объектов. Мок знал только
 * `event.stage` и переписывал им объекты зеркалом, а у ОМ с двумя объектами
 * зеркало отключалось целиком. Поэтому мок не мог воспроизвести ни один
 * случай, ради которых заведены №475 и №477: возврат одного объекта,
 * роняющий этап ОМ; гвард отправки, спрашивающий стадию НЕ ТОГО объекта.
 *
 * Это не гипотеза: гвард отправки в моке был `event.stage !== 'APPROVAL'` —
 * ровно та формула, которую на сервере пришлось чинить как дефект (№475).
 * Пока мок отвечал по старой формуле, фронт-проба по нему была зелена на
 * поведении, которого на живом стеке нет.
 *
 * Проба говорит с моком ЗАПРОСАМИ, а не экраном: предмет — правила
 * мок-слоя, а не разметка. Запросы идут из страницы (`page.evaluate`), иначе
 * их не перехватит service worker MSW.
 *
 * МУТАЦИИ, НА КОТОРЫХ ПРОБА ОБЯЗАНА КРАСНЕТЬ:
 *   • вернуть гвард к `event.stage !== "APPROVAL"`;
 *   • вернуть зеркалу переписывание `visit.stage` стадией мероприятия;
 *   • считать стадию ОМ не наименьшей, а стадией первого объекта.
 */
import { expect, test } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const MOCK_APP = process.env.SMOKE_MOCK_APP ?? ''

interface Visit {
  id: string
  objectId: string
  stage: string
}
interface EventShape {
  id: string
  stage: string
  visitObjects: Visit[]
}

test.describe(
  MOCK_APP === '' ? 'мок: этапы объектов (скип: нет SMOKE_MOCK_APP)' : 'мок: этапы объектов',
  () => {
    test.skip(MOCK_APP === '', 'нужен dev-сервер на моке: SMOKE_MOCK_APP=…')

    test('возврат ОДНОГО объекта роняет этап ОМ, а гвард спрашивает объект (Plane №792)', async ({
      page,
    }) => {
      const api = page.context().request
      const csrf = (await (await api.get(`${MOCK_APP}/api/auth/csrf/`)).json()) as {
        csrfToken: string
      }
      await api.post(`${MOCK_APP}/api/auth/callback/credentials/`, {
        form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
      })
      await page.goto(`${MOCK_APP}/security-ops/events/`)
      await expect(page.getByRole('heading', { name: 'Реестр ОМ' })).toBeVisible({
        timeout: 30_000,
      })

      const result = await page.evaluate(async () => {
        const call = async (method: string, path: string, body?: unknown) => {
          const res = await fetch(path, {
            method,
            headers: { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
          })
          return { status: res.status, payload: await res.json().catch(() => ({})) }
        }
        const base = '/api/ops/security-events/se-1'

        // Второй объект посещения — до правки такой ручки в моке не было
        // вовсе, и ОМ с двумя объектами не существовало в принципе.
        const objects = await call('GET', '/api/ops/security-events/bindable-objects/')
        const first = (await call('GET', `${base}/`)).payload as EventShape
        const other = (objects.payload as { results: { id: string }[] }).results.find(
          (row) => row.id !== first.visitObjects[0]?.objectId,
        )
        const added = await call('POST', `${base}/visit-objects/`, { objectId: other?.id })

        // Обе стадии — на «Согласование»: обход цепочки адресата не имеет и
        // двигает объекты все.
        const onApproval = await call('POST', `${base}/stage/`, { stage: 'APPROVAL' })
        const visits = (onApproval.payload as EventShape).visitObjects

        // Возврат ОДНОГО объекта (`[ВОЗ-03]`) — ИМЕННО ВТОРОГО, и это не
        // случайность: у первого «наименьшая стадия среди объектов» и «стадия
        // первого объекта» совпадают, и проба не отличила бы правило от
        // подмены (проверено мутацией — на возврате первого она оставалась
        // зелёной).
        const returned = await call('POST', `${base}/approval/return/`, {
          comment: 'проба возврата одного объекта',
          visitObjectId: visits[1]!.id,
        })

        // Гвард отправки: возвращённому — отказ, соседу — нет.
        const sendReturned = await call('POST', `${base}/approval/send/`, {
          visitObjectId: visits[1]!.id,
        })
        const sendNeighbour = await call('POST', `${base}/approval/send/`, {
          visitObjectId: visits[0]!.id,
        })

        // 🔴 ВТОРАЯ ПОЛОВИНА ПРАВИЛА (дописано ревью №792): стадию двигают
        // ОБЪЕКТЫ, а поле мероприятия — вывод. Ручки, писавшие `event.stage`
        // напрямую, этот вывод немедленно затирал обратно, и цепочка мока не
        // шла дальше «Ознакомления» ВООБЩЕ: `CONDUCT` — единственный вход в
        // журнал штаба, закрытие объекта и закрытие ОМ.
        // Берём именно завершение ознакомления: у него нет адресата, и потому
        // он проверяет ровно эту болезнь, не требуя расстановки и маршрута
        // (у согласования свои правила — `PLACEMENT_EMPTY`, `APPROVAL_*`, — и
        // обходить их подменой значило бы проверять не то).
        await call('POST', `${base}/stage/`, { stage: 'ACKNOWLEDGEMENT' })
        const conducted = await call('POST', `${base}/acknowledgement/complete/`, {})
        return {
          conductedStatus: conducted.status,
          conductedEvent: conducted.payload as EventShape,
          addedStatus: added.status,
          addedCount: (added.payload as EventShape).visitObjects.length,
          onApprovalStages: visits.map((visit) => visit.stage),
          returnedStatus: returned.status,
          returnedEvent: returned.payload as EventShape,
          sendReturnedStatus: sendReturned.status,
          sendReturnedCode: (sendReturned.payload as { error_code?: string }).error_code ?? '',
          sendNeighbourStatus: sendNeighbour.status,
          sendNeighbourCode: (sendNeighbour.payload as { error_code?: string }).error_code ?? '',
        }
      })

      // Второй объект заведён — иначе всё дальнейшее проверяло бы ОМ с одним.
      expect(result.addedStatus, JSON.stringify(result)).toBe(200)
      expect(result.addedCount).toBe(2)
      expect(result.onApprovalStages).toEqual(['APPROVAL', 'APPROVAL'])

      // 🔴 ВОЗВРАТ ОДНОГО ОБЪЕКТА РОНЯЕТ ЭТАП МЕРОПРИЯТИЯ, А СОСЕДА НЕ ТРОГАЕТ.
      expect(result.returnedStatus, JSON.stringify(result.returnedEvent)).toBe(200)
      const stages = result.returnedEvent.visitObjects.map((visit) => visit.stage)
      expect(stages).toEqual(['APPROVAL', 'PLACEMENT'])
      // Этап ОМ — наименьший среди объектов, а не «как у первого» и не «как
      // было»: ровно правило `[МД-04]`.
      expect(result.returnedEvent.stage).toBe('PLACEMENT')

      // 🔴 ГВАРД СПРАШИВАЕТ СТАДИЮ ОБЪЕКТА. Возвращённому отправлять нечего;
      // соседа, стоящего на согласовании, тот же гвард пропускает — при
      // старой формуле (`event.stage`) он отказал бы обоим, потому что этап
      // МЕРОПРИЯТИЯ упал вместе с первым.
      expect(result.sendReturnedStatus).toBe(422)
      expect(result.sendReturnedCode).toBe('INVALID_STAGE_TRANSITION')
      // Соседа тот же гвард ПРОПУСКАЕТ. Проверяется именно это, а не «200»:
      // дальше по обработчику есть свои правила (пустой маршрут и прочее),
      // и требовать успеха значило бы стеречь не свой предмет. При старой
      // формуле (`event.stage`) сосед получил бы ровно тот же
      // INVALID_STAGE_TRANSITION, потому что этап МЕРОПРИЯТИЯ упал вместе с
      // первым объектом.
      expect(result.sendNeighbourCode, JSON.stringify(result)).not.toBe(
        'INVALID_STAGE_TRANSITION',
      )

      // 🔴 МЕРОПРИЯТИЕ ЖДЁТ ПОСЛЕДНЕГО. Согласован один объект из двух: он
      // ушёл на «Ознакомление», сосед остался на «Расстановке» (его вернули),
      // и этап ОМ обязан остаться наименьшим — «Расстановкой». Мутация,
      // которую это стережёт: писать `stage: "ACKNOWLEDGEMENT"` полем
      // мероприятия вместо `advanceVisits` — тогда ответ уходит со стадией,
      // которой не бывает, а на следующей ручке цепочка встаёт совсем.
      expect(result.conductedStatus, JSON.stringify(result.conductedEvent)).toBe(200)
      const afterConduct = result.conductedEvent.visitObjects.map((visit) => visit.stage)
      expect(afterConduct, JSON.stringify(result.conductedEvent)).toEqual([
        'CONDUCT',
        'CONDUCT',
      ])
      // Мутация, которую это стережёт: писать `stage: "CONDUCT"` полем
      // мероприятия вместо `advanceVisits` — объекты останутся на
      // «Ознакомлении», вывод вернёт мероприятие туда же, и ответ уйдёт со
      // стадией `ACKNOWLEDGEMENT`.
      expect(result.conductedEvent.stage).toBe('CONDUCT')
    })
  },
)
