"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { apiClient } from "@/lib/api";

export type UserRole =
  | "role-1"
  | "role-2"
  | "role-3"
  | "role-4"
  | "role-5"
  | "role-6";

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
            };

            if (backendRoleCode && roleMap[backendRoleCode]) {
              return roleMap[backendRoleCode];
            }

            // Если роль не найдена, используем дефолтную роль-4 (полный доступ)
            return "role-4";
          };

          // Извлекаем код роли из нового формата: role.code
          const roleCode = backendRole?.code;
          const frontendRole = roleCode
            ? mapBackendRoleToFrontend(roleCode)
            : "role-4";

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

  const logout = async (): Promise<void> => {
    try {
      await signOut({ redirect: true, callbackUrl: "/" });
    } catch (error) {
      console.error("Logout error:", error);
    }
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
