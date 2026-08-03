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

// ОДИН bootstrap на модуль: StrictMode (dev) исполняет эффект дважды, и две
// параллельные инициализации проходили гонкой мимо started-флага worker'а —
// ДВА инстанса MSW исполняли handler на один запрос, мутация писалась дважды
// (поймано host-прогоном полного цикла: «Ознакомлено 0/2», два Ерланова).
let bootstrapPromise: Promise<Loaded> | null = null

function bootstrapOnce(): Promise<Loaded> {
  if (bootstrapPromise !== null) return bootstrapPromise
  bootstrapPromise = (async () => {
    globalThis.__JOSPARLAU_ENV__ = {
      MODE: 'mock',
      BASENAME: '/ops',
      VITE_DATA_SOURCE: 'mock',
      VITE_ENABLE_DEMO_TOOLS: 'true',
      // Этап M4: SPA живёт в каркасе host'а — свой сайдбар/шапку не рисует.
      VITE_EMBEDDED_CHROME: 'true',
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
    // Announcer убирается ЗДЕСЬ, до того как SPA станет видимым: observer
    // ниже — страховка на пере-вставку, но его microtask мог не успеть до
    // первого клика теста (гонка поймана host-прогоном: клик за первую
    // секунду заставал оба role=alert живыми).
    document.querySelector('next-route-announcer')?.remove()
    document.getElementById('__next-route-announcer__')?.remove()
    return { App: appModule.default, Providers: providersModule.Providers }
  })()
  return bootstrapPromise
}

export default function JosparlauMount() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  useEffect(() => {
    let cancelled = false
    void bootstrapOnce().then((result) => {
      if (!cancelled) setLoaded(result)
    })
    return () => {
      cancelled = true
    }
  }, [])
  // Next route-announcer (`role="alert"`) внутри /ops мёртв: все переходы
  // ведёт react-router, Next-навигации не происходит — узел никогда не
  // анонсирует, но двоит каждый `getByRole('alert')` (двоился бы и для
  // скринридера при настоящем алерте страницы). Удаляем его и пере-вставки.
  useEffect(() => {
    // Узел с id живёт в ShadowRoot кастом-элемента <next-route-announcer> —
    // getElementById его НЕ видит (ложное «удалено» первой редакции фикса),
    // а piercing-локаторы тестов и скринридеры — видят. Удаляется сам host.
    const remove = () => {
      document.querySelector('next-route-announcer')?.remove()
      document.getElementById('__next-route-announcer__')?.remove()
    }
    remove()
    const observer = new MutationObserver(remove)
    // subtree: прод-Next пере-вставляет announcer НЕ прямым потомком body —
    // плоский childList-observer пропускал повторную вставку (Этап M2).
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
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
