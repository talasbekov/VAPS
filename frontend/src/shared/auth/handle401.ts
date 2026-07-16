// Единая 401-реакция (цепь 8.6, Д7): извлечена из app/providers, потому что
// её каналы двое — QueryCache/MutationCache (все queries/mutations) И прямые
// fetch-каналы вне React Query (blob-download 10.5). Живёт в shared/auth:
// features импортировать app не могут (ARCH-FE-013), shared → shared легален.
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '../api/errors'
import { clearCredential } from './credential'

/**
 * ЛЮБОЙ запрос с 401 AUTH_REQUIRED чистит credential и сбрасывает ['me'];
 * навигацию делает RequireAuth реактивно (без window.location). 403
 * PERMISSION_DENIED credential НЕ трогает (401 ≠ 403, UX L202-203).
 * Возвращает true, если ошибка поглощена цепью — вызывающий НЕ дублирует
 * её собственным каналом (баннером/тостом).
 */
export function handle401(error: unknown, client: QueryClient): boolean {
  if (!(error instanceof ApiError) || error.status !== 401) return false
  clearCredential()
  // removeQueries, НЕ invalidate: рефетч без credential словил бы 403
  client.removeQueries({ queryKey: ['me'] })
  return true
}
