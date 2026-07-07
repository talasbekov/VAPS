/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

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
    // Стори 8.4: тестовый фундамент фронта. environment node — fetch нативный,
    // MSW перехватывает на уровне node; jsdom/RTL придут с первым компонентом (8.5)
    test: {
      environment: 'node',
      // только src: scripts/*.test.mjs — самостоятельные node-скрипты gate-цепочки,
      // не vitest-тесты (исполняются своими шагами gate)
      include: ['src/**/*.test.ts'],
      setupFiles: ['./src/shared/api/testing/vitest.setup.ts'],
    },
    server: {
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
