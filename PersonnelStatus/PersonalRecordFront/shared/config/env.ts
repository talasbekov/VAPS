// URL бэкенда для API запросов
// В dev используем полный URL бэкенда
// В prod используем пустую строку - все запросы идут через Next.js rewrites
export const BACKEND_URL = (() => {
  const isProduction = process.env.NODE_ENV === "production";

  // В продакшене всегда используем относительные пути
  // Next.js rewrites (в next.config.js) проксируют все /api/* на backend
  // Это работает и на сервере, и на клиенте
  if (isProduction) {
    console.log("🔧 [BACKEND_URL] Production mode: using Next.js rewrites (empty baseUrl)");
    return "";  // Rewrites: /api/employees → next.js → BACKEND_URL/api/employees
  }

  // В dev используем полный URL бэкенда
  const url =
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.BACKEND_URL ||
    "http://localhost:8100";

  console.log("🔧 [BACKEND_URL] Development mode:", url);
  return url.replace(/\/+$/, "");
})();
