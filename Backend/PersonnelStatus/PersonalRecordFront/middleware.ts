export { default } from "next-auth/middleware";

// Закрываются ХОСТОВЫЕ маршруты. Раздел /security-ops/* здесь намеренно НЕ
// перечислен: его права — плоские коды с бэка ОМ (useOpsPermissions), и без
// токена бэк отвечает 403 → гейт страницы закрывается сам. Добавление
// /security-ops в matcher сломало бы этот путь (см. комментарий в
// hooks/use-ops-permissions.ts).
//
// /reports, /settings, /feedback добавлены 17.08.2026: до этого они
// рендерились целиком без сессии, и единственной защитой был 403 бэкенда —
// то есть аноним видел рабочий экран выгрузки. /settings и /feedback —
// ре-экспорты страниц ОМ, их собственный гейт прав остаётся сверху.
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/employees/:path*",
    "/organization/:path*",
    "/statuses/:path*",
    "/reports/:path*",
    "/settings/:path*",
    "/feedback/:path*",
  ],
};
