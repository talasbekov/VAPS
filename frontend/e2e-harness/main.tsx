// Story 9.9 — e2e-харнес грида слепого ввода. ОТДЕЛЬНАЯ Vite-сборка (dist-e2e,
// Ловушка №3: прод-dist и size-gate нетронуты). Роут в App НЕ добавляется
// (10.2). Счёт коммитов — DevTools-hook в index.html (Ловушка №1).
import { createRoot } from 'react-dom/client'

import { ConflictError } from '../src/shared/api/errors'
import { DailyGridContainer } from '../src/features/daily-grid/DailyGridContainer'
import type {
  BulkStatusRequest,
  EmployeeSeed,
} from '../src/features/daily-grid/prefill'
import '../src/index.css'

declare global {
  interface Window {
    __e2e: {
      commits: number
      keys: number
      maxCommitsPerKey: number
      lastCommitsPerKey: number
      samples: number[]
      lastBulkRequest: BulkStatusRequest | null
    }
  }
}

export const BUSINESS_DATE = '2026-07-14'

// Кириллические лейблы с РАЗНЫМИ префиксами (в/н/о/к) — type-ahead матчится
// toLocaleLowerCase('ru'), латиница молча не матчится (Ловушка №4, ревью 9.8).
// Prefill = IN_SERVICE (yesterday пуст) → любые сиды н/о/к дают dirty-строку.
const STATUS_OPTIONS = [
  { code: 'IN_SERVICE', label: 'В строю' },
  { code: 'SICK_LEAVE', label: 'На больничном' },
  { code: 'VACATION', label: 'Отпуск' },
  { code: 'COMMAND', label: 'Командировка' },
]

const EMPLOYEES: EmployeeSeed[] = Array.from({ length: 500 }, (_, i) => ({
  id: `e${i}`,
  fullName: `Сотрудник ${i}`,
}))

createRoot(document.getElementById('root')!).render(
  // Без StrictMode: харнес считает коммиты 1:1 как их увидит реальный экран —
  // никакой обёртки, способной добавить телодвижений рендеру.
  <DailyGridContainer
    employees={EMPLOYEES}
    yesterday={{}}
    businessDate={BUSINESS_DATE}
    statusOptions={STATUS_OPTIONS}
    onBulkSubmit={(request) => {
      window.__e2e.lastBulkRequest = request
    }}
    // Конфликт-фикстура (Д5): строка e42 — ВНЕ слепой серии AC1 (строки
    // 0-19, ревью-C4), код из OVERRIDABLE_CODES → overridable=true → soft.
    onCellCommit={(change) =>
      change.id === 'e42'
        ? new ConflictError({
            status: 409,
            errorCode: 'SOFT_CONFLICT_DETECTED',
            message: 'Пересечение со сменой (e2e-фикстура харнеса)',
            details: {},
            requestId: null,
          })
        : null
    }
  />,
)
