"use client";

// Layout раздела настроек. Единственная его работа — поднять host-MSW до
// первого запроса экранов доступа: они живут вне layout раздела ОМ, а мок
// стартовал только там. Без этого `NEXT_PUBLIC_OPS_MOCK_DOMAINS=access` не
// действовал на /settings/* вовсе — экраны шли в живой бэк, а мок-проба
// считала это проверкой мока (Plane №106, шаг «П-10»).
//
// В живом режиме `startOpsMockWorker` сразу разрешается и ничего не ставит:
// ветвление живёт внутри него, а не здесь.
import type { ReactNode } from "react";
import { useOpsMockWorker } from "@/hooks/use-ops-mock-worker";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const ready = useOpsMockWorker();

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        Загрузка раздела…
      </div>
    );
  }
  return <>{children}</>;
}
