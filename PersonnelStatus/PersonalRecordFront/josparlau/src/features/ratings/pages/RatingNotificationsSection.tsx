// Уведомления раздела оценивания (§19.28).
//
// ТЕКСТ БЕРЁТСЯ ИЗ ФИКСИРОВАННОГО СЛОВАРЯ ПО КОДУ, а не приходит с сервера.
// §19.28 перечисляет допустимые формулировки и запрещает нести в уведомлении
// ФИО оценщика, персональный score, закрытый комментарий и причину снижения —
// подставлять в эти строки нечего, потому что подстановок в них нет вовсе.
//
// Ссылка ведёт на маршрут, который ПЕРЕПРОВЕРЯЕТ права (§19.28 «deep link
// повторно проверяет permissions и scope»): получатель без права увидит отказ,
// а не содержимое, — и это свойство маршрута, а не вежливость ссылки.
import { Link } from 'react-router'
import { useRatingNotifications } from '../api/queries'
import type { RatingNotificationCode } from '../model/types'

const NOTIFICATION_TEXT: Record<RatingNotificationCode, string> = {
  EVALUATION_AVAILABLE: 'Вам доступно итоговое оценивание мероприятия',
  EVALUATION_SUBMITTED: 'Оценивание успешно отправлено',
  EVALUATION_CORRECTED: 'Оценка была исправлена уполномоченным пользователем',
}

function dateTime(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('ru-RU')
}

export function RatingNotificationsSection() {
  const query = useRatingNotifications()
  const data = query.data
  if (data === undefined) return null

  return (
    <section className="mb-4 rounded-xl border bg-card p-4" aria-label="Уведомления оценивания">
      <h2 className="mb-2 text-sm font-semibold">Уведомления</h2>
      {data.results.length === 0 ? (
        <p className="text-xs text-muted-foreground">Уведомлений нет.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.results.map((item) => (
            <li key={item.id} className="text-xs">
              <Link className="underline" to={item.deepLink}>
                {NOTIFICATION_TEXT[item.code]}
              </Link>
              <span className="ml-2 text-muted-foreground">{dateTime(item.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
      <ul className="mt-3 flex flex-col gap-2">
        {data.unavailableViews.map((view) => (
          <li key={view.code} className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{view.label}. </span>
            {view.reason}
          </li>
        ))}
      </ul>
    </section>
  )
}
