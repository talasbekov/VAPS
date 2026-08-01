// msw/node-сервер для vitest (environment node, Ловушка 2: НЕ rest.* из msw 1.x).
import { setupServer } from 'msw/node'
import { handlers } from './handlers'

export const server = setupServer(...handlers)
