'use client'
// Мост host-переноса: Smart Josparlau SPA (Vite-происхождение) как клиентский
// под-app Next на «/ops». ВАЖНО: env-глобал обязан существовать ДО импорта
// модулей SPA (basename/mode читаются на module-уровне), поэтому App и
// Providers импортируются динамически ИЗ bootstrap, а не статически —
// статические импорты hoisted и исполнились бы раньше установки env
// (пойман живым прогоном: SPA «сбегал» из /ops в корень host'а).
import { StrictMode, useEffect, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'

declare global {
  // eslint-disable-next-line no-var
  var __JOSPARLAU_ENV__: Record<string, unknown> | undefined
}

interface Loaded {
  App: ComponentType
  Providers: ComponentType<{ children: ReactNode }>
}

export default function JosparlauMount() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  useEffect(() => {
    let cancelled = false
    async function bootstrap() {
      globalThis.__JOSPARLAU_ENV__ = {
        MODE: 'mock',
        BASENAME: '/ops',
        VITE_DATA_SOURCE: 'mock',
        VITE_ENABLE_DEMO_TOOLS: 'true',
      }
      // Worker и сид — ДО первого рендера SPA (§8.1: иначе первые queries
      // уходят в сеть до перехвата).
      const [{ startMockWorker }, { ensureSeeded }] = await Promise.all([
        import('./src/app/mocks/browser'),
        import('./src/app/mocks/demo-runtime'),
      ])
      await ensureSeeded()
      await startMockWorker()
      const [appModule, providersModule] = await Promise.all([
        import('./src/app/App'),
        import('./src/app/providers'),
      ])
      if (!cancelled) {
        setLoaded({ App: appModule.default, Providers: providersModule.Providers })
      }
    }
    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [])
  if (loaded === null) {
    return <p className="p-6 text-sm text-muted-foreground">Загрузка Smart Josparlau…</p>
  }
  const { App, Providers } = loaded
  return (
    <StrictMode>
      <Providers>
        <App />
      </Providers>
    </StrictMode>
  )
}
