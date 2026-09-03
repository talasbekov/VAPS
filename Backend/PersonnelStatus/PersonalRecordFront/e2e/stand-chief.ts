/**
 * Старший объекта для фикстур (`[РЕК-02]`/`[РЕК-07]`, Plane №424): без него
 * сервер закрывает рекогносцировку — импорт постов, сохранение расчёта и
 * «Завершить» отвечают 422 `VISIT_CHIEF_REQUIRED`. Пробы, заводящие ОМ через
 * API, передают его в `chiefEmployeeId` при создании — старший бюллетеня
 * наследуется первым объектом посещения.
 */
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

export async function anyChiefId(token: string): Promise<string> {
  const res = await fetch(`${API}/api/ops/personnel/?page_size=1`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = (await res.json()) as { results?: { id: string | number }[] }
  const first = body.results?.[0]
  if (first === undefined) throw new Error('на стенде нет сотрудников — старшего объекта взять неоткуда')
  return String(first.id)
}
