// Обязательное состояние загрузки/ошибки для lazy-маршрутов (§5.2: «Для
// каждого lazy-маршрута реализуй понятное состояние загрузки и обработку
// ошибки загрузки chunk»). React Router v7 Declarative Mode (канон §5.2, БЕЗ
// Data/Framework Mode) не даёт `errorElement` — только error boundary класс.
import { Component } from 'react'
import type { ReactNode } from 'react'
import { Suspense } from 'react'
import { Button } from '../shared/ui/Button'

interface BoundaryState {
  failed: boolean
}

class ChunkErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="rounded-xl border bg-card p-6 text-sm">
          <p className="mb-3 text-destructive">
            Не удалось загрузить раздел. Проверьте соединение и попробуйте ещё раз.
          </p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Обновить страницу
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}

export function RouteChunkBoundary({ children }: { children: ReactNode }) {
  return (
    <ChunkErrorBoundary>
      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground">Загрузка раздела…</p>
        }
      >
        {children}
      </Suspense>
    </ChunkErrorBoundary>
  )
}
