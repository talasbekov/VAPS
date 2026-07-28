/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
// Расширение .ts ОБЯЗАТЕЛЬНО (module: nodenext): без него `tsc -b` падает
// TS2835 и гейт умирает до тестов. Стори 10.9 — шов версии, см. шапку файла.
import { buildDefine } from './scripts/build-constants.ts'

// Контурная донастройка (стори 8.1):
// - build.target firefox100 — целевой браузер закрытого контура
// - dev-прокси /api и /ws на Django; цель переопределяется env VITE_PROXY_TARGET
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_PROXY_TARGET || 'http://localhost:8000'
  // Удалённый таргет (двухмашинный сетап) требует Host из ALLOWED_HOSTS Django,
  // иначе 400 DisallowedHost; локальному Django оставляем canon-поведение (false).
  const changeOrigin = !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(
    proxyTarget,
  )

  return {
    plugins: [react()],
    build: {
      target: 'firefox100',
    },
    // Стори 10.9: версия и sha доезжают до бандла build-time (рантайм-чтения
    // манифеста нет — fetch/XHR вне shared/api забанен). ТОТ ЖЕ вызов стоит в
    // vite.e2e.config.ts — дублировать значения запрещено, источник один.
    // Действует и в vitest (тест-конфиг ниже) — поэтому чистые функции
    // shared/version.ts берут значения аргументами, а не читают константы.
    define: buildDefine(),
    // Стори 8.4: тестовый фундамент фронта. environment node — fetch нативный,
    // MSW перехватывает на уровне node. Стори 8.5: компонентные .test.tsx берут
    // jsdom per-file docblock `// @vitest-environment jsdom` (Д7: vitest 4 удалил
    // environmentMatchGlobs; node-тесты 8.4 не трогаются)
    test: {
      environment: 'node',
      // только src: scripts/*.test.mjs — самостоятельные node-скрипты gate-цепочки,
      // не vitest-тесты (исполняются своими шагами gate)
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['./src/shared/api/testing/vitest.setup.ts'],
    },
    server: {
      allowedHosts: ['.ngrok-free.dev'],
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin,
        },
        '/ws': {
          target: proxyTarget,
          ws: true,
          changeOrigin,
        },
      },
    },
  }
})
