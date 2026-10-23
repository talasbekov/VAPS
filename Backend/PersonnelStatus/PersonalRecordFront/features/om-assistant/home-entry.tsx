"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { moduleOpenFor } from "@/entities/portal-access";

export function AssistantHomeEntry({ accessReady, hasPermission, compact = false }: {
  accessReady: boolean;
  hasPermission: (code: string) => boolean;
  compact?: boolean;
}) {
  if (!accessReady || !moduleOpenFor("/security-ops/assistant", hasPermission)) return null;

  if (compact) return <Button asChild size="sm" variant="outline" className="h-auto min-h-10 whitespace-normal py-2"><Link href="/security-ops/assistant/">Подготовить наряд</Link></Button>;

  return (
    <section aria-label="Работа по ОМ" className="flex min-w-0 flex-col gap-3 rounded-md border bg-muted/20 p-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">Работа по ОМ</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Подготовьте поручение помощнику или продолжите сохранённое. В нём можно проверить следующий шаг и открыть связанное мероприятие.
        </p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 lg:shrink-0">
        <Button asChild size="sm" className="h-auto min-h-9 max-w-full whitespace-normal py-2 text-center">
          <Link href="/security-ops/assistant/">Поставить или продолжить поручение</Link>
        </Button>
        {moduleOpenFor("/security-ops/events", hasPermission) && (
          <Button asChild size="sm" variant="outline" className="h-auto min-h-9 max-w-full whitespace-normal py-2 text-center">
            <Link href="/security-ops/events/">Открыть мероприятия</Link>
          </Button>
        )}
      </div>
    </section>
  );
}
