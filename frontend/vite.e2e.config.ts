// Story 9.9 — ОТДЕЛЬНАЯ сборка e2e-харнеса грида (Ловушка №3): прод-dist/
// байт-в-байт нетронут (size-gate суммирует ВСЕ JS в dist/, а грид сейчас
// тришейкнут из прод-бандла — второй вход в той же сборке втащил бы его в
// бюджет). Вход — e2e-harness/index.html, выход — dist-e2e/ (в .gitignore).
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// Расширение .ts ОБЯЗАТЕЛЬНО (module: nodenext) — иначе TS2835 на `tsc -b`.
import { buildDefine } from './scripts/build-constants.ts'

// fileURLToPath, не URL.pathname — путь репо содержит кириллицу (ловушка 7 из 8.8)
export default defineConfig({
  plugins: [react()],
  // 🔴 Стори 10.9: ТОТ ЖЕ define, что в vite.config.ts — и это не копия ради
  // симметрии. Харнес notifications.tsx монтирует НАСТОЯЩИЙ AppLayout, а в
  // футере каркаса живёт __APP_VERSION__. Забыть здесь define = собрать харнес,
  // падающий ReferenceError при монтировании, причём ЗЕЛЁНЫМИ останутся и
  // `npm run gate` (build:e2e в цепочку не входит), и сам `npm run build:e2e`
  // (vite не считает необъявленный идентификатор ошибкой — выходит с кодом 0
  // и оставляет голый идентификатор в бандле). Единственный детектор —
  // Playwright: playwright.config.ts:32 пересобирает харнес на КАЖДОМ прогоне
  // (reuseExistingServer: false) и сразу открывает его в браузере.
  define: buildDefine(),
  build: {
    target: 'firefox100',
    outDir: 'dist-e2e',
    rollupOptions: {
      // Семь входов одной сборки: грид 9.9, экран сдачи дня 10.3,
      // светофор-дерево 10.4, центр уведомлений 11.4, экран расхода 10.5,
      // исправление сдачи 10.6 (пять последних — QA-добор) и цепочка сдачи
      // целиком 10.10. Общий чанк react/react-dom делится между ними —
      // прод-dist по-прежнему не задет, size-gate суммирует только dist/.
      input: {
        grid: fileURLToPath(new URL('./e2e-harness/index.html', import.meta.url)),
        daySubmission: fileURLToPath(
          new URL('./e2e-harness/day-submission.html', import.meta.url),
        ),
        // 10.6: отдельный вход, а не правка day-submission — тот харнес
        // намеренно без credential (см. шапку day-amendment.tsx).
        dayAmendment: fileURLToPath(
          new URL('./e2e-harness/day-amendment.html', import.meta.url),
        ),
        trafficLight: fileURLToPath(
          new URL('./e2e-harness/traffic-light.html', import.meta.url),
        ),
        notifications: fileURLToPath(
          new URL('./e2e-harness/notifications.html', import.meta.url),
        ),
        expense: fileURLToPath(
          new URL('./e2e-harness/expense.html', import.meta.url),
        ),
        // 10.10: ЕДИНСТВЕННЫЙ вход против живого бэкенда. Отдельный, а не
        // правка `expense` — тот захардкожен на ROUTES.reports и чужой
        // userId, и от него зависит мокнутая e2e/expense.spec.ts.
        chain: fileURLToPath(new URL('./e2e-harness/chain.html', import.meta.url)),
        // 14.12b: полный цикл плана дежурств. Монтирует НАСТОЯЩИЙ AppRoutes
        // (не отдельную страницу, как day-submission/traffic-light) — цикл
        // сам по себе многостраничный (/duty-plans → /duty-plans/:id),
        // нужна реальная навигация через <Link>, не голый компонент.
        dutyPlan: fileURLToPath(new URL('./e2e-harness/duty-plan.html', import.meta.url)),
        // 16.8i: полный интерактивный цикл Расстановки — тот же приём, что
        // dutyPlan (настоящий AppRoutes, многостраничная навигация).
        placement: fileURLToPath(new URL('./e2e-harness/placement.html', import.meta.url)),
      },
    },
  },
  preview: {
    port: 4174,
    strictPort: true,
    // Story 11.6 — SAME-ORIGIN для live-сьюта (`npm run test:e2e:live`).
    //
    // Почему прокси, а не абсолютный URL бэкенда в коде фронта: apiClient ходит
    // по baseUrl = '' (client.ts:67), то есть same-origin, а buildSocketUrl
    // собирает адрес из location.host (notificationsSocket.ts:145-152) —
    // литерального хоста в прод-коде нет и быть не может: size-gate.mjs:88-93
    // безусловно валит бандл на схемах ws:/wss:. Единственный способ свести
    // браузер с uvicorn — сделать их одним origin.
    //
    // Для 35 спек `npm run test:e2e` прокси ИНЕРТЕН: они перехватывают сеть на
    // уровне браузера (page.route/routeWebSocket), до прокси запрос не доходит.
    // Форма — зеркало dev-прокси vite.config.ts:33-45.
    proxy: {
      '/api': {
        target: 'http://localhost:8001',
      },
      '/ws': {
        target: 'http://localhost:8001',
        // 🔴 Без ws:true апгрейд не проксируется: /ws/... уедет обычным HTTP,
        // сокет не откроется, а UI будет выглядеть «почти работающим» —
        // лента-то грузится по REST.
        ws: true,
      },
    },
  },
})
