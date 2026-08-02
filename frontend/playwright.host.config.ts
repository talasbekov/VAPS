// Host-перенос (Этап M2): ТЕ ЖЕ e2e-mock спеки против Smart Josparlau,
// смонтированного внутри PersonalRecordFront (Next, /ops). Прогон доказывает
// эквивалентность моста живому Vite-фронту — сами спеки не меняются.
//
// Хост гоняется ПРОД-сборкой (next build && next start): dev-оверлей Next
// несёт собственный role=alert («Issues badge») и медленную компиляцию —
// ложные падения среды, не приложения (тот же принцип, что preview:mock
// вместо vite dev в playwright.mock.config.ts).
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const HOST_DIR = fileURLToPath(
  new URL('../Backend/PersonnelStatus/PersonalRecordFront', import.meta.url),
)

export default defineConfig({
  testDir: fileURLToPath(new URL('./e2e-mock', import.meta.url)),
  workers: 1,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  use: {
    // Прокси 3108 префиксует /ops ко всем не-ассетным путям (e2e-host/ops-proxy.mjs).
    baseURL: 'http://localhost:3108',
    viewport: { width: 1600, height: 1000 },
  },
  webServer: [
    {
      command: `cd "${HOST_DIR}" && npx next build --no-lint && npx next start -p 3107`,
      url: 'http://localhost:3107/ops/',
      reuseExistingServer: false,
      timeout: 300_000,
    },
    {
      command: 'node e2e-host/ops-proxy.mjs',
      url: 'http://localhost:3108/ops/',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
})
