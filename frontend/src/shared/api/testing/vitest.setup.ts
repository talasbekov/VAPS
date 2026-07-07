// Жизненный цикл MSW. onUnhandledRequest: 'error' обязателен — молчаливый
// passthrough сделал бы тесты вакуумными (Ловушка 2).
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './server'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
