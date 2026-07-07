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
