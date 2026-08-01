// Режим приложения в host-переносе (PersonalRecordFront/Next): Vite MODE
// здесь не существует, режим задаёт страница-хост тем же глобалом, что и env.
const source = (globalThis as { __JOSPARLAU_ENV__?: { MODE?: unknown } }).__JOSPARLAU_ENV__
export const JOSPARLAU_MODE: string = typeof source?.MODE === 'string' ? source.MODE : 'mock'

/** Базовый путь SPA внутри host-приложения (Next): «/ops». */
export const JOSPARLAU_BASENAME: string =
  typeof (globalThis as { __JOSPARLAU_ENV__?: { BASENAME?: unknown } }).__JOSPARLAU_ENV__?.BASENAME === 'string'
    ? ((globalThis as { __JOSPARLAU_ENV__?: { BASENAME?: string } }).__JOSPARLAU_ENV__!.BASENAME as string)
    : '/'
