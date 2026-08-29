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
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

export async function prepareDemandEvent(
  token: string,
  businessDate = '2026-08-26',
): Promise<{ code: string; total: number }> {
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const call = async (method: string, path: string, body?: unknown): Promise<any> => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return res.json().catch(() => ({}))
  }
  const objects = await call('GET', '/api/ops/security-events/bindable-objects/')
  const object = objects.results.find(
    (item: { publishedVersionCount: number }) => item.publishedVersionCount > 0,
  )
  if (object === undefined) throw new Error('на стенде нет объекта с паспортом')

  const created = await call('POST', '/api/ops/security-events/', {
    title: 'Проба раскладки сил (e2e)',
    objectId: object.id,
    businessDate,
    kind: 'INTERNAL',
  })
  const base = `/api/ops/security-events/${created.id}`
  await call('PATCH', `${base}/bulletin/`, {
    briefDescription: 'Проба раскладки.',
    initialTasks: '—',
  })
  await call('POST', `${base}/bulletin/complete/`)
  await call('POST', `${base}/recon/import-from-passport/`)
  const afterImport = await call('GET', `${base}/`)
  const posts = afterImport.reconSectorPosts.map(
    (post: Record<string, unknown>, index: number) =>
      index === 0 ? { ...post, need: 4 } : post,
  )
  await call('PATCH', `${base}/recon/`, {
    checklist: afterImport.reconChecklist.map((item: Record<string, unknown>) => ({
      ...item,
      done: true,
      result: 'MATCHES',
    })),
    sectorPosts: posts,
  })
  const demand = await call('POST', `${base}/recon/complete/`)
  return { code: demand.code, total: demand.forceDemandTotal }
}
