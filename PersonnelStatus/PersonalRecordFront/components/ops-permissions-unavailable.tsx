"use client";

// Экран «права не удалось проверить» для раздела ОМ.
//
// Зачем отдельно от OpsAccessDenied. Гейт страниц устроен как
// `!isLoading && !hasPermission(code)` — то есть ЛЮБОЙ провал запроса
// ['ops-me'] даёт пустой набор прав и человек видит «Недостаточно прав».
// Для 403 это правда (бэк так и говорит «нельзя»), а для 500 и обрыва сети —
// ложь: права неизвестны, а не отсутствуют. Смотрелось это одинаково, и
// временный сбой бэкенда выглядел как отзыв доступа у 22 страниц раздела.
//
// Разделение проходит по типу ошибки, а не по коду вручную: OpsServerError
// (≥500) и OpsNetworkError (HTTP-ответа не было вовсе) — сбой; всё
// остальное, включая 403, остаётся честным отказом и сюда не попадает.
import type { ReactElement } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { OpsNetworkError, OpsServerError } from "@/lib/ops-errors";
import type { OpsApiFailure } from "@/lib/ops-errors";

/** Сбой проверки прав (в отличие от честного «нет доступа»). */
export function isPermissionsCheckFailure(
  error: OpsApiFailure | null
): boolean {
  return error instanceof OpsServerError || error instanceof OpsNetworkError;
}

export function OpsPermissionsUnavailable({
  onRetry,
  isRetrying,
}: {
  onRetry: () => void;
  isRetrying: boolean;
}): ReactElement {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardContent className="space-y-4 p-6 text-center">
          <AlertTriangle
            className="mx-auto h-10 w-10 text-muted-foreground"
            aria-hidden="true"
          />
          <h1 className="text-xl font-semibold text-foreground">
            Не удалось проверить права доступа
          </h1>
          <p className="text-sm text-muted-foreground">
            Раздел не открыт не потому, что доступ закрыт, — сервер не ответил
            на запрос прав. Повторите попытку.
          </p>
          <Button onClick={onRetry} disabled={isRetrying}>
            {isRetrying ? "Проверяем…" : "Повторить"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
