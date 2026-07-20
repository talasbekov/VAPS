// Story 10.6 (QA-добор, workflow qa-generate-e2e-tests) — e2e-харнес
// amendment-флоу поверх НАСТОЯЩЕГО экрана сдачи.
//
// Что этот вход закрывает и чего не мог закрыть ни один из 45 jsdom-тестов
// стори: до него amendment-флоу не исполнялся в браузере НИ РАЗУ. Вход в флоу
// гейтится `hasPermission('daily_report.correct')`, право приходит запросом
// `['me']`, а тот гейтится `enabled: credential !== null` — ни один
// e2e-харнес credential не ставит (ловушка №0 спеки 10.6). Значит в
// dist-e2e кнопка «Исправить сдачу» физически не могла появиться, и весь флоу
// жил на имитации: jsdom-табуляция, jsdom-«disabled», jsdom-implicit-submission.
//
// Здесь монтируется тот же `DailyUpdatePage`, что в приложении, — не панель в
// вакууме. Это существенно: `handleKeyDownCapture` (DailyUpdatePage.tsx:380)
// висит на КОРНЕВОМ div экрана и перехватывает Ctrl+Enter в capture-фазе,
// то есть накрывает и форму исправления. Панельные тесты рендерят панель
// одну и этого взаимодействия не видят по построению (класс «компонент
// в вакууме» — QA 11.4).
//
// Сеть НЕ мокается здесь: её перехватывает page.route спеки — настоящий fetch,
// настоящие статусы, настоящий разбор конверта §36 боевым parseErrorResponse.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'

import { DailyUpdatePage } from '../src/features/daily-grid/DailyUpdatePage'
import { setCredential } from '../src/shared/auth/credential'
import { ToastProvider } from '../src/shared/ui/toast'
import '../src/index.css'

// ДО рендера: `useMe` читает credential через useSyncExternalStore, и без него
// запрос прав не уходит вовсе. Список прав отдаёт спека (page.route) — харнес
// решает только «актор представлен», а не «что ему можно».
setCredential({ kind: 'dev', userId: 'operator-1' })

// Дефолты — КАК В ПРИЛОЖЕНИИ (app/providers.tsx:38): `retry: false` только у
// мутаций, у запросов политика дефолтная. Прописать здесь `queries: { retry:
// false }` значило бы замаскировать потерю прод-настройки, которой в прод-коде
// и нет (урок харнеса 11.4). Спеки это не замедляет: все GET застабены.
const queryClient = new QueryClient({
  defaultOptions: { mutations: { retry: false } },
})

createRoot(document.getElementById('root')!).render(
  // Без StrictMode: двойной монтаж удвоил бы запросы, и ассерт «ровно один
  // POST» перестал бы значить то, что значит в приложении.
  <QueryClientProvider client={queryClient}>
    <ToastProvider>
      <DailyUpdatePage />
    </ToastProvider>
  </QueryClientProvider>,
)
