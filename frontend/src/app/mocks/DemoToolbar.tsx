// Demo toolbar (§8.3 mock-only-demo runtime, НЕ продуктовый UI): переключение
// persona/reset вызывают demo-runtime, а не поддельный backend endpoint.
// Живёт в app (не shared/ui — shared не может импортировать app/mocks,
// ARCH-FE-013), рендерится только при VITE_DATA_SOURCE=mock &&
// VITE_ENABLE_DEMO_TOOLS=true (§8.1).
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { useAuth } from '../../shared/auth/AuthContext'
import { Button } from '../../shared/ui/Button'
import { DEMO_PERSONAS, findDemoPersona } from './demo-personas'
import {
  performFullReset,
  readDemoSettings,
  writeDemoSettings,
} from './demo-runtime'

export function DemoToolbar() {
  const { login } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [personaId, setPersonaId] = useState(() => readDemoSettings().personaId)
  const [resetting, setResetting] = useState(false)

  function switchPersona(nextId: string): void {
    const persona = findDemoPersona(nextId)
    if (persona === undefined) return
    login({ kind: 'dev', userId: persona.userId })
    // Данные предыдущей persona не должны пережить переключение (§35): пока
    // ни одна Smart Josparlau feature не кэширует данные — очищаем весь
    // QueryClient целиком, а не только ['me'] (login() это уже делает сам).
    queryClient.clear()
    writeDemoSettings({ ...readDemoSettings(), personaId: nextId })
    setPersonaId(nextId)
    navigate(persona.homeRoute)
  }

  async function resetDemoData(): Promise<void> {
    const confirmed = window.confirm(
      'Сбросить все демонстрационные данные к исходному сценарию? Действие необратимо.',
    )
    if (!confirmed) return
    setResetting(true)
    try {
      await performFullReset()
      queryClient.clear()
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 rounded-md border bg-card p-3 text-xs shadow-lg">
      <span className="font-semibold text-muted-foreground">
        Demo-режим (без backend)
      </span>
      <label className="flex flex-col gap-1">
        Persona
        <select
          className="rounded border bg-background px-2 py-1"
          value={personaId}
          onChange={(e) => switchPersona(e.target.value)}
        >
          {DEMO_PERSONAS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={resetting}
        onClick={resetDemoData}
      >
        {resetting ? 'Сброс…' : 'Сбросить demo-данные'}
      </Button>
    </div>
  )
}
