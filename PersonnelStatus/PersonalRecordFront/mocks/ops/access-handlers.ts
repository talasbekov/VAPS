// MSW-handlers раздела доступа: права, роли, назначения, учётки и каталог
// применения (Plane №36, шаг «П-10»).
//
// Домен `access` ЖИВОЙ по умолчанию — бэкенд раздела написан шагами «П-1»…
// «П-5». Мок нужен для демо без бэка и для отладки экранов и включается
// возвратом домена на мок: NEXT_PUBLIC_OPS_MOCK_DOMAINS=access.
//
// Мок ПОВТОРЯЕТ ПРАВИЛА сервера, а не только форму ответа. Мок, который
// разрешает больше живого, зеленит экран там, где живьём он отобьётся:
//   • удаления права, роли и учётки НЕТ — только деактивация и блокировка;
//   • поиск серверный (по коду, имени, описанию; у учёток — по логину, ФИО,
//     почте) и сужает выдачу, а не показанную страницу;
//   • повторная выдача той же роли в той же области второго назначения не
//     заводит;
//   • пароль в ответах не появляется НИКОГДА, кроме одноразового
//     `temporary_password` у заведения и сброса;
//   • PATCH учётки с паролем отбивается — сброс идёт своим действием.
//
// Ведущая «*» в паттерне обязательна: в dev клиент бьёт по абсолютному
// BACKEND_URL, и относительный путь ушёл бы в сеть мимо мока.
import { http, HttpResponse } from "msw";
import {
  ACCESS_ACCOUNTS_PATH,
  ACCESS_CATALOG_PATH,
  ACCESS_PERMISSIONS_PATH,
  ACCESS_ROLES_PATH,
  ACCESS_USER_ROLES_PATH,
} from "@/entities/access";
import type {
  AccessAccount,
  AccessCatalogEntry,
  AccessPermission,
  AccessRole,
  AccessUserRole,
} from "@/entities/access";

interface MockAccount extends AccessAccount {
  /** Свёртки пароля мок не считает: хранит признак «пароль когда-то выдан».
   * Сам пароль не хранится нигде — ровно как на сервере. */
  hasPassword: boolean;
}

const PERMISSIONS: AccessPermission[] = [
  {
    code: "admin.roles",
    name: "Управление доступом",
    description: "Права, роли, назначения и учётные записи.",
    is_active: true,
  },
  {
    code: "event.manage",
    name: "Ведение мероприятий",
    description: "Этапы мероприятия, расстановка, закрытие.",
    is_active: true,
  },
  // Заведение карточки и бюллетень отделены от ведения ОМ (Plane №382):
  // сотрудник второго департамента заводит и заполняет бюллетень, но
  // мероприятие дальше не ведёт. Контракт держится с двух концов — коды
  // добавлены в мок в тот же заход, что и на сервере.
  {
    code: "event.create",
    name: "Заведение мероприятия",
    description: "Создание карточки ОМ в реестре.",
    is_active: true,
  },
  {
    code: "event.bulletin",
    name: "Заполнение бюллетеня",
    description: "Описание, задачи и открытие рекогносцировки.",
    is_active: true,
  },
  {
    code: "event.read",
    name: "Чтение мероприятий",
    description: "Реестр ОМ и карточка без правок.",
    is_active: true,
  },
  {
    code: "forces.allocate",
    name: "Выделение сил",
    description: "Ответ департамента на заявку штаба.",
    is_active: true,
  },
  {
    code: "reports.export",
    name: "Выгрузка отчётов",
    description: null,
    is_active: false,
  },
];

const ROLES: AccessRole[] = [
  {
    code: "ADMIN",
    name: "Администратор",
    description: "Полный доступ.",
    is_active: true,
    permissions: ["admin.roles", "event.manage", "event.read"],
  },
  {
    code: "OPS_OFFICER",
    name: "Офицер ОМ",
    description: "Ведёт мероприятия своего управления.",
    is_active: true,
    permissions: ["event.manage", "event.read"],
  },
  {
    code: "OBSERVER",
    name: "Наблюдатель",
    description: "Только чтение.",
    is_active: true,
    permissions: ["event.read"],
  },
];

const ACCOUNTS: MockAccount[] = [
  {
    id: 1,
    username: "admin",
    first_name: "Администратор",
    last_name: "Системы",
    full_name: "Администратор Системы",
    email: "admin@example.kz",
    is_active: true,
    last_login: "2026-08-26T06:10:00Z",
    hasPassword: true,
  },
  {
    id: 2,
    username: "ops.officer",
    first_name: "Асхат",
    last_name: "Дюсенов",
    full_name: "Асхат Дюсенов",
    email: "",
    is_active: true,
    last_login: null,
    hasPassword: true,
  },
  {
    id: 3,
    username: "observer",
    first_name: "Гульмира",
    last_name: "Сатпаева",
    full_name: "Гульмира Сатпаева",
    email: "observer@example.kz",
    is_active: false,
    last_login: "2026-07-02T11:40:00Z",
    hasPassword: true,
  },
];

const USER_ROLES: AccessUserRole[] = [
  {
    id: 1,
    user_id: "1",
    user_login: "admin",
    user_full_name: "Администратор Системы",
    role_code: "ADMIN",
    role_name: "Администратор",
    scope_division_id: null,
    scope_division_name: null,
    is_active: true,
  },
  {
    id: 2,
    user_id: "2",
    user_login: "ops.officer",
    user_full_name: "Асхат Дюсенов",
    role_code: "OPS_OFFICER",
    role_name: "Офицер ОМ",
    scope_division_id: 2,
    scope_division_name: "Департамент охраны",
    is_active: true,
  },
];

/** Каталог применения СОБИРАЕТСЯ из карт гейтов на сервере; мок повторяет
 * форму на нескольких настоящих ручках — выдумывать сюда правдоподобные
 * адреса значило бы учить экран несуществующему API. */
const CATALOG: AccessCatalogEntry[] = [
  {
    code: "admin.roles",
    name: "Управление доступом",
    isKnown: true,
    isActive: true,
    functions: [
      {
        permission: "admin.roles",
        method: "GET",
        path: "/api/operations/permissions/",
        action: "list",
        view: "PermissionViewSet",
      },
      {
        permission: "admin.roles",
        method: "POST",
        path: "/api/operations/accounts/",
        action: "create",
        view: "AccountViewSet",
      },
      {
        permission: "admin.roles",
        method: "POST",
        path: "/api/operations/accounts/{id}/reset-password/",
        action: "reset_password",
        view: "AccountViewSet",
      },
    ],
  },
  {
    code: "event.manage",
    name: "Ведение мероприятий",
    isKnown: true,
    isActive: true,
    functions: [
      {
        permission: "event.manage",
        method: "DELETE",
        path: "/api/ops/security-events/{id}/",
        action: "destroy",
        view: "SecurityEventViewSet",
      },
    ],
  },
  {
    code: "event.create",
    name: "Заведение мероприятия",
    isKnown: true,
    isActive: true,
    functions: [
      {
        permission: "event.create",
        method: "POST",
        path: "/api/ops/security-events/",
        action: "create",
        view: "SecurityEventViewSet",
      },
    ],
  },
  {
    code: "event.bulletin",
    name: "Заполнение бюллетеня",
    isKnown: true,
    isActive: true,
    functions: [
      {
        permission: "event.bulletin",
        method: "PATCH",
        path: "/api/ops/security-events/{id}/bulletin/",
        action: "bulletin",
        view: "SecurityEventViewSet",
      },
    ],
  },
];

let nextUserRoleId = USER_ROLES.length + 1;
let nextAccountId = ACCOUNTS.length + 1;

function searchOf(request: Request): string {
  return (new URL(request.url).searchParams.get("search") ?? "")
    .trim()
    .toLowerCase();
}

function paged<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
}

/** Временный пароль. Читаемый и достаточно длинный — его переписывают рукой
 * с экрана, поэтому символов, которые путаются в почерке, здесь нет. */
function temporaryPassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 12; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function publicAccount(account: MockAccount): AccessAccount {
  const { hasPassword: _hasPassword, ...rest } = account;
  return rest;
}

export const accessHandlers = [
  // ── Права ────────────────────────────────────────────────────────────────
  http.get(`*${ACCESS_PERMISSIONS_PATH}`, ({ request }) => {
    const search = searchOf(request);
    return HttpResponse.json(
      paged(
        PERMISSIONS.filter(
          (item) =>
            search === "" ||
            item.code.toLowerCase().includes(search) ||
            item.name.toLowerCase().includes(search) ||
            (item.description ?? "").toLowerCase().includes(search)
        )
      )
    );
  }),

  http.post(`*${ACCESS_PERMISSIONS_PATH}`, async ({ request }) => {
    const body = (await request.json()) as Partial<AccessPermission>;
    const code = (body.code ?? "").trim();
    if (code === "") {
      return HttpResponse.json({ code: ["Обязательное поле."] }, { status: 400 });
    }
    if (PERMISSIONS.some((item) => item.code === code)) {
      return HttpResponse.json(
        { code: ["Право с таким кодом уже заведено."] },
        { status: 400 }
      );
    }
    const created: AccessPermission = {
      code,
      name: (body.name ?? "").trim(),
      description: body.description ?? null,
      is_active: body.is_active ?? true,
    };
    PERMISSIONS.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),

  http.patch(`*${ACCESS_PERMISSIONS_PATH}:code/`, async ({ params, request }) => {
    const code = decodeURIComponent(String(params.code));
    const target = PERMISSIONS.find((item) => item.code === code);
    if (target === undefined) return new HttpResponse(null, { status: 404 });
    const body = (await request.json()) as Partial<AccessPermission>;
    if (body.is_active !== undefined) target.is_active = body.is_active;
    if (body.name !== undefined) target.name = body.name;
    if (body.description !== undefined) target.description = body.description;
    return HttpResponse.json(target);
  }),

  // ── Каталог применения ───────────────────────────────────────────────────
  http.get(`*${ACCESS_CATALOG_PATH}`, () =>
    HttpResponse.json({ count: CATALOG.length, results: CATALOG })
  ),

  // ── Роли ─────────────────────────────────────────────────────────────────
  http.get(`*${ACCESS_ROLES_PATH}`, ({ request }) => {
    const search = searchOf(request);
    return HttpResponse.json(
      paged(
        ROLES.filter(
          (item) =>
            search === "" ||
            item.code.toLowerCase().includes(search) ||
            item.name.toLowerCase().includes(search) ||
            (item.description ?? "").toLowerCase().includes(search)
        )
      )
    );
  }),

  http.post(`*${ACCESS_ROLES_PATH}`, async ({ request }) => {
    const body = (await request.json()) as Partial<AccessRole>;
    const code = (body.code ?? "").trim();
    if (code === "") {
      return HttpResponse.json({ code: ["Обязательное поле."] }, { status: 400 });
    }
    const existing = ROLES.find((item) => item.code === code);
    if (existing !== undefined) {
      return HttpResponse.json(
        { code: ["Роль с таким кодом уже заведена."] },
        { status: 400 }
      );
    }
    // Роль без прав допустима: это заготовка, состав набирают отдельно.
    const created: AccessRole = {
      code,
      name: (body.name ?? "").trim(),
      description: body.description ?? null,
      is_active: body.is_active ?? true,
      permissions: [],
    };
    ROLES.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),

  http.patch(`*${ACCESS_ROLES_PATH}:code/`, async ({ params, request }) => {
    const code = decodeURIComponent(String(params.code));
    const target = ROLES.find((item) => item.code === code);
    if (target === undefined) return new HttpResponse(null, { status: 404 });
    const body = (await request.json()) as Partial<AccessRole>;
    if (body.is_active !== undefined) target.is_active = body.is_active;
    if (body.name !== undefined) target.name = body.name;
    if (body.description !== undefined) target.description = body.description;
    return HttpResponse.json(target);
  }),

  http.post(`*${ACCESS_ROLES_PATH}:code/permissions/`, async ({ params, request }) => {
    const code = decodeURIComponent(String(params.code));
    const target = ROLES.find((item) => item.code === code);
    if (target === undefined) return new HttpResponse(null, { status: 404 });
    const body = (await request.json()) as { add?: string[]; remove?: string[] };
    const unknown = (body.add ?? []).filter(
      (item) => !PERMISSIONS.some((permission) => permission.code === item)
    );
    if (unknown.length > 0) {
      return HttpResponse.json(
        { add: [`Неизвестные права: ${unknown.join(", ")}`] },
        { status: 400 }
      );
    }
    const next = new Set(target.permissions);
    for (const item of body.add ?? []) next.add(item);
    for (const item of body.remove ?? []) next.delete(item);
    target.permissions = [...next].sort();
    return HttpResponse.json(target);
  }),

  // ── Назначения ролей ─────────────────────────────────────────────────────
  http.get(`*${ACCESS_USER_ROLES_PATH}`, ({ request }) => {
    const url = new URL(request.url);
    const userId = url.searchParams.get("user_id");
    return HttpResponse.json(
      paged(
        USER_ROLES.filter((row) => userId === null || row.user_id === userId)
      )
    );
  }),

  http.post(`*${ACCESS_USER_ROLES_PATH}`, async ({ request }) => {
    const body = (await request.json()) as {
      user_id: string;
      role_code: string;
      scope_division_id: number | null;
    };
    const role = ROLES.find((item) => item.code === body.role_code);
    if (role === undefined) {
      return HttpResponse.json(
        { role_code: ["Неизвестная роль."] },
        { status: 400 }
      );
    }
    // Повтор той же роли в той же области второго назначения НЕ заводит —
    // ровно как на сервере: иначе список ролей человека рос бы дублями.
    const same = USER_ROLES.find(
      (row) =>
        row.user_id === body.user_id &&
        row.role_code === body.role_code &&
        row.scope_division_id === body.scope_division_id
    );
    if (same !== undefined) {
      same.is_active = true;
      return HttpResponse.json(same, { status: 201 });
    }
    const account = ACCOUNTS.find(
      (item) => String(item.id) === body.user_id
    );
    const created: AccessUserRole = {
      id: nextUserRoleId,
      user_id: body.user_id,
      user_login: account?.username ?? null,
      user_full_name: account?.full_name ?? null,
      role_code: role.code,
      role_name: role.name,
      scope_division_id: body.scope_division_id,
      scope_division_name:
        body.scope_division_id === null
          ? null
          : `Подразделение №${body.scope_division_id}`,
      is_active: true,
    };
    nextUserRoleId += 1;
    USER_ROLES.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),

  http.delete(`*${ACCESS_USER_ROLES_PATH}:id/`, ({ params }) => {
    const id = Number(params.id);
    const target = USER_ROLES.find((row) => row.id === id);
    if (target === undefined) return new HttpResponse(null, { status: 404 });
    // Снятие НЕ удаляет строку: выдача остаётся историей, как на сервере.
    target.is_active = false;
    return new HttpResponse(null, { status: 204 });
  }),

  // ── Учётные записи ───────────────────────────────────────────────────────
  http.get(`*${ACCESS_ACCOUNTS_PATH}`, ({ request }) => {
    const search = searchOf(request);
    return HttpResponse.json(
      paged(
        ACCOUNTS.filter(
          (item) =>
            search === "" ||
            item.username.toLowerCase().includes(search) ||
            item.first_name.toLowerCase().includes(search) ||
            item.last_name.toLowerCase().includes(search) ||
            item.email.toLowerCase().includes(search)
        ).map(publicAccount)
      )
    );
  }),

  http.post(`*${ACCESS_ACCOUNTS_PATH}`, async ({ request }) => {
    const body = (await request.json()) as {
      username?: string;
      first_name?: string;
      last_name?: string;
      email?: string;
      password?: string;
    };
    const username = (body.username ?? "").trim();
    if (username === "") {
      return HttpResponse.json(
        { username: ["Обязательное поле."] },
        { status: 400 }
      );
    }
    if (ACCOUNTS.some((item) => item.username === username)) {
      return HttpResponse.json(
        { username: ["Учётная запись с таким логином уже есть."] },
        { status: 400 }
      );
    }
    const first = (body.first_name ?? "").trim();
    const last = (body.last_name ?? "").trim();
    const created: MockAccount = {
      id: nextAccountId,
      username,
      first_name: first,
      last_name: last,
      full_name: `${first} ${last}`.trim() === "" ? null : `${first} ${last}`.trim(),
      email: (body.email ?? "").trim(),
      is_active: true,
      last_login: null,
      hasPassword: true,
    };
    nextAccountId += 1;
    ACCOUNTS.push(created);
    const payload: Record<string, unknown> = { ...publicAccount(created) };
    // Пароль, заданный администратором, обратно НЕ возвращается: показывать
    // ему то, что он сам ввёл, незачем — как и на сервере.
    if ((body.password ?? "") === "") {
      payload.temporary_password = temporaryPassword();
    }
    return HttpResponse.json(payload, { status: 201 });
  }),

  http.patch(`*${ACCESS_ACCOUNTS_PATH}:id/`, async ({ params, request }) => {
    const id = Number(params.id);
    const target = ACCOUNTS.find((item) => item.id === id);
    if (target === undefined) return new HttpResponse(null, { status: 404 });
    const body = (await request.json()) as Partial<AccessAccount> & {
      password?: string;
    };
    if (body.password) {
      return HttpResponse.json(
        { password: ["Пароль меняется действием reset-password/."] },
        { status: 400 }
      );
    }
    if (body.is_active !== undefined) target.is_active = body.is_active;
    if (body.first_name !== undefined) target.first_name = body.first_name;
    if (body.last_name !== undefined) target.last_name = body.last_name;
    if (body.email !== undefined) target.email = body.email;
    const full = `${target.first_name} ${target.last_name}`.trim();
    target.full_name = full === "" ? null : full;
    return HttpResponse.json(publicAccount(target));
  }),

  http.post(`*${ACCESS_ACCOUNTS_PATH}:id/reset-password/`, ({ params }) => {
    const id = Number(params.id);
    const target = ACCOUNTS.find((item) => item.id === id);
    if (target === undefined) return new HttpResponse(null, { status: 404 });
    target.hasPassword = true;
    return HttpResponse.json({ temporary_password: temporaryPassword() });
  }),

  // Удаления учётки нет ВОВСЕ — на ней висят назначения и авторство записей
  // журнала. Мок отбивает так же, как сервер: 405, а не «удалено».
  http.delete(`*${ACCESS_ACCOUNTS_PATH}:id/`, () =>
    HttpResponse.json(
      { detail: 'Метод "DELETE" не разрешён.' },
      { status: 405 }
    )
  ),
];
