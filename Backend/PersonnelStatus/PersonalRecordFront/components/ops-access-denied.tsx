"use client";

// Экран отказа по правам для страниц раздела ОМ.
//
// Один владелец на весь раздел, а не копия в каждой странице: до этого гвард
// жил врукопашную в пяти страницах (events, objects, duties, command-center,
// calendar), а на остальных шестнадцати его не было вовсе — бэк отвечал 403,
// а пользователь видел пустой экран без объяснения. Смоук-обход 12.08.2026
// намерил 22 страницы с 403 при загрузке против 6 закрытых гвардом.
//
// Права раздела — плоские коды с бэка (`useOpsPermissions`), НЕ resource/action
// хоста из lib/auth.tsx: две системы прав сосуществуют, и путать их нельзя.
//
// Гвард ставится ПОСЛЕ хуков страницы (правило хуков React). Защищённые
// запросы нужно отдельно отключать через enabled, пока права загружаются
// или нужного права нет: один экран отказа не предотвращает запросы с 403.
import { useState, type ReactElement, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent } from "@/components/ui/card";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { isPermissionsCheckFailure, OpsPermissionsUnavailable } from "@/components/ops-permissions-unavailable";

interface OpsAccessDeniedProps {
  /**
   * Родительный падеж того, что закрыто: «реестра ОМ», «журнала аудита».
   * Подставляется в «Недостаточно прав для просмотра {what}.» — формулировка
   * дословно та же, что была в пяти страницах до выноса, и по ней же обход
   * опознаёт закрытый экран (e2e/smoke-buttons.spec.ts, `gated`).
   */
  what: string;
  actions?: ReactNode;
}

export function OpsAccessDenied({ what, actions }: OpsAccessDeniedProps): ReactElement {
  const { error, isLoading } = useOpsPermissions();
  const queryClient = useQueryClient();
  const [isRetrying, setIsRetrying] = useState(false);

  // A failed permission refresh revokes cached authority, but does not prove
  // that access was denied. Keep recovery available on every page gate.
  if (isPermissionsCheckFailure(error)) {
    return (
      <OpsPermissionsUnavailable
        isRetrying={isRetrying || isLoading}
        onRetry={() => {
          setIsRetrying(true);
          void queryClient.refetchQueries({ queryKey: ["ops-me"] })
            .finally(() => setIsRetrying(false));
        }}
      />
    );
  }

  return (
    <DashboardLayout>
      <Card>
        {/* Заголовок — словами заказчика (`[РЕЕ-09]`, Plane №422): экран
            без права отвечает «Доступ закрыт». Фраза под ним — прежняя: по
            ней закрытый экран опознают обход и пробы отказа. */}
        <CardContent className="p-9 text-center">
          <p className="text-base font-semibold" role="heading" aria-level={2}>
            Доступ закрыт
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Недостаточно прав для просмотра {what}.
          </p>
          {actions && <div className="mt-4">{actions}</div>}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
