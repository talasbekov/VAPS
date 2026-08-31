"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { resetAccessToken } from "@/lib/access-token";
import { apiClient } from "@/lib/api";

export type UserRole =
  | "role-1"
  | "role-2"
  | "role-3"
  | "role-4"
  | "role-5"
  | "role-6"
  // Роли матрицы доступа (Plane №348). Заказчик описал семь персон СПИСКАМИ
  // НЕДОСТУПНЫХ МОДУЛЕЙ, и четырём из них ни один из шести наборов выше не
  // подходит: сочетания «Статусы есть, а Сбор сил и Ежедневный отчёт — нет»
  // среди них нет вовсе. Названы по НАБОРУ МОДУЛЕЙ, а не по должности: один и
  // тот же набор просят и начальник управления, и начальник второго
  // департамента — у них разная область, но одинаковое меню.
  | "employee-ro"
  | "head-basic"
  | "head-reports"
  | "forces-officer";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  departmentId: string;
  directorateId?: string;
  permissions: Permission[];
}

export interface Permission {
  resource: string;
  actions: string[];
}

export interface RoleDefinition {
  id: UserRole;
  name: string;
  description: string;
  color: string;
  permissions: Permission[];
}

// Role definitions with permissions
export const ROLES: Record<UserRole, RoleDefinition> = {
  "role-1": {
    id: "role-1",
    name: "Роль-1: Просмотр организации",
    description: "Просмотр всей организации",
    color: "bg-gray-100 text-gray-800",
    permissions: [
      { resource: "organization", actions: ["read"] },
      { resource: "employees", actions: ["read"] },
      { resource: "reports", actions: ["read"] },
    ],
  },
  "role-2": {
    id: "role-2",
    name: "Роль-2: Просмотр департамента",
    description: "Полный доступ ко всем функциям",
    color: "bg-blue-100 text-blue-800",
    permissions: [
      {
        resource: "organization",
        actions: ["read", "create", "update", "delete"],
      },
      {
        resource: "employees",
        actions: ["read", "create", "update", "delete", "update-status"],
      },
      {
        resource: "statuses",
        actions: ["read", "create", "update", "delete", "mass-update"],
      },
      { resource: "reports", actions: ["read", "create", "export"] },
      { resource: "settings", actions: ["read", "update"] },
      { resource: "users", actions: ["read", "create", "update", "delete"] },
    ],
  },
  "role-3": {
    id: "role-3",
    name: "Роль-3: Редактирование статусов",
    description: "Редактирование статусов управления",
    color: "bg-green-100 text-green-800",
    permissions: [
      { resource: "organization", actions: ["read"] },
      { resource: "employees", actions: ["read", "update-status", "create"] },
      { resource: "statuses", actions: ["read", "update", "mass-update"] },
      { resource: "reports", actions: ["read"] },
    ],
  },
  "role-4": {
    id: "role-4",
    name: "Роль-4: Полный доступ",
    description: "Полный доступ ко всем функциям",
    color: "bg-purple-100 text-purple-800",
    permissions: [
      {
        resource: "organization",
        actions: ["read", "create", "update", "delete"],
      },
      {
        resource: "employees",
        actions: ["read", "create", "update", "delete", "update-status"],
      },
      {
        resource: "statuses",
        actions: ["read", "create", "update", "delete", "mass-update"],
      },
      { resource: "reports", actions: ["read", "create", "export"] },
      { resource: "settings", actions: ["read", "update"] },
      { resource: "users", actions: ["read", "create", "update", "delete"] },
    ],
  },
  "role-5": {
    id: "role-5",
    name: "Роль-5: Кадровый администратор",
    description: "Кадровый администратор подразделения",
    color: "bg-orange-100 text-orange-800",
    permissions: [
      { resource: "organization", actions: ["read-department"] },
      {
        resource: "employees",
        actions: ["read-department", "create", "update", "update-status"],
      },
      { resource: "statuses", actions: ["read", "update", "mass-update"] },
      { resource: "reports", actions: ["read-department", "create", "export"] },
    ],
  },
  // ── Матрица доступа заказчика (Plane №348) ──────────────────────────────
  //
  // Ресурс здесь решает ВИДИМОСТЬ ПУНКТА МЕНЮ (`components/navigation/sidebar`
  // проверяет пару resource/action у портальных пунктов): `organization` —
  // «Обзор», `statuses` — «Статусы сотрудников», `employees` — «Сбор сил на
  // ОМ», `reports` — «Ежедневный отчёт». Пункт, которого в наборе нет, не
  // рисуется — именно это заказчик и называет «модуль недоступен».
  "employee-ro": {
    id: "employee-ro",
    name: "Сотрудник: просмотр статусов",
    description: "Статусы своего управления, без правки",
    color: "bg-slate-100 text-slate-800",
    // ТОЛЬКО чтение: заказчик написал «видно своё управление, но без
    // возможности редактирования». `update` и `mass-update` здесь появиться не
    // должны — кнопки массовой правки берут право отсюда.
    permissions: [{ resource: "statuses", actions: ["read"] }],
  },
  "head-basic": {
    id: "head-basic",
    name: "Руководитель: обзор и статусы",
    description: "Обзор и статусы своего подразделения",
    color: "bg-sky-100 text-sky-800",
    permissions: [
      { resource: "organization", actions: ["read"] },
      { resource: "statuses", actions: ["read", "update", "mass-update"] },
    ],
  },
  "head-reports": {
    id: "head-reports",
    name: "Руководитель: обзор, статусы, ежедневный отчёт",
    description: "То же плюс ежедневный отчёт департамента",
    color: "bg-emerald-100 text-emerald-800",
    permissions: [
      { resource: "organization", actions: ["read"] },
      { resource: "statuses", actions: ["read", "update", "mass-update"] },
      { resource: "reports", actions: ["read", "create", "export"] },
    ],
  },
  "forces-officer": {
    id: "forces-officer",
    name: "Ответственный за сбор сил",
    description: "Сбор сил, обзор, статусы и отчёт департамента",
    color: "bg-amber-100 text-amber-800",
    permissions: [
      { resource: "organization", actions: ["read"] },
      { resource: "employees", actions: ["read"] },
      { resource: "statuses", actions: ["read", "update", "mass-update"] },
      { resource: "reports", actions: ["read", "create", "export"] },
    ],
  },
  "role-6": {
    id: "role-6",
    name: "Роль-6: Редактирование отдела",
    description: "Полный доступ ко всем функциям",
    color: "bg-yellow-100 text-yellow-800",
    permissions: [
      {
        resource: "organization",
        actions: ["read", "create", "update", "delete"],
      },
      {
        resource: "employees",
        actions: ["read", "create", "update", "delete", "update-status"],
      },
      {
        resource: "statuses",
        actions: ["read", "create", "update", "delete", "mass-update"],
      },
      { resource: "reports", actions: ["read", "create", "export"] },
      { resource: "settings", actions: ["read", "update"] },
      { resource: "users", actions: ["read", "create", "update", "delete"] },
    ],
  },
};

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  hasPermission: (resource: string, action: string) => boolean;
  canAccessResource: (resource: string) => boolean;
  isLoading: boolean;
  canUserSeeUnit: (
    unitType: "department" | "directorate",
    unitId: string
  ) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Загружаем информацию о пользователе из бэкенда при наличии сессии
  useEffect(() => {
    const loadUser = async () => {
      if (status === "loading") {
        setIsLoading(true);
        return;
      }

      if (status === "unauthenticated" || !session) {
        setUser(null);
        setIsLoading(false);
        return;
      }

      if (session && session.user) {
        try {
          // Получаем информацию о пользователе из сессии NextAuth
          // Новый формат: userData содержит { id, username, email, role: { code, name, scope: {...} } }
          const userDataFromBackend = (session.user as any).userData;
          const backendRole =
            userDataFromBackend?.role || (session.user as any).role;

          // Маппинг ролей из бэкенда (ROLE_3) в фронтенд (role-3)
          const mapBackendRoleToFrontend = (
            backendRoleCode: string
          ): UserRole => {
            const roleMap: Record<string, UserRole> = {
              ROLE_1: "role-1",
              ROLE_2: "role-2",
              ROLE_3: "role-3",
              ROLE_4: "role-4",
              ROLE_5: "role-5",
              ROLE_6: "role-6",
              // Матрица доступа (Plane №348)
              EMPLOYEE_RO: "employee-ro",
              HEAD_BASIC: "head-basic",
              HEAD_REPORTS: "head-reports",
              FORCES_OFFICER: "forces-officer",
            };

            if (backendRoleCode && roleMap[backendRoleCode]) {
              return roleMap[backendRoleCode];
            }

            // 🔴 НЕИЗВЕСТНАЯ РОЛЬ ЗАКРЫВАЕТСЯ, А НЕ ОТКРЫВАЕТСЯ (Plane №349).
            // Здесь стояло `return "role-4"` — полный доступ ко всему. Роль,
            // заведённая в справочнике и забытая в этой таблице, получала не
            // «ничего не видно», а «видно и можно всё»; и заметить это можно
            // было только по тому, что лишние модули НЕ мешают работать.
            // Самый узкий набор — отказ громкий: человек видит пустое меню и
            // приходит с вопросом, вместо того чтобы молча править чужое.
            return "employee-ro";
          };

          // Извлекаем код роли из нового формата: role.code
          const roleCode = backendRole?.code;
          const frontendRole = roleCode
            ? mapBackendRoleToFrontend(roleCode)
            : "employee-ro";

          // Извлекаем данные из нового формата
          const userId =
            userDataFromBackend?.id?.toString() ||
            (session.user as any).id ||
            session.user.email ||
            "1";
          const username =
            userDataFromBackend?.username ||
            session.user.name ||
            session.user.email?.split("@")[0] ||
            "Пользователь";
          const userEmail =
            userDataFromBackend?.email || session.user.email || "";
          const departmentName = backendRole?.scope?.name || "Система";
          const departmentId = backendRole?.scope?.id?.toString() || "system";

          const userData: User = {
            id: userId,
            name: username,
            email: userEmail,
            role: frontendRole,
            department: departmentName,
            departmentId: departmentId,
            permissions: ROLES[frontendRole].permissions,
          };

          setUser(userData);
        } catch (error) {
          console.error("Error loading user:", error);
          setUser(null);
        }
      }

      setIsLoading(false);
    };

    loadUser();
  }, [session, status]);

  const login = async (
    username: string,
    password: string
  ): Promise<boolean> => {
    try {
      const result = await signIn("credentials", {
        username,
        password,
        redirect: false,
      });

      if (result?.ok) {
        return true;
      }

      return false;
    } catch (error) {
      console.error("Login error:", error);
      return false;
    }
  };

  /**
   * Выход: сессию снимает NextAuth, УХОДИТ со страницы браузер.
   *
   * 🔴 Было `signOut({ redirect: true, callbackUrl: "/" })`. Относительный
   * `callbackUrl` NextAuth резолвит от `NEXTAUTH_URL`, а НЕ от адреса, по
   * которому открыто приложение. В dev переменная стоит на `:3000`, стенд
   * живёт на `:3106` — и «Выйти» уводил на `http://localhost:3000/`, то есть
   * на пустой порт: браузер показывал ошибку соединения, а человек оставался
   * без приложения. Сессия при этом снималась, так что дефект читался как
   * «кнопка ломает сайт».
   *
   * `window.location.origin` не может разъехаться с адресом вкладки, поэтому
   * чинится здесь, а не правкой `NEXTAUTH_URL`: переменная у каждого стенда
   * своя (dev :3106, docker :3100, прод — хост), и любая из них рано или
   * поздно разойдётся с реальным портом снова.
   *
   * Полная перезагрузка, а не `router.push`: после выхода в памяти вкладки
   * остаются кэш react-query с чужими данными и состояние провайдеров.
   */
  const logout = async (): Promise<void> => {
    // Кэш токена снимается ПЕРВЫМ и всегда, даже если `signOut` упадёт: он
    // живёт в памяти вкладки и переживает выход (Plane №343). Пока он цел,
    // следующие 15 секунд любой запрос подписывался бы токеном ушедшего
    // человека — а это уже не медлительность, а чужие права.
    resetAccessToken();
    try {
      await signOut({ redirect: false });
    } catch (error) {
      console.error("Logout error:", error);
    }
    // Уходим и после ошибки: если сессия уцелела, «/» вернёт на дашборд —
    // это видимый отказ, а не молчаливое «ничего не произошло».
    window.location.href = "/";
  };

  const hasPermission = (resource: string, action: string): boolean => {
    if (!user) return false;

    const permission = user.permissions.find((p) => p.resource === resource);
    if (!permission) return false;

    return (
      permission.actions.includes(action) || permission.actions.includes("*")
    );
  };

  const canAccessResource = (resource: string): boolean => {
    if (!user) return false;
    return user.permissions.some((p) => p.resource === resource);
  };

  const canUserSeeUnit = (
    unitType: "department" | "directorate",
    unitId: string
  ): boolean => {
    if (!user) return false;

    // Leadership (role-2, role-4, role-6) and deputies can see everything
    if (
      user.role === "role-2" ||
      user.role === "role-4" ||
      user.role === "role-6" ||
      user.departmentId === "leadership"
    ) {
      return true;
    }

    // Other roles follow department restrictions
    if (unitType === "department") {
      return user.departmentId === unitId;
    }

    return false;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        logout,
        hasPermission,
        canAccessResource,
        isLoading,
        canUserSeeUnit,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

// Permission checking components
interface PermissionGateProps {
  resource: string;
  action: string;
  children: ReactNode;
  fallback?: ReactNode;
}

export function PermissionGate({
  resource,
  action,
  children,
  fallback = null,
}: PermissionGateProps) {
  const { hasPermission } = useAuth();

  if (!hasPermission(resource, action)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

interface ResourceGateProps {
  resource: string;
  children: ReactNode;
  fallback?: ReactNode;
}

export function ResourceGate({
  resource,
  children,
  fallback = null,
}: ResourceGateProps) {
  const { canAccessResource } = useAuth();

  if (!canAccessResource(resource)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
