// Story 10.4 (QA-добор, workflow qa-generate-e2e-tests) — e2e-харнес ЭКРАНА
// светофор-дерева.
//
// Зачем третий вход, а не правка соседних: харнес 9.9 считает React-коммиты и
// его спека завязана на этот счётчик; харнес 10.3 монтирует экран сдачи с
// ToastProvider. Дописать светофор в любой из них значило бы менять предмет
// чужой спеки. Третий вход той же сборки dist-e2e прод-бандл и size-gate не
// задевает (Ловушка №3 стори 9.9).
//
// Монтируется НАСТОЯЩИЙ TrafficLightTreePage — тот же компонент, что в
// приложении, с провайдером Query (features → app импортировать нельзя,
// ARCH-FE-013, поэтому обёртка локальная — тот же приём, что в renderPage()
// юнит-тестов).
//
// Сеть НЕ мокается здесь: её перехватывает page.route спеки — реальный fetch,
// реальный JSON, боевой parseTrafficLightTree у границы. Фикстуры живут в
// спеке, потому что каждый её тест кормит экран СВОИМ деревом (пять статусов /
// лестница вложенности / 400 узлов), а харнес обязан оставаться одним.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'

import { TrafficLightTreePage } from '../src/features/traffic-light/TrafficLightTreePage'
import '../src/index.css'

// retry: false — как в харнесе 10.3: иначе спека отказа ждала бы три бэкоффа
// (у query в проде остаётся дефолт retry: 3, ловушка №1b стори) и стала бы
// флейки по таймауту. Расписание ОПРОСА (refetchInterval) не трогаем — оно и
// есть предмет теста «фокус переживает перечитку».
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

createRoot(document.getElementById('root')!).render(
  // Без StrictMode: двойной монтаж удвоил бы запросы, и ассерт «раскрытие ветки
  // не шлёт НИ ОДНОГО запроса» (AC-4) перестал бы значить то, что значит.
  <QueryClientProvider client={queryClient}>
    <TrafficLightTreePage />
  </QueryClientProvider>,
)
