"use client";

// Layout сегмента /security-ops: поднимает host-MSW ДО рендера страниц
// (иначе первые запросы TanStack Query уйдут в сеть до готовности перехвата)
// и монтирует Toaster для канала 5xx-тостов use-ops-mutation.
// DashboardLayout страницы оборачивают сами — по конвенции остальных страниц.
import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";

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
      <Toaster />
    </>
  );
}
