"use client";

// Граница ошибок раздела ОМ. Отдельная от хостовой, потому что запасной выход
// у раздела свой: возвращать человека из /security-ops/* на /dashboard —
// значит выкидывать его из раздела целиком.
import type { ReactElement } from "react";
import { ErrorScreen } from "@/components/error-screen";

export default function SecurityOpsError({
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
      homeHref="/security-ops/command-center"
      homeLabel="В командный центр"
    />
  );
}
