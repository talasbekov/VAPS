// setupWorker bootstrap (§8.1). Импортируется ТОЛЬКО динамически из main.tsx
// при VITE_DATA_SOURCE=mock — реальный API-режим не должен тянуть MSW/mock-код
// в обязательный startup chunk.
import { setupWorker } from 'msw/browser'
import { registerRbacDirectory } from '../../shared/testing/mock-runtime/rbac-directory'
import { composeHandlers } from './compose-handlers'
import { DEMO_PERSONAS } from './demo-personas'

// Promise, а не флаг: два ПАРАЛЛЕЛЬНЫХ вызова (StrictMode-эффект host-моста)
// проходили гонкой мимо булевого guard'а и поднимали ДВА инстанса worker'а —
// каждый исполнял handler, мутация писалась дважды (Этап M2).
let startPromise: Promise<void> | null = null

/**
 * Запускает MSW worker и ждёт его готовности ПЕРЕД монтированием React —
 * иначе первые queries уходят в сеть до перехвата (§8.1 «это предотвращает
 * гонку»). Идемпотентно: повторный вызов (HMR) не плодит вторую регистрацию.
 */
export function startMockWorker(): Promise<void> {
  if (startPromise !== null) return startPromise
  startPromise = start()
  return startPromise
}

// Пространства API, которые принадлежат ЭТОМУ приложению. Неперехваченный
// запрос сюда — почти всегда опечатка в пути handler'а, и она обязана падать
// громко: молча ушедший в сеть запрос выглядит как «бэк не ответил».
//
// `/api/notifications/` и `/api/audit/` в список НЕ ВКЛЮЧЕНЫ, хотя handler'ы у
// SPA на них есть. Причина — не недосмотр: этими же префиксами пользуется хост
// (колокол PersonalRecordFront ходит в `/api/notifications/notifications/
// unread/`), и «падать громко» на них значило бы ломать его страницы ровно так
// же, как ломался NextAuth. Пока пространство общее, оно чужое.
const OWN_API_PREFIXES = [
  '/api/ops/',
  '/api/operations/',
  '/api/core/',
  '/api/documents/',
]

async function start(): Promise<void> {
  // Регистрация ОДИН раз до первого перехваченного запроса: feature-хендлеры
  // (не могут импортировать app/mocks/demo-personas, ARCH-FE-013) проверяют
  // права через shared/testing/mock-runtime/rbac-directory.
  registerRbacDirectory(DEMO_PERSONAS.map((p) => ({ userId: p.userId, permissions: p.permissions })))
  const worker = setupWorker(...composeHandlers())
  await worker.start({
    // СТРАТЕГИЯ ЗАВИСИТ ОТ ПУТИ, и это следствие врезки в хост (Этап M4).
    //
    // Пока SPA жила одна на своём origin, 'error' был верен целиком: всё, что
    // не перехвачено, — её собственная опечатка. Внутри PersonalRecordFront на
    // том же origin живут запросы ХОЗЯИНА, и scope воркера («/») накрывает их
    // тоже. MSW при 'error' не просто ругается — он ОТВЕЧАЕТ ошибкой: сессия
    // NextAuth (`/api/auth/session`) на каждой странице /ops получала 500
    // «Cannot bypass a request when using the "error" strategy». Поймано живым
    // прогоном стенда.
    //
    // Поэтому громко падаем только на СВОИХ пространствах, чужое пропускаем в
    // сеть. Цена пропуска записана честно: опечатка в пути чужого пространства
    // уйдёт в сеть молча — её ловить сетевой вкладкой, как и у host-MSW.
    //
    // Файл ОДИН на оба режима (josparlau/src генерируется синком из
    // frontend/src), поэтому правило действует и в автономной SPA, где хоста
    // нет. Там оно строго слабее прежнего: запрос в общее пространство
    // (`/api/notifications/`, `/api/audit/`) больше не падает громко. Разводить
    // поведение по режимам не стал — два разных правила в одном синкаемом файле
    // разъезжаются на первой же правке, а цена расхождения выше цены потери.
    onUnhandledRequest: (request, print) => {
      const { pathname } = new URL(request.url)
      if (OWN_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
        print.error()
        return
      }
      // Явного bypass здесь НЕТ: при стратегии-функции достаточно ничего не
      // сделать — запрос уходит в сеть сам.
    },
    serviceWorker: { url: '/mockServiceWorker.js' },
  })
}
