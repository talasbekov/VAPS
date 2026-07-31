// Чтение ЧУЖОГО слайса `security-events` из общего demo-снапшота (§8.4) —
// узкая проекция (ARCH-FE-013 запрещает импорт из features/security-events).
//
// Единственный вопрос проекции — «закрыто ли мероприятие»: §19.23 запрещает
// изменять закрытое мероприятие и архивный снимок обычной rating mutation.
// Стадии, названия и состав мероприятия рейтингу не принадлежат и не читаются.

export const SECURITY_EVENTS_SLICE_NAME = 'security-events'

export interface SecurityEventClosureProjection {
  closed: boolean
  closedAt: string | null
}

interface EventProjection {
  id?: unknown
  stage?: unknown
  closedAt?: unknown
}

/**
 * `null` — мероприятия с таким id в реестре ОМ НЕТ. Это штатный случай, а не
 * ошибка: исторические задания demo-сида принадлежат мероприятиям вне реестра
 * (у них нет карточки ОМ), и замок §19.23 к ним неприменим — закрытым может
 * быть только то, что существует. Отказывать по отсутствию значило бы
 * заблокировать всё оценивание сида.
 */
export function readSecurityEventClosure(
  slices: Readonly<Record<string, unknown>>,
  securityEventId: string,
): SecurityEventClosureProjection | null {
  const slice = slices[SECURITY_EVENTS_SLICE_NAME]
  if (slice === undefined || slice === null || typeof slice !== 'object') return null
  const events = (slice as { events?: unknown }).events
  if (!Array.isArray(events)) return null
  for (const item of events as EventProjection[]) {
    if (item.id !== securityEventId) continue
    return {
      closed: item.stage === 'CLOSED',
      closedAt: typeof item.closedAt === 'string' ? item.closedAt : null,
    }
  }
  return null
}
