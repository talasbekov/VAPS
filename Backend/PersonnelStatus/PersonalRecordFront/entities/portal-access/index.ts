/**
 * Право, открывающее пункт меню раздела ОМ (Plane №350).
 *
 * РЕШЕНИЕ ЗАКАЗЧИКА 31.08.2026, отменяющее прежнее правило проекта. До этого
 * пункты раздела ОМ стояли в меню ВСЕГДА, а недоступный экран отвечал «Доступ
 * закрыт»; правило было записано дважды — в `components/navigation/sidebar.tsx`
 * и в `features/forces-split/ui/chain-access.ts` («недоступное ВЫКЛЮЧАЕТСЯ, а
 * не прячется: спрятанная кнопка не отвечает на вопрос почему я этого не
 * вижу»). Заказчик описал семь ролей списками НЕДОСТУПНЫХ модулей и на вопрос
 * ответил прямо: прятать. Под ролью «Сотрудник» иначе видно десять пунктов из
 * шестнадцати, каждый из которых отвечает отказом, и это читается как
 * сломанная система, а не как разграничение прав.
 *
 * 🔴 ОДНО МЕСТО ПРАВДЫ, А НЕ ДВА. Прежний довод против прав в меню был верным:
 * видимость, посчитанная в меню отдельно от гейта страницы, разошлась бы с
 * ним. Поэтому здесь не «копия для меню», а ИСТОЧНИК: страницы берут код
 * своего гейта отсюда же (`MODULE_PERMISSION[...]`), и разойтись им больше
 * нечем. Проба `e2e/menu-access.spec.ts` держит вторую половину: пункт виден
 * тогда и только тогда, когда экран за ним открывается.
 *
 * `null` — пункт без права: личный кабинет, обратная связь и журнал изменений
 * открыты каждому, кто вообще вошёл.
 */
export const MODULE_PERMISSION = {
  "/security-ops/profile": null,
  "/security-ops/command-center": "event.view",
  "/security-ops/analytics": "analytics.view",
  "/security-ops/objects": "object.view",
  "/security-ops/events": "event.view",
  "/security-ops/persons": "catalog.view",
  "/security-ops/laws": "catalog.view",
  "/security-ops/vehicles": "event.view",
  "/security-ops/analytics/operations": "analytics.operations",
  "/security-ops/service-reports": "report.generate",
  "/security-ops/dictionaries": "dictionary.view",
  "/security-ops/settings": "settings.view",
  "/settings/permissions": "admin.roles",
  "/settings/roles": "admin.roles",
  "/settings/users": "admin.roles",
  "/security-ops/audit": "audit.view",
  // Журнал изменений стоит в категории «Система», а её заказчик назвал
  // недоступной целиком (Plane №348, №350). Без права у пункта категория
  // «Система» оставалась бы у сотрудника с одной строкой — половинчатое
  // состояние, которое и читается как «система сломана».
  "/security-ops/changelog": "settings.view",
  "/feedback": "feedback.view",
} as const satisfies Record<string, string | null>;

export type ModuleHref = keyof typeof MODULE_PERMISSION;

/**
 * Право пункта по его адресу. Неизвестный адрес — `null` («права не
 * требует»), а НЕ отказ: пункт, забытый в таблице, должен вести себя как
 * прежде и быть виден, иначе правка карты молча уносит модуль из меню у всех.
 * Забытый пункт ловит проба сверки, а не пустое меню у живого человека.
 */
export function modulePermissionOf(href: string): string | null {
  return (MODULE_PERMISSION as Record<string, string | null>)[href] ?? null;
}
