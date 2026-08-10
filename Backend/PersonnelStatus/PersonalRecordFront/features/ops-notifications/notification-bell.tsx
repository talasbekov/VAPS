"use client";

// Колокольчик уведомлений раздела ОМ + индикатор соединения. Живёт в layout
// /security-ops (плавающий виджет): host-шапку OLD не трогаем.
//
// Контракт канала: WS — СИГНАЛ «обнови», истина — REST. Кадр транспорта не
// кладётся в список напрямую: он инвалидирует запрос уведомлений, и список
// перечитывается с сервера. Бейдж считает КАДРЫ с момента закрытия панели —
// это «сколько нового пришло», а не состояние сервера.
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import {
  getOpsWsStatus,
  subscribeOpsWsMessages,
  subscribeOpsWsStatus,
} from "@/lib/ops-ws";
import type { OpsConnectionStatus } from "@/lib/ops-ws";
import { useRatingNotifications } from "@/hooks/use-ops-ratings";
import { RATING_NOTIFICATION_TEXT } from "@/entities/operational-rating";
import type { RatingNotificationCode } from "@/entities/operational-rating";

const STATUS_LABEL: Record<OpsConnectionStatus, string> = {
  idle: "канал не запущен",
  connecting: "подключение…",
  online: "онлайн",
  reconnecting: "переподключение…",
};

const STATUS_DOT: Record<OpsConnectionStatus, string> = {
  idle: "bg-muted-foreground/40",
  connecting: "bg-amber-400",
  online: "bg-green-500",
  reconnecting: "bg-amber-400",
};

function notificationText(code: string): string {
  return (
    RATING_NOTIFICATION_TEXT[code as RatingNotificationCode] ??
    "Событие раздела оценивания"
  );
}

function dateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("ru-RU");
}

export function OpsNotificationBell() {
  const queryClient = useQueryClient();
  // Статус — через useSyncExternalStore: снапшот транспорта — строковый
  // литерал, ссылка стабильна по построению.
  const status = useSyncExternalStore(
    subscribeOpsWsStatus,
    getOpsWsStatus,
    () => "idle" as const
  );
  const [open, setOpen] = useState(false);
  const [freshCount, setFreshCount] = useState(0);

  const query = useRatingNotifications();

  useEffect(() => {
    // Подписка ровно одна; unsubscribe в cleanup обязателен (StrictMode
    // монтирует эффект дважды).
    return subscribeOpsWsMessages((rows) => {
      setFreshCount((current) => current + rows.length);
      // Истина — REST: кадр лишь просит перечитать список.
      void queryClient.invalidateQueries({
        queryKey: ["ops-ratings", "notifications"],
      });
    });
  }, [queryClient]);

  const rows = query.data?.results ?? [];

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      {open && (
        <div className="w-96 max-w-[calc(100vw-2rem)] rounded-xl border bg-card p-4 shadow-lg">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">Уведомления ОМ</h2>
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span
                className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[status]}`}
                aria-hidden
              />
              {STATUS_LABEL[status]}
            </span>
          </div>
          {query.isLoading && (
            <p className="text-xs text-muted-foreground">Загрузка…</p>
          )}
          {query.data !== undefined && rows.length === 0 && (
            <p className="text-xs text-muted-foreground">Уведомлений нет.</p>
          )}
          {rows.length > 0 && (
            <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
              {rows.map((row) => (
                <li key={row.id} className="text-xs">
                  {row.deepLink === "" ? (
                    <span>{notificationText(row.code)}</span>
                  ) : (
                    <Link
                      className="underline"
                      href={row.deepLink}
                      onClick={() => setOpen(false)}
                    >
                      {notificationText(row.code)}
                    </Link>
                  )}
                  <span className="ml-2 text-muted-foreground">
                    {dateTime(row.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 border-t pt-2 text-[11px] text-muted-foreground">
            Кадр канала — сигнал «обнови»: список перечитывается с сервера, а не
            собирается из кадров.{" "}
            <Link
              className="underline"
              href="/security-ops/changelog"
              onClick={() => setOpen(false)}
            >
              Журнал изменений порта
            </Link>
          </p>
        </div>
      )}
      <button
        type="button"
        className="relative flex h-11 w-11 items-center justify-center rounded-full border bg-card shadow-lg hover:bg-muted"
        aria-label={`Уведомления ОМ (${STATUS_LABEL[status]})`}
        onClick={() => {
          setOpen((current) => !current);
          setFreshCount(0);
        }}
      >
        <Bell className="h-5 w-5" />
        <span
          className={`absolute right-1 top-1 inline-block h-2 w-2 rounded-full ${STATUS_DOT[status]}`}
          aria-hidden
        />
        {freshCount > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
            {freshCount}
          </span>
        )}
      </button>
    </div>
  );
}
