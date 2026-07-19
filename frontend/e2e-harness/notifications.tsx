// Story 11.4 (QA-добор, workflow qa-generate-e2e-tests) — e2e-харнес ЦЕНТРА
// УВЕДОМЛЕНИЙ.
//
// Монтируется НАСТОЯЩИЙ AppLayout, а не голый NotificationBell, и это главное
// решение харнеса. Причина — красная проба QA: колокольчик можно ЦЕЛИКОМ
// выдернуть из шапки, заменив мёртвой кнопкой с тем же aria-label, и все 527
// vitest-тестов останутся зелёными (NotificationBell.test.tsx судит компонент в
// изоляции, а три app-теста проверяют лишь «кнопка не disabled»). Task 3 стори
// («врезка в шапку») не был покрыт ничем. Здесь он покрыт по построению.
//
// Побочно AppLayout приносит ConnectionIndicator — ВЛАДЕЛЬЦА жизненного цикла
// транспорта (AC-6). Значит сокет в этом харнесе открывает продовый код, а не
// тест: `new WebSocket(...)` из notificationsSocket.ts исполняется здесь
// ПЕРВЫЙ И ЕДИНСТВЕННЫЙ раз во всём проекте — общий vitest.setup.ts подменяет
// фабрику инертной для ВСЕХ юнит-тестов, поэтому боевая ветка до сих пор не
// исполнялась ни разу.
//
// StrictMode НЕ ставим (как в харнесах 9.9/10.3/10.4): двойной монтаж открыл бы
// сокет дважды и удвоил запросы, а спека считает и то и другое.
//
// 🔴 QueryClient — С ДЕФОЛТАМИ, retry НЕ переопределяется. Это осознанно
// сильнее, чем в харнесе 10.4: `retry: false` для ленты уведомлений — предмет
// Решения №4 стори и живёт В САМОМ ХУКЕ. Прописав retry:false здесь, харнес
// замаскировал бы его потерю; с дефолтами спека вправе ассертить «ушёл РОВНО
// один запрос», и утрата retry:false в хуке даст четыре — тест покраснеет.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'

import { AuthProvider } from '../src/shared/auth/AuthContext'
import { setCredential } from '../src/shared/auth/credential'
import { AppLayout } from '../src/shared/ui/AppLayout'
import '../src/index.css'

// ASCII в credential: значение уходит заголовком X-User-Id и параметром
// user_id в URL сокета (кириллица там отклоняется ещё до сети — находка 11.3).
setCredential({ kind: 'dev', userId: 'operator-42' })

const queryClient = new QueryClient()

/**
 * Рабочая область под шапкой. Существует ради ОДНОГО ассерта: панель обязана
 * ПЕРЕКРЫВАТЬ контент, а не раздвигать его. Нужен непрозрачный высокий блок,
 * в который панель может «провалиться».
 *
 * Стили ИНЛАЙНОВЫЕ, а не Tailwind-классами: content-глоб конфига — только
 * ['./index.html', './src/**'], харнес JIT-сканером не читается вовсе, и любой
 * класс отсюда молча не доехал бы до CSS. Побочная выгода: всё, что спека
 * проверяет вычисленным стилем, приходит из src — то есть из прод-кода.
 */
function HarnessBody() {
  return (
    <div
      data-testid="harness-body"
      style={{
        height: '2000px',
        background: '#0f172a',
        color: '#f8fafc',
        padding: '16px',
      }}
    >
      Рабочая область экрана
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    {/* AuthProvider обязан жить ВНУТРИ QueryClientProvider (Ловушка 9 8.6) */}
    <AuthProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<HarnessBody />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  </QueryClientProvider>,
)
