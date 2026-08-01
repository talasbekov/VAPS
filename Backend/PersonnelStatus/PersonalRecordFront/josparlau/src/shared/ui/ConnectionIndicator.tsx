// Индикатор связи с сервером (стори 11.3): единственная видимая часть
// WS-клиента до центра уведомлений (11.4). Он же владеет жизненным циклом
// транспорта — start/stop в эффекте с обязательным cleanup.
//
// Статус берётся ТОЛЬКО из внешнего источника через useSyncExternalStore
// (образец usePermissions): локальной копии в useState нет — и ARCH-FE-010, и
// заодно нет риска react-hooks/set-state-in-effect, красного в гейте.
import { useEffect, useSyncExternalStore } from 'react'
import { WifiOff } from 'lucide-react'
import {
  getStatusSnapshot,
  startNotificationsSocket,
  stopNotificationsSocket,
  subscribeStatus,
} from '../notifications/notificationsSocket'

/** Текст видимый, не только цвет: цвет не может быть единственным сигналом
 *  (EXPERIENCE.md#L238). Экспорт — чтобы тест не дублировал строку. */
export const CONNECTION_LOST_TEXT = 'Нет связи с сервером'
/** Различающее accessible name: ToastProvider держит ПОСТОЯННЫЙ role="status" в
 *  DOM (toast.tsx:54) и смонтирован в Providers — голый getByRole('status') в
 *  app-тестах стал бы неоднозначным. */
export const CONNECTION_INDICATOR_LABEL = 'Состояние соединения'

export function ConnectionIndicator() {
  const status = useSyncExternalStore(
    subscribeStatus,
    getStatusSnapshot,
    getStatusSnapshot,
  )

  useEffect(() => {
    startNotificationsSocket()
    return () => {
      stopNotificationsSocket()
    }
  }, [])

  // `connecting` намеренно НЕ показывает индикатор: иначе «нет связи» мигало бы
  // на каждой загрузке страницы до первого open. Модалку не делаем — jsdom не
  // эмулирует модальность, ассерт был бы вакуумным (дефер 9.5/9.9/10.3).
  if (status !== 'reconnecting') return null

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={CONNECTION_INDICATOR_LABEL}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-destructive"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{CONNECTION_LOST_TEXT}</span>
    </div>
  )
}
