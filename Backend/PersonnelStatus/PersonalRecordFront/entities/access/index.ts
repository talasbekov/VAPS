// Раздел доступа: права и их каталог применения (Plane №36, шаги «П-1»…«П-6»).
//
// Два уровня, а не три — решение заказчика: ПРАВО (`event.manage`) это то,
// что проверяют ручки, а «функции» — read-only список мест, которые право
// открывает. Функции не хранятся: сервер собирает их из карт гейтов, и
// поэтому у них нет ни идентификатора, ни правки.

/** Справочник прав раздела. */
export const ACCESS_PERMISSIONS_PATH = "/api/operations/permissions/";
/** Справочник ролей раздела. */
export const ACCESS_ROLES_PATH = "/api/operations/roles/";
/** Каталог применения: где каждое право работает. */
export const ACCESS_CATALOG_PATH = "/api/ops/access-catalog/";

export function accessPermissionPath(code: string): string {
  // Код содержит точку (`event.manage`) — в путь он идёт закодированным,
  // иначе символ вроде `/` в коде увёл бы запрос на чужой адрес.
  return `${ACCESS_PERMISSIONS_PATH}${encodeURIComponent(code)}/`;
}

export function accessRolePath(code: string): string {
  return `${ACCESS_ROLES_PATH}${encodeURIComponent(code)}/`;
}

export function accessRolePermissionsPath(code: string): string {
  return `${accessRolePath(code)}permissions/`;
}

export interface AccessRole {
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  /** Состав прав приезжает ВМЕСТЕ с ролью: реестр ролей спрашивают о том,
   * что роль открывает, а не только о том, как она называется. */
  permissions: string[];
}

export interface ListAccessRolesResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: AccessRole[];
}

export interface SaveAccessRoleRequest {
  [key: string]: unknown;
  code: string;
  name: string;
  description?: string;
  is_active?: boolean;
}

/** Правка состава: добавить и снять ОДНИМ обращением — так же, как на
 * сервере, где два запроса оставили бы роль в промежуточном состоянии. */
export interface ChangeRolePermissionsRequest {
  [key: string]: unknown;
  add?: string[];
  remove?: string[];
}

export interface AccessPermission {
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

export interface ListAccessPermissionsResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: AccessPermission[];
}

/** Одно место применения права: метод, адрес, действие вьюсета. */
export interface AccessFunction {
  permission: string;
  method: string;
  path: string;
  action: string;
  view: string;
}

export interface AccessCatalogEntry {
  code: string;
  name: string;
  /** false — гейт на праве стоит, а строки справочника у него нет. */
  isKnown: boolean;
  isActive: boolean;
  functions: AccessFunction[];
}

export interface AccessCatalogResponse {
  count: number;
  results: AccessCatalogEntry[];
}

export interface SaveAccessPermissionRequest {
  // Индексная сигнатура — требование useOpsMutation: тело мутации должно
  // быть Record<string, unknown>, иначе повтор с override не соберёт тело.
  [key: string]: unknown;
  code: string;
  name: string;
  description?: string;
  is_active?: boolean;
}

/** Цвет метода — читающие методы спокойные, пишущие заметные. Смысл несёт
 * САМА подпись метода, цвет только помогает: по одному цвету ничего не
 * различается. */
const ACCESS_METHOD_TONE: Record<string, string> = {
  GET: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  POST: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  PUT: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  PATCH: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  DELETE: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
};

export function accessMethodTone(method: string): string {
  return (
    ACCESS_METHOD_TONE[method.toUpperCase()] ??
    "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
  );
}
