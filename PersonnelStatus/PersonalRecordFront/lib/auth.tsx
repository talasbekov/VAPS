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

/**
 * 🔴 ПОРТАЛЬНОЙ РОЛИ БОЛЬШЕ НЕТ (Plane №352, Ш-4; карточка №361).
 *
 * Здесь жили девять кодов ролей (`role-1`…`role-6` плюс четыре профиля
 * матрицы доступа), таблица `ROLES` с набором ресурсов у каждого и маппинг
 * `ROLE_3 → role-3` из ответа сервера. Это был ТРЕТИЙ каталог прав — после
 * `common.Role` на сервере и прав раздела ОМ, — и он решал, что человеку
 * видно, НЕ СПРАШИВАЯ сервер: набор модулей был зашит в код.
 *
 * Заказчик потребовал работать по своим семи ролям, а они живут в каталоге
 * раздела. Видимость меню переехала туда в Ш-1 (`entities/portal-access`),
 * область экранов — в Ш-2, права штатки — в Ш-3. Здесь снимается последнее:
 * роль и права БОЛЬШЕ НЕ ЧИТАЮТСЯ ИЗ ТОКЕНА. Кто что может — отвечает
 * `/api/operations/my-permissions/` (`hooks/use-ops-permissions.ts`), и это
 * единственный ответ на вопрос о правах на клиенте.
 *
 * Что здесь осталось: КТО ВОШЁЛ (имя, почта, идентификатор) и вход-выход.
 * Это факты об учётной записи, а не о правах, и они переживают снос старой
 * системы.
 */

export interface User {
  id: string;
  name: string;
  email: string;
  /** Подразделение, которым подписан человек. Факт о его штатной единице —
   *  не роль и не право. */
  department: string;
  departmentId: string;
  directorateId?: string;
}


interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  isLoading: boolean;
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
          // КТО ВОШЁЛ — и только. Роль и права здесь больше не читаются
          // (Plane №352, Ш-4): сервер их в токен не кладёт, а на вопрос «что
          // можно» отвечает `/api/operations/my-permissions/`.
          const userDataFromBackend = (session.user as any).userData;
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
          // Подразделение человека приходит отдельным полем ответа входа: это
          // его штатная единица, а не область роли. Раньше сюда шло
          // `role.scope` — область ПОРТАЛЬНОЙ роли, которой больше нет.
          const departmentName = userDataFromBackend?.division?.name || "—";
          const departmentId =
            userDataFromBackend?.division?.id?.toString() || "";

          const userData: User = {
            id: userId,
            name: username,
            email: userEmail,
            department: departmentName,
            departmentId: departmentId,
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

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        logout,
        isLoading,
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

// 🔴 `PermissionGate` и `ResourceGate` СНЯТЫ (Plane №352, Ш-4). Оба
// спрашивали зашитый набор ресурсов портальной роли — то есть отвечали на
// вопрос о правах, не спрашивая сервер. Их место занял `useOpsPermissions`:
// экран сам спрашивает КОД ПРАВА раздела и печатает отказ словами
// (`components/ops-access-denied.tsx`), а не прячет кнопку молча.
