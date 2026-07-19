// Story 9.9 — ОТДЕЛЬНАЯ сборка e2e-харнеса грида (Ловушка №3): прод-dist/
// байт-в-байт нетронут (size-gate суммирует ВСЕ JS в dist/, а грид сейчас
// тришейкнут из прод-бандла — второй вход в той же сборке втащил бы его в
// бюджет). Вход — e2e-harness/index.html, выход — dist-e2e/ (в .gitignore).
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// fileURLToPath, не URL.pathname — путь репо содержит кириллицу (ловушка 7 из 8.8)
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'firefox100',
    outDir: 'dist-e2e',
    rollupOptions: {
      // Два входа одной сборки: грид 9.9 и экран сдачи дня 10.3 (QA-добор).
      // Общий чанк react/react-dom делится между ними — прод-dist по-прежнему
      // не задет, size-gate суммирует только dist/.
      input: {
        grid: fileURLToPath(new URL('./e2e-harness/index.html', import.meta.url)),
        daySubmission: fileURLToPath(
          new URL('./e2e-harness/day-submission.html', import.meta.url),
        ),
      },
    },
  },
  preview: {
    port: 4174,
    strictPort: true,
  },
})
