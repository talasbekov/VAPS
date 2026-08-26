"use client";

// Layout сегмента /security-ops: поднимает host-MSW ДО рендера страниц
// (иначе первые запросы TanStack Query уйдут в сеть до готовности перехвата),
// запускает транспорт уведомлений и колокольчик раздела.
// DashboardLayout страницы оборачивают сами — по конвенции остальных страниц.
//
// Toaster отсюда СНЯТ и поднят в корневой app/layout.tsx. Пока он стоял
// только здесь, канал 5xx-тостов use-ops-mutation работал в этом разделе и
// молчал на хостовых страницах: там `toast()` вызывался, а окна не было.
// Оставить второй Toaster здесь нельзя — стор тостов модульный синглтон
// (use-toast.ts), и каждый смонтированный Toaster показал бы своё окно.
//
// Здесь же — единственный владелец экрана «права не удалось проверить».
// Гейт каждой страницы (`!isLoading && !hasPermission`) не отличает 403 от
// 500: и то и другое даёт пустой набор прав и надпись «Недостаточно прав».
// Ставить развилку в 22 страницы означало бы 22 копии одного условия, тогда
// как запрос прав ['ops-me'] у них общий — достаточно одного гейта на
// сегмент. Честный 403 сюда НЕ попадает и обрабатывается страницами как
// прежде (OpsAccessDenied).
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { OpsNotificationBell } from "@/features/ops-notifications/notification-bell";
import {
  OpsPermissionsUnavailable,
  isPermissionsCheckFailure,
} from "@/components/ops-permissions-unavailable";
import { useOpsMockWorker } from "@/hooks/use-ops-mock-worker";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { startOpsWs, stopOpsWs } from "@/lib/ops-ws";

export default function SecurityOpsLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Старт мок-слоя — общий хук: тот же мок нужен экранам доступа на
  // /settings/*, и две копии эффекта разошлись бы при первой правке.
  const ready = useOpsMockWorker();
  const queryClient = useQueryClient();
  const { error: permissionsError, isLoading: permissionsLoading } =
    useOpsPermissions();
  const [isRetrying, setIsRetrying] = useState(false);

  useEffect(() => {
    // Транспорт стартует ПОСЛЕ готовности мок-слоя: его REST-инвалидации
    // должны попадать в перехват. start/stop идемпотентны (StrictMode).
    if (!ready) return;
    startOpsWs();
    return () => {
      stopOpsWs();
    };
  }, [ready]);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        Загрузка раздела…
      </div>
    );
  }

  // Проверяется ПОСЛЕ готовности мок-слоя: до неё запрос прав ещё не
  // отработал, и ветка всё равно не сработала бы.
  if (isPermissionsCheckFailure(permissionsError)) {
    return (
      <OpsPermissionsUnavailable
        isRetrying={isRetrying || permissionsLoading}
        onRetry={() => {
          setIsRetrying(true);
          queryClient
            .refetchQueries({ queryKey: ["ops-me"] })
            .finally(() => setIsRetrying(false));
        }}
      />
    );
  }

  return (
    <>
      {/* 🔴 `children` приходит от Next МАССИВОМ сегментов. Отрендеренный
          рядом с соседом (колокольчиком) он читается React как список, и
          на каждом экране раздела в консоль летело «Each child in a list
          should have a unique key» — ошибка в оверлее dev-режима, найдено
          22.08.2026. Именованный Fragment делает массив ЕДИНСТВЕННЫМ
          потомком, и обход списка не начинается. */}
      <Fragment key="ops-segment">{children}</Fragment>
      <OpsNotificationBell />
    </>
  );
}
