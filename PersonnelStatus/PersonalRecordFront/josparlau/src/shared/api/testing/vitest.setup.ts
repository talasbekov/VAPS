// Жизненный цикл MSW. onUnhandledRequest: 'error' обязателен — молчаливый
// passthrough сделал бы тесты вакуумными (Ловушка 2).
import { afterAll, afterEach, beforeAll } from 'vitest'
import {
  __resetNotificationsSocketForTests,
  configureNotificationsSocket,
  stopNotificationsSocket,
} from '../../notifications/notificationsSocket'
import { server } from './server'

// Инертный сокет для ВСЕХ тестов (стори 11.3). Почему: в jsdom WebSocket
// настоящий, и любой тест, рендерящий AppLayout, полез бы на ws://localhost/ —
// то есть в реальную сеть, чего никогда не должен делать юнит-тест. Мотив тот
// же, что у onUnhandledRequest: 'error' выше. Побочно: провалившееся соединение
// увело бы статус в reconnecting и вывесило «Нет связи» посреди чужих ассертов,
// сломав заодно getByRole('status') (он же у тоста).
//
// На уровне МОДУЛЯ, а не в beforeAll: setupFiles вычисляются до импорта
// тест-файла, но beforeAll исполняется уже ПОСЛЕ вычисления его модуля —
// top-level сайд-эффект чужого теста успел бы получить дефолтную фабрику.
configureNotificationsSocket({
  socketFactory: () => ({
    close: () => {},
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  }),
})

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  // курсор/дедуп/таймеры не переживают тест (инъекции — переживают намеренно,
  // см. __resetNotificationsSocketForTests)
  stopNotificationsSocket()
  __resetNotificationsSocketForTests()
})
afterAll(() => server.close())
