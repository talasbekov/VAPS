// Личный состав (мастер-промпт §20, Этап 4). Кадровые типы — ИЗ СХЕМЫ
// (ARCH-FE-011: рукописные типы при наличии схемы = MUST NOT), т.к.
// `/api/core/employees|divisions|positions|ranks/` — существующие
// (`existing`, не pending-contract) эндпоинты донора (Epic 1-13).
//
// §20.1: Smart Josparlau НЕ кадровая система — этот фичемодуль ТОЛЬКО читает
// (список/карточка), не создаёт/увольняет/переводит сотрудников. §20.3/20.4:
// оперативные Smart Josparlau данные (дежурства, участие в ОМ, назначения,
// рейтинг) — ОТДЕЛЬНЫЙ read model, здесь сознательно НЕ реализован (Not
// started, см. FRONTEND_DECISIONS) — не путать кадровое и оперативное.
import type { paths } from '../../../shared/api/schema'

export type Employee =
  paths['/api/core/employees/']['get']['responses']['200']['content']['application/json']['results'][number]
export type Division =
  paths['/api/core/divisions/']['get']['responses']['200']['content']['application/json']['results'][number]
export type Position =
  paths['/api/core/positions/']['get']['responses']['200']['content']['application/json']['results'][number]
export type Rank =
  paths['/api/core/ranks/']['get']['responses']['200']['content']['application/json']['results'][number]

export const EMPLOYMENT_STATUS_LABEL: Record<Employee['employment_status'] & string, string> = {
  WORKING: 'Работает',
  FIRED: 'Уволен',
  ARCHIVED: 'В архиве',
}
