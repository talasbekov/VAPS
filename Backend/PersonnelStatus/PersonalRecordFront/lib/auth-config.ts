import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

// Для серверных запросов NextAuth нужно использовать прямой URL к бэкенду
// Прокси rewrites работают только для клиентских запросов
const getBackendUrl = () => {
  // Приоритет: BACKEND_URL > NEXT_PUBLIC_API_URL > дефолтное значение
  const url =
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8100";

  console.log("Auth backend URL:", url, {
    BACKEND_URL: process.env.BACKEND_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NODE_ENV: process.env.NODE_ENV,
  });

  return url;
};

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          console.error("Missing credentials");
          return null;
        }

        // На сервере NextAuth используем прямой URL к бэкенду
        // Прокси rewrites не работают для серверных запросов
        const backendUrl = getBackendUrl();
        const url = `${backendUrl}/api/token/`;

        try {
          console.log("Attempting to authenticate with:", url);
          console.log("Backend URL from env:", {
            BACKEND_URL: process.env.BACKEND_URL,
            NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
            resolved: backendUrl,
          });

          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify({
              username: credentials.username,
              password: credentials.password,
            }),
          });

          console.log("Response status:", response.status);
          console.log("Response ok:", response.ok);
          console.log(
            "Response headers:",
            Object.fromEntries(response.headers.entries())
          );

          if (!response.ok) {
            let errorText = "";
            let errorJson = null;
            try {
              const contentType = response.headers.get("content-type");
              if (contentType && contentType.includes("application/json")) {
                errorJson = await response.json();
                errorText = JSON.stringify(errorJson, null, 2);
              } else {
                errorText = await response.text();
              }
            } catch (e) {
              errorText = "Could not read error response";
            }
            console.error("Auth failed:", {
              status: response.status,
              statusText: response.statusText,
              error: errorText,
              errorJson,
            });
            return null;
          }

          const data = await response.json();
          // SECURITY: never log the raw auth response — it carries the access &
          // refresh JWTs. (The redacted `user` object is logged below.)

          if (data.access) {
            // Сохраняем информацию о пользователе из ответа бэкенда
            // Новый формат: { access, refresh, user: { id, username, email, role: { code, name, scope: {...} } } }
            const userInfo = data.user || {};
            console.log("User info from backend:", userInfo);

            const user = {
              id: userInfo.id?.toString() || credentials.username,
              email:
                userInfo.email !== undefined
                  ? userInfo.email
                  : credentials.username || "",
              name:
                userInfo.username ||
                credentials.username.split("@")[0] ||
                credentials.username,
              accessToken: data.access,
              refreshToken: data.refresh,
              role: userInfo.role || null, // role: { code, name, scope: { id, name, level, source } }
              userData: userInfo, // Полный объект user из ответа API
            };

            console.log("Returning user:", {
              ...user,
              accessToken: "[REDACTED]",
              refreshToken: "[REDACTED]",
            });
            return user;
          }

          console.error("No access token in response");
          return null;
        } catch (error) {
          console.error("Auth error:", error);
          if (error instanceof Error) {
            console.error("Error message:", error.message);
            console.error("Error stack:", error.stack);
            // Проверяем, является ли это сетевой ошибкой
            if (
              error.message.includes("fetch failed") ||
              error.message.includes("ECONNREFUSED")
            ) {
              console.error(
                "Network error: Cannot connect to backend. Check if backend is running at:",
                backendUrl
              );
            }
          }
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.accessToken = (user as any).accessToken;
        token.refreshToken = (user as any).refreshToken;
        token.id = user.id;
        token.role = (user as any).role;
        token.userData = (user as any).userData;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.accessToken = token.accessToken as string;
        (session.user as any).role = token.role;
        (session.user as any).userData = token.userData;
      }
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
  session: {
    strategy: "jwt",
  },
  // Fail-closed, как у бэкенда (прод без VAPS_SECRET_KEY не стартует):
  // известный фолбэк в проде позволял бы подписывать чужие сессии всем, кто
  // прочитал репозиторий. В dev секрет разрешён дефолтом — он подписывает
  // только локальные сессии разработчика.
  secret: resolveNextAuthSecret(),
};

function resolveNextAuthSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXTAUTH_SECRET не задан: прод без секрета подписи сессий не стартует."
    );
  }
  return "dev-local-secret";
}
