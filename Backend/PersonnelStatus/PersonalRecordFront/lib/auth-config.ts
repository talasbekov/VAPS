import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import type { JWT } from "next-auth/jwt";
import { REFRESH_RETRY_MS, isTokenRejected, makeOnce } from "@/lib/refresh-policy";

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

/** Срок жизни refresh-токена на сервере (`SIMPLE_JWT.REFRESH_TOKEN_LIFETIME`,
 *  7 дней). Дублируется здесь потому, что клиент этого числа не спрашивает
 *  ниоткуда; разойдётся — вернётся дефект №383, поэтому число названо один раз
 *  и с указанием, где лежит первоисточник. */
const REFRESH_TOKEN_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

/** За сколько до истечения токен считается протухшим. Минута — запас на
 *  дорогу запроса и на расхождение часов клиента и сервера: токен, истекающий
 *  через две секунды, до бэкенда уже не доедет. */
const EXPIRY_SKEW_MS = 60_000;

/** Момент истечения access-токена (мс), прочитанный из самого токена.
 *
 *  Читаем `exp` ИЗ ТОКЕНА, а не считаем «сейчас + 8 часов»: срок задан
 *  настройкой сервера, и локальная копия этого числа разошлась бы с ним при
 *  первой же правке `ACCESS_TOKEN_LIFETIME`. `null` — прочитать не удалось;
 *  тогда токен считается протухшим (см. `isExpiring`), и его продлят. Лучше
 *  лишнее продление, чем 401 на каждом экране.
 */
function jwtExpiryMs(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const payload = raw.split(".")[1];
  if (payload === undefined) return null;
  try {
    const json = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    ) as { exp?: unknown };
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isExpiring(expires: unknown): boolean {
  if (typeof expires !== "number") return true;
  return Date.now() >= expires - EXPIRY_SKEW_MS;
}

/**
 * Продлить access-токен по refresh-токену.
 *
 * `ROTATE_REFRESH_TOKENS` на сервере выключен, поэтому ответ несёт только
 * `access`, а refresh остаётся прежним — переписывать его нечем и не нужно.
 *
 * Отказ НЕ МОЛЧИТ: в токен кладётся `error`, а `accessToken` снимается
 * совсем. Оставить мёртвый токен на месте значило бы вернуть ровно тот
 * симптом, из-за которого задача и появилась: клиент шлёт его дальше и
 * получает 401 на каждом экране, не понимая, что дело в сессии.
 *
 * 🔴 НО «ТОКЕН МЁРТВ» И «СЕТЬ ИКНУЛА» — РАЗНЫЕ ОТВЕТЫ (Plane №459). Раньше
 * все отказы сводились к одному `RefreshAccessTokenError`: 502 при
 * перезапуске Django, 504, `ECONNREFUSED`, заминка DNS были неотличимы от
 * «refresh-токен и правда не годен», а дальше клиент немедленно жёг сессию и
 * стирал cookie, в которой лежал ЖИВОЙ refresh-токен. Один перезапуск
 * бэкенда в рабочее время выкидывал из системы каждого, чей access-токен
 * попал в минутное окно продления, — и человек терял несохранённый экран, не
 * понимая за что.
 *
 * Мёртвым токен считается ТОЛЬКО по ответу сервера «не годен» (400/401/403).
 * Временная беда — 5xx, сеть, нечитаемое тело — оставляет сессию жить и
 * помечается `retryAfter`: повтор будет, но не чаще раза в
 * `REFRESH_RETRY_MS`.
 */
/** Чем кончилось ОДНО обращение к `/api/token/refresh/`. */
type RefreshOutcome =
  | { kind: "ok"; access: string }
  | { kind: "rejected" }
  | { kind: "retry"; why: string };

/**
 * Идущие продления, по одному на refresh-токен (Plane №465, №474).
 *
 * 🔴 ЗАЧЕМ. Колбэк `jwt` отрабатывает на КАЖДЫЙ запрос `/api/auth/session`, а
 * таких за один обход портала около полутора сотен (замер записан в шапке
 * `lib/access-token.ts`). Как только токен вошёл в окно продления, каждый
 * такой запрос независимо слал свой POST и писал свою cookie — побеждал
 * последний ответ. Если один из них отказал (5xx, троттлинг, обрыв) и пришёл
 * последним, его cookie затирала только что записанную удачным соседом, и
 * человека выкидывало на вход при полностью здоровом бэке.
 *
 * Вторая, отложенная беда: `BLACKLIST_AFTER_ROTATION=True` в настройках уже
 * стоит. В день, когда включат `ROTATE_REFRESH_TOKENS`, второй параллельный
 * запрос принесёт уже отозванный refresh — и выкинет человека на ровном
 * месте. Связь между двумя настройками и этим кодом не была записана нигде,
 * поэтому включили бы её не глядя. Теперь она записана здесь, и продление
 * одно на токен.
 *
 * Кэшируется ИСХОД, а не готовый JWT: у каждого вызывающего свой объект
 * токена, и раздать им один чужой значило бы перепутать поля сессий.
 */
const onlyOneRefresh = makeOnce<RefreshOutcome>();

async function askBackend(refreshToken: string): Promise<RefreshOutcome> {
  try {
    const response = await fetch(`${getBackendUrl()}/api/token/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ refresh: refreshToken }),
    });
    if (!response.ok) {
      if (!isTokenRejected(response.status)) {
        return { kind: "retry", why: `HTTP ${response.status}` };
      }
      console.error("Token refresh failed:", response.status);
      return { kind: "rejected" };
    }
    const data = (await response.json()) as { access?: string };
    if (typeof data.access !== "string" || data.access === "") {
      // Сервер ответил 200, но без токена — это его беда, а не мёртвый
      // refresh: жечь сессию не за что.
      return { kind: "retry", why: "200 без поля access" };
    }
    return { kind: "ok", access: data.access };
  } catch (error) {
    // Сюда попадают сетевые беды: сервер не ответил вовсе. Прежний код и
    // здесь говорил «войдите заново» — это и есть дефект №459.
    console.error("Token refresh error:", error);
    return { kind: "retry", why: "сеть недоступна" };
  }
}

async function refreshed(token: JWT): Promise<JWT> {
  const refreshToken = token.refreshToken;
  if (typeof refreshToken !== "string" || refreshToken === "") {
    return { ...token, accessToken: undefined, error: "RefreshAccessTokenError" };
  }
  const outcome = await onlyOneRefresh(refreshToken, () => askBackend(refreshToken));
  if (outcome.kind === "ok") {
    const next: JWT = {
      ...token,
      accessToken: outcome.access,
      accessTokenExpires: jwtExpiryMs(outcome.access),
    };
    delete next.error;
    return next;
  }
  if (outcome.kind === "rejected") {
    return { ...token, accessToken: undefined, error: "RefreshAccessTokenError" };
  }
  // Временный отказ: токен НЕ жжём, но и не долбим сервер без паузы.
  console.warn("Token refresh postponed:", outcome.why);
  const next: JWT = { ...token, accessTokenExpires: Date.now() + REFRESH_RETRY_MS };
  delete next.error;
  return next;
}

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
        token.accessTokenExpires = jwtExpiryMs((user as any).accessToken);
        token.id = user.id;
        token.role = (user as any).role;
        token.userData = (user as any).userData;
        delete token.error;
        return token;
      }
      // 🔴 ЗДЕСЬ И БЫЛ ДЕФЕКТ (Plane №383). Колбэк зовётся при КАЖДОМ
      // обращении к сессии, но всё, что не вход, раньше просто возвращало
      // токен как есть — то есть протухший `accessToken` жил в живой сессии
      // до её конца. Сессия действует 30 дней (было — по умолчанию), а
      // access-токен восемь часов: через восемь часов портал открывался как
      // рабочий, а КАЖДЫЙ запрос к бэку отвечал 401. Заказчик сказал «не
      // работает проект» на полностью здоровом стенде.
      if (!isExpiring(token.accessTokenExpires)) return token;
      return await refreshed(token);
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.accessToken = token.accessToken as string;
        (session.user as any).role = token.role;
        (session.user as any).userData = token.userData;
      }
      // Отказ продления виден КЛИЕНТУ: сессия с этим полем означает «войти
      // заново», и портал обязан отвести человека на форму входа, а не
      // показывать пустые экраны с «не удалось загрузить».
      if (token?.error !== undefined) (session as any).error = token.error;
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
  session: {
    strategy: "jwt",
    // 🔴 СЕССИЯ НЕ ЖИВЁТ ДОЛЬШЕ REFRESH-ТОКЕНА. По умолчанию NextAuth даёт
    // тридцать дней, а `REFRESH_TOKEN_LIFETIME` бэкенда — семь
    // (`config/settings/base.py`). Оставь тридцать — и на восьмой день
    // вернулась бы та же болезнь: сессия жива, продлить нечем, портал молча
    // мёртв. Семь дней означают «пока сессия действует, продление возможно».
    maxAge: REFRESH_TOKEN_LIFETIME_SECONDS,
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
