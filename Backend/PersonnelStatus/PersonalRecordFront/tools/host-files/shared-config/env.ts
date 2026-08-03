// Bootstrap-конфигурация Smart Josparlau frontend-only режима (мастер-промпт
// §8.1). Единая точка чтения `import.meta.env` — остальной код читает
// `getFrontendEnv()`, а не `import.meta.env` напрямую (иначе неизвестное
// значение молча проходит вместо явной остановки запуска).
import { z } from 'zod'

const dataSourceSchema = z.enum(['mock', 'api'])
const faultProfileSchema = z.enum(['none', 'latency', 'flaky', 'offline'])

const envSchema = z.object({
  VITE_DATA_SOURCE: dataSourceSchema.default('api'),
  VITE_API_BASE_URL: z.string().default('/api'),
  VITE_DEMO_SCENARIO: z.string().default('normal'),
  VITE_DEMO_PERSONA: z.string().default('event_planner'),
  VITE_DEMO_FAULT_PROFILE: faultProfileSchema.default('none'),
  /** Host-встраивание (Этап M4): SPA живёт внутри чужого каркаса (сайдбар и
   * шапка host-приложения PersonalRecordFront) — свой chrome не рендерится. */
  VITE_EMBEDDED_CHROME: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  VITE_ENABLE_DEMO_TOOLS: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
})

export type FrontendEnv = {
  dataSource: z.infer<typeof dataSourceSchema>
  apiBaseUrl: string
  demoScenario: string
  demoPersona: string
  demoFaultProfile: z.infer<typeof faultProfileSchema>
  demoToolsEnabled: boolean
  embeddedChrome: boolean
}

let cached: FrontendEnv | null = null

/**
 * Валидирует `import.meta.env` при первом обращении. Неизвестное значение
 * (например `VITE_DATA_SOURCE=demo`) кидает исключение с понятным текстом —
 * тихий проход запрещён §8.1 («неизвестное значение останавливает запуск»).
 */
export function getFrontendEnv(): FrontendEnv {
  if (cached !== null) return cached
  // Host-мост (перенос в PersonalRecordFront/Next): источник env задаёт
  // страница-хост через глобал — import.meta.env здесь больше нет.
  const source =
    (globalThis as { __JOSPARLAU_ENV__?: Record<string, unknown> }).__JOSPARLAU_ENV__ ?? {}
  const parsed = envSchema.safeParse(source)
  if (!parsed.success) {
    throw new Error(
      `Некорректная конфигурация окружения Smart Josparlau: ${parsed.error.message}`,
    )
  }
  const v = parsed.data
  cached = {
    dataSource: v.VITE_DATA_SOURCE,
    apiBaseUrl: v.VITE_API_BASE_URL,
    demoScenario: v.VITE_DEMO_SCENARIO,
    demoPersona: v.VITE_DEMO_PERSONA,
    demoFaultProfile: v.VITE_DEMO_FAULT_PROFILE,
    demoToolsEnabled: v.VITE_ENABLE_DEMO_TOOLS,
    embeddedChrome: v.VITE_EMBEDDED_CHROME,
  }
  return cached
}

/** Только для тестов: сбрасывает кэш между сценариями с разным `import.meta.env`. */
export function resetFrontendEnvCache(): void {
  cached = null
}
