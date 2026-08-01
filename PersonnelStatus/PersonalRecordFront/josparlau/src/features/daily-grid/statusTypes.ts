// Story 10.2 — каталог статус-типов экрана массового обновления.
//
// ЗЕРКАЛО seed-каталога бэка: коды и русские подписи скопированы ДОСЛОВНО из
// Backend/VAPS/apps/operations/statuses/management/commands/seed_statuses.py:11-32
// (STATUS_TYPES, 17 типов) в том же порядке приоритета.
//
// Почему константа, а не сеть: GET-роута справочника статус-типов не существует
// (в schema.yaml только POST /api/operations/statuses/bulk/). Константа
// заменяется GET-справочником в стори 10.1b — точка подключения ровно здесь,
// экран не переписывается.
//
// Риск расхождения управляем: при дрейфе каталога бэк ответит ошибкой на
// неизвестный `status_type_code` (валидация сериализатора 10.1a) — отказ
// громкий, а не тихая запись мусора.
import type { StatusOption } from './DailyGrid.types'

export const STATUS_TYPE_OPTIONS: StatusOption[] = [
  { code: 'SICK_LEAVE', label: 'На больничном' },
  { code: 'LEAVE_BY_REPORT', label: 'Отпуск по рапорту' },
  { code: 'VACATION', label: 'В отпуске' },
  { code: 'COMMAND', label: 'В командировке' },
  { code: 'STUDY', label: 'Учёба' },
  { code: 'COMPETITION', label: 'Соревнования' },
  { code: 'CONFERENCE', label: 'Конференция' },
  { code: 'OTHER_ABSENCE', label: 'Иное отсутствие' },
  { code: 'DETACHED', label: 'Откомандирован' },
  { code: 'ATTACHED', label: 'Прикомандирован' },
  { code: 'REST_AFTER_DUTY', label: 'После дежурства' },
  { code: 'BEFORE_DUTY', label: 'Перед дежурством' },
  { code: 'DUTY', label: 'На дежурстве' },
  { code: 'GEV', label: 'Группа экстренного выезда' },
  { code: 'EVENT_ASSIGNMENT', label: 'Привлечён на мероприятие' },
  { code: 'PENDING_CLARIFICATION', label: 'Уточняется' },
  { code: 'IN_SERVICE', label: 'В строю' },
]
