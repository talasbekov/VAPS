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
  "/service-employees": null,
  // ── Портальные модули (Plane №352, Ш-1) ─────────────────────────────────
  //
  // Раньше их видимость решал набор ресурсов зашитой портальной роли
  // (`lib/auth.tsx`, шесть ролей), а не права человека. Заказчик потребовал
  // «всё старое искоренить, работать по семи ролям», и семь его ролей живут в
  // каталоге РАЗДЕЛА — значит и портальные пункты обязаны спрашивать раздел.
  //
  // Новых кодов не заведено: все четыре модуля ложатся на существующие права.
  // Заводить `dashboard.view` рядом с `orgstructure.view` значило бы завести
  // второе имя для одного и того же права.
  "/dashboard": "orgstructure.view",
  "/statuses": "status.view",
  // Сбор сил открывают ТРИ права, а не одно: делит потребность
  // (`forces.command`), оповещает управления (`forces.allocate`) и выделяет
  // людей (`forces.select`) — это три разные роли на одном экране, и
  // требовать одно право значило бы закрыть его двум из трёх.
  //
  // 🔴 ПРАВО НА ЛИЧНЫЙ СОСТАВ (`personnel.view`) ЭКРАН БОЛЬШЕ НЕ ОТКРЫВАЕТ
  // (Plane №939, решение заказчика 07.09.2026): «acc_dir_head, acc_dir_head_d2,
  // acc_dept_head, acc_dept_head_d2 не должны иметь доступ к модулю Сбор сил
  // на ОМ». С 02.09.2026 (№375) оно стояло здесь четвёртым ключом, и пункт
  // появлялся у всех начальников — заказчик тогда же написал, что список
  // людей для него «это же модуль Статусы сотрудников», а не сбор сил
  // (комментарий в №375, 01.09.2026). Матрица №348 называла «Сбор сил»
  // недоступным всем персонам, кроме ответственного за сбор сил, — карточка
  // №939 возвращает к ней. Свой личный состав руководитель читает в
  // «Статусах сотрудников» (`[СБС-30]`: «отдельной страницы нет»); само право
  // `personnel.view` у ролей осталось — им живут поиск и карточка сотрудника.
  "/employees": ["forces.command", "forces.allocate", "forces.select"],
  "/reports": "daily_report.generate",
  "/security-ops/command-center": "event.view",
  "/security-ops/analytics": "analytics.view",
  "/security-ops/objects": "object.view",
  "/security-ops/events": "event.view",
  // Страница визита иностранного ОЛ (`[ГВО-01]`, Plane №436) — та же мерка,
  // что у реестра: визит показывает то же, что карточка ОМ.
  "/security-ops/visits": "event.view",
  "/security-ops/persons": "catalog.view",
  "/security-ops/laws": "catalog.view",
  "/security-ops/vehicles": "event.view",
  "/security-ops/analytics/operations": "analytics.operations",
  "/security-ops/service-reports": "report.generate",
  // «Свод по Службе» дополнительно закрыт ролевой картой ниже: одного
  // `status.view` недостаточно, иначе его увидят все читатели статусов.
  "/security-ops/service-summary": null,
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
} as const satisfies Record<string, string | readonly string[] | null>;

/** Роль модуля, если одного права раздела недостаточно.
 *
 * Пункт «Свод по Службе» нельзя открывать одним `status.view`: это право
 * получают и обычные читатели статусов. Роль ответственного за сбор сил —
 * отдельная граница рабочего места и должна быть общей для меню и страницы.
 */
export const MODULE_ROLE = {
  "/security-ops/service-summary": "FORCES_GATHERING_OFFICER",
} as const satisfies Record<string, string | readonly string[]>;

export type ModuleHref = keyof typeof MODULE_PERMISSION;

/**
 * Права пункта по его адресу — СПИСОК, потому что модуль может открываться
 * любым из нескольких прав. Пустой список = «права не требует».
 *
 * Неизвестный адрес — тоже пустой список, а НЕ отказ: пункт, забытый в
 * таблице, должен вести себя как прежде и быть виден, иначе правка карты
 * молча уносит модуль из меню у всех. Забытый пункт ловит проба сверки, а не
 * пустое меню у живого человека.
 */
export function modulePermissionsOf(href: string): readonly string[] {
  const value = (MODULE_PERMISSION as Record<string, string | readonly string[] | null>)[href];
  if (value === undefined || value === null) return [];
  return typeof value === "string" ? [value] : value;
}

export function moduleRolesOf(href: string): readonly string[] {
  const value = (MODULE_ROLE as Record<string, string | readonly string[]>)[href];
  if (value === undefined) return [];
  return typeof value === "string" ? [value] : value;
}

/**
 * Открыт ли модуль этому человеку — ТЕМ ЖЕ ключом, что и пункт меню.
 *
 * Глубокие ссылки «Открыть „Сбор сил на ОМ“ →» на этапах ОМ и в «Статусах»
 * вели персон, у которых модуль снят (№939), на «Доступ закрыт» — ровно тот
 * дефект, что №350 чинил для меню (ревью №825 по №939, 08.09.2026). Ссылка
 * спрашивает здесь, а не держит свою копию списка прав и ролей. Wildcard
 * администратора сохраняет полный доступ к ролевым модулям.
 */
export function moduleOpenFor(
  href: string,
  hasPermission: (code: string) => boolean,
  hasRole: (code: string) => boolean = () => true,
): boolean {
  const codes = modulePermissionsOf(href);
  const roles = moduleRolesOf(href);
  return (
    (codes.length === 0 || codes.some(hasPermission)) &&
    (roles.length === 0 || hasPermission("*") || roles.some(hasRole))
  );
}
