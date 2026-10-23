"use client";

// Layout сегмента /security-ops: поднимает host-MSW ДО рендера страниц
// (иначе первые запросы TanStack Query уйдут в сеть до готовности перехвата),
// запускает транспорт уведомлений. Общий вход в ленту находится в шапке.
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
import { Fragment, useEffect, type ReactNode } from "react";
import { OpsPermissionBoundary } from "@/components/ops-permission-boundary";
import { useOpsMockWorker } from "@/hooks/use-ops-mock-worker";
import { startOpsWs, stopOpsWs } from "@/lib/ops-ws";

export default function SecurityOpsLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Старт мок-слоя — общий хук: тот же мок нужен экранам доступа на
  // /settings/*, и две копии эффекта разошлись бы при первой правке.
  const ready = useOpsMockWorker();

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

  return (
    <OpsPermissionBoundary>
      <Fragment key="ops-segment">{children}</Fragment>
    </OpsPermissionBoundary>
  );
}
