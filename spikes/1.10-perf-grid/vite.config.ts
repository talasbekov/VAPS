import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// СПАЙК 1.10. Один критический параметр:
//   build.target: 'firefox100' — ОБЯЗАТЕЛЬНО.
//   Дефолт Vite 7 таргетит Firefox >= 104; целевой клиент контура — Firefox ~100 (2022).
//   Без явного firefox100 esbuild может оставить синтаксис, который FF~100 не разберёт → белый экран.
//   Источник: architecture.md:231 («build.target:'firefox100' — ОБЯЗАТЕЛЬНО»).
// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'firefox100',
    // отчёт по размеру бандла (информационно — канон-бюджет ≤300КБ gzip, architecture.md:231)
    reportCompressedSize: true,
  },
})
