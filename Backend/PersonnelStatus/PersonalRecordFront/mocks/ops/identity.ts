// Mock-обработчик прав раздела ОМ: GET /api/operations/my-permissions/.
// Реального бэкенда у раздела нет (см. отчёт «чего не хватает на бэкенде») —
// мок отдаёт administратора-подобную персону с wildcard-правом, чтобы все
// портированные экраны были доступны в демо.
import { http, HttpResponse } from "msw";
import type { OpsMyPermissionsResponse } from "@/hooks/use-ops-permissions";

const DEMO_PERMISSIONS: OpsMyPermissionsResponse = {
  permissions: ["*"],
};

export const identityHandlers = [
  http.get("*/api/operations/my-permissions/", () =>
    HttpResponse.json(DEMO_PERMISSIONS)
  ),
];
