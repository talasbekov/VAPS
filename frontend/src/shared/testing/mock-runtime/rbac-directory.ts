// Generic RBAC-резолвер для mock-режима (§8.5 «repository должен... проверять
// permission и scope»). НЕ domain-код: не знает про Smart Josparlau, охранные
// мероприятия и т.п. — только `userId → коды прав`. Нужен и app
// (identity-handlers), и feature repositories — но features НЕ могут
// импортировать app (ARCH-FE-013), поэтому сами данные (кто есть кто)
// регистрируются ОДИН раз при bootstrap (app/mocks/browser.ts), а резолвер
// живёт здесь, в shared, куда features могут импортировать.
export interface RbacGrant {
  userId: string
  permissions: readonly string[]
}

let directory = new Map<string, readonly string[]>()

/** Вызывается ровно один раз при bootstrap mock-режима (app-слой). */
export function registerRbacDirectory(grants: readonly RbacGrant[]): void {
  directory = new Map(grants.map((g) => [g.userId, g.permissions]))
}

export function resolvePermissions(userId: string | null): readonly string[] | undefined {
  if (userId === null) return undefined
  return directory.get(userId)
}

// wildcard `*` = ADMIN — то же правило, что usePermissions.ts (плоский список, Д9)
export function hasPermission(userId: string | null, code: string): boolean {
  const permissions = resolvePermissions(userId)
  if (permissions === undefined) return false
  return permissions.includes('*') || permissions.includes(code)
}

/** Только для тестов: изолирует директорию между тестами. */
export function resetRbacDirectoryForTests(): void {
  directory = new Map()
}
