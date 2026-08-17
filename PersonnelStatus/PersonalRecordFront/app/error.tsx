"use client";

// Граница ошибок хостовых маршрутов (/dashboard, /employees, /statuses,
// /organization, /reports, …). До 17.08.2026 границ не было ни одной на 43
// маршрута: любой throw при рендере клиентского компонента ронял всё дерево
// в дефолтный экран Next без reset() и без объяснения.
import type { ReactElement } from "react";
import { ErrorScreen } from "@/components/error-screen";

export default function HostError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactElement {
  return (
    <ErrorScreen
      error={error}
      reset={reset}
      homeHref="/dashboard"
      homeLabel="К обзору"
    />
  );
}
