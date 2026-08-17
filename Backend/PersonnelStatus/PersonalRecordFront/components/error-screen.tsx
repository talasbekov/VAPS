"use client";

// Общий экран сбоя рендера для границ ошибок App Router (app/error.tsx и
// app/security-ops/error.tsx).
//
// Намеренно НЕ оборачивается в DashboardLayout: граница ловит в том числе
// падения самого лэйаута (сайдбар, шапка, провайдеры), и попытка отрисовать
// его повторно уронила бы уже сам экран ошибки. Отсюда же — минимум
// зависимостей: только Card/Button и токены темы.
//
// Технический текст ошибки скрыт под <details>: наружу он уезжает сырым
// (стек, имена полей API), а человеку нужен не он, а кнопка «повторить».
import type { ReactElement } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface ErrorScreenProps {
  error: Error & { digest?: string };
  /** reset() границы: перемонтирует упавший сегмент без перезагрузки страницы. */
  reset: () => void;
  /** Куда ведёт запасной выход, если повтор не помогает. */
  homeHref: string;
  homeLabel: string;
}

export function ErrorScreen({
  error,
  reset,
  homeHref,
  homeLabel,
}: ErrorScreenProps): ReactElement {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardContent className="space-y-4 p-6 text-center">
          <AlertTriangle
            className="mx-auto h-10 w-10 text-muted-foreground"
            aria-hidden="true"
          />
          <h1 className="text-xl font-semibold text-foreground">
            Страница не открылась
          </h1>
          <p className="text-sm text-muted-foreground">
            Произошёл сбой при отображении. Данные не потеряны — попробуйте
            повторить. Если сбой повторяется, сообщите в поддержку
            {error.digest ? ` код ${error.digest}` : ""}.
          </p>

          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={reset}>Повторить</Button>
            <Button variant="outline" asChild>
              <Link href={homeHref}>{homeLabel}</Link>
            </Button>
          </div>

          <details className="text-left">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Техническая информация
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs text-muted-foreground">
              {error.message || "Сообщение об ошибке отсутствует"}
            </pre>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
