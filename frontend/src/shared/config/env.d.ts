// Ambient-типы Vite env (§8.1 мастер-промпта Smart Josparlau). Файл живёт в
// shared/config (не в корне src) — иначе boundaries/no-unknown-files (ARCH-FE-013)
// красит файл вне app/features/shared. Значения — публичные (Vite инлайнит
// VITE_*-переменные в бандл), секретов здесь быть не может по определению Vite.
interface ImportMetaEnv {
  readonly VITE_DATA_SOURCE?: string
  readonly VITE_API_BASE_URL?: string
  readonly VITE_DEMO_SCENARIO?: string
  readonly VITE_DEMO_PERSONA?: string
  readonly VITE_DEMO_FAULT_PROFILE?: string
  readonly VITE_ENABLE_DEMO_TOOLS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
