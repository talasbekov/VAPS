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
import { useEffect, useState, type ReactNode } from "react";
import { OpsNotificationBell } from "@/features/ops-notifications/notification-bell";
import { startOpsWs, stopOpsWs } from "@/lib/ops-ws";

export default function SecurityOpsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // динамический импорт: msw и мок-код не попадают в чанк, пока страница
    // раздела не открыта
    import("@/mocks/ops/browser")
      .then(({ startOpsMockWorker }) => startOpsMockWorker())
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    <>
      {children}
      <OpsNotificationBell />
    </>
  );
}
