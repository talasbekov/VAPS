"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Bell, CheckCircle2, BellOff } from "lucide-react";
import {
  fetchUnreadNotifications,
  markAllRead,
  seenUntil,
  markNotificationRead,
  notificationKey,
  Notification,
} from "../api/notifications-api";
import { toast } from "@/shared/hooks/use-toast";
import { LoadFailure } from "@/components/load-failure";
import { fetchNotificationReport, reportDownloadEndpoint } from "../model/report-download";
import { OpsNotificationSync } from "@/features/ops-notifications/notification-bell";
import { useRatingNotifications } from "@/hooks/use-ops-ratings";
import { RATING_NOTIFICATION_TEXT, type RatingNotificationCode } from "@/entities/operational-rating";
import { formatIsoDateTime } from "@/shared/lib/date";

// Варианты анимации для списка уведомлений
const listVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, x: -20, height: 0 },
  visible: { 
    opacity: 1, 
    x: 0, 
    height: "auto",
    transition: {
      type: "spring" as const,
      stiffness: 300,
      damping: 24,
    },
  },
  exit: { 
    opacity: 0, 
    x: 20, 
    height: 0,
    transition: {
      duration: 0.2,
    },
  },
};

export function NotificationsDropdown() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [tab, setTab] = useState<"unread" | "rating">("unread");
  const downloadPending = useRef(false);

  const unreadQuery = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: fetchUnreadNotifications,
    staleTime: 30000,
  });

  const notifications = (unreadQuery.data?.items ?? []).filter(notification => !notification.is_read);
  const ratingQuery = useRatingNotifications();
  const ratingRows = ratingQuery.data?.results ?? [];
  const ratingFailed = Boolean(ratingQuery.error || ratingQuery.authorityError) || ratingQuery.readAccessBlocked;
  // Часть ленты не пришла — это НЕ отказ всего колокольчика (Plane №565):
  // строки, которые загрузились, показываются, а про недостающую половину
  // говорится прямо. Прятать её молча значило бы объявить «это всё, что есть».
  const partlyFailed = (unreadQuery.data?.failed.length ?? 0) > 0;

  const readMutation = useMutation({
    mutationFn: (notification: Notification) => markNotificationRead(notification),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    // Без onError клик «прочитано» тихо не срабатывал: уведомление
    // оставалось в списке, и это выглядело как залипший интерфейс.
    onError: () =>
      toast({
        title: "Не удалось отметить прочитанным",
        description: "Уведомление осталось непрочитанным. Попробуйте ещё раз.",
        variant: "destructive",
      }),
  });

  const markAllMutation = useMutation({
    // Граница «что человек видел» (Plane №566): отмечается лента ПО СОСТОЯНИЮ
    // НА ЭКРАНЕ, а не всё, что успело прилететь, пока панель открыта.
    mutationFn: () => markAllRead(seenUntil(notifications)),
    onSuccess: () => toast({ title: "Все уведомления прочитаны" }),
    onError: () =>
      toast({
        title: "Не удалось отметить все прочитанными",
        description: "Часть уведомлений могла остаться непрочитанной.",
        variant: "destructive",
      }),
    // 🔴 `onSettled`, А НЕ `onSuccess`. Ног у операции две, и отказ одной не
    // отменяет другую: под прежним `onSuccess` закоммитившаяся половина не
    // попадала на экран, потому что обновление списка не звалось вовсе, — и
    // экран расходился с сервером на все 30 секунд `staleTime`. Обновлять надо
    // в ОБОИХ исходах: после отказа состояние сервера тем более неизвестно.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  // Счётчик на колокольчике — по тому, что ДЕЙСТВИТЕЛЬНО пришло. При частичном
  // отказе он занижен, и об этом говорит строка в самом списке.
  const unreadCount = notifications.length;

  async function downloadReport(notification: Notification, endpoint: string) {
    if (downloadPending.current) return;
    downloadPending.current = true;
    setDownloading(notificationKey(notification));
    try {
      const { blob, filename } = await fetchNotificationReport(endpoint);
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      try {
        anchor.href = url;
        anchor.download = filename ?? "report";
        document.body.appendChild(anchor);
        anchor.click();
      } finally {
        anchor.remove();
        window.URL.revokeObjectURL(url);
      }
      readMutation.mutate(notification);
      toast({ title: "Отчёт скачан" });
    } catch {
      toast({ title: "Не удалось скачать отчёт", description: "Уведомление осталось непрочитанным. Нажмите на него ещё раз, чтобы повторить скачивание.", variant: "destructive" });
    } finally {
      downloadPending.current = false;
      setDownloading(null);
    }
  }

  return (
    <>
    <OpsNotificationSync />
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        {/* Имя у кнопки-иконки: без него колокольчик для скринридера и для
            проб — безымянная «кнопка» (Plane №402). Счётчик в имя не
            входит намеренно — он меняется, а имя должно быть стабильным. */}
        <Button
          variant="ghost"
          size="sm"
          className="relative"
          aria-label="Уведомления"
        >
          <motion.div
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
          >
            <Bell className="h-5 w-5" />
          </motion.div>
          <AnimatePresence mode="wait">
            {unreadCount > 0 && (
              <motion.div
                key={unreadCount}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ 
                  type: "spring" as const, 
                  stiffness: 500, 
                  damping: 15 
                }}
                className="absolute -top-1 -right-1"
              >
                {/* Красный, как в прототипе: бейдж уведомлений — сигнал «есть
                    несделанное», и синий (тот же цвет, что у ссылок и активного
                    пункта меню) в этой роли не читается. Трёхзначное число
                    распирает кружок в овал — с сотни показываем «99+». */}
                <Badge className="bg-destructive text-destructive-foreground h-[17px] min-w-[17px] rounded-full px-1 flex items-center justify-center text-[9px] font-bold tabular-nums">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </Badge>
              </motion.div>
            )}
          </AnimatePresence>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-96 max-h-[70vh] overflow-y-auto" align="end">
        <DropdownMenuLabel className="flex justify-between items-center">
          <span className="font-medium">Уведомления</span>
          {tab === "unread" && unreadCount > 0 && (
            <motion.div
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <Button
                variant="ghost"
                size="icon"
                onClick={() => markAllMutation.mutate()}
                disabled={markAllMutation.isPending}
                title="Отметить все как прочитанные"
              >
                {markAllMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
              </Button>
            </motion.div>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div role="tablist" aria-label="Разделы уведомлений" className="mb-2 grid grid-cols-2 gap-1 p-1">
          {([
            { key: "unread", label: "Непрочитанные" },
            { key: "rating", label: "Оценивание" },
          ] as const).map(item => (
            <DropdownMenuItem key={item.key} role="tab" id={`notification-tab-${item.key}`}
              data-notification-tab={item.key}
              aria-controls={`notification-panel-${item.key}`} aria-selected={tab === item.key}
              className={`justify-center text-sm ${tab === item.key ? "bg-primary/10 font-semibold text-primary-ink" : ""}`}
              onClick={() => setTab(item.key)}
              onKeyDown={event => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                event.stopPropagation();
                const next = item.key === "unread" ? "rating" : "unread";
                setTab(next);
                event.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-notification-tab="${next}"]`)?.focus();
              }}
              onSelect={event => { event.preventDefault(); setTab(item.key); }}>
              {item.label}
            </DropdownMenuItem>
          ))}
        </div>

        {tab === "rating" ? (
          <div role="tabpanel" id="notification-panel-rating" aria-labelledby="notification-tab-rating" className="p-2">
            <p className="mb-2 text-xs text-muted-foreground">Личная лента событий оценивания.</p>
            {ratingFailed ? (
              <LoadFailure what="события оценивания" onRetry={() => void ratingQuery.retryNotifications()}
                isRetrying={ratingQuery.isFetching} className="px-2" />
            ) : ratingQuery.isPending ? (
              <p className="py-4 text-sm text-muted-foreground">Загрузка событий оценивания…</p>
            ) : ratingQuery.data !== undefined && ratingRows.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">Событий оценивания пока нет.</p>
            ) : null}
            {ratingFailed && ratingRows.length > 0 && (
              <p className="mb-2 text-xs text-muted-foreground">Показаны ранее загруженные события.</p>
            )}
            {ratingRows.map(row => {
              const label = RATING_NOTIFICATION_TEXT[row.code as RatingNotificationCode] ?? "Событие оценивания";
              const content = <><span>{label}</span><span className="mt-1 text-xs text-muted-foreground">{formatIsoDateTime(row.createdAt)}</span></>;
              return row.deepLink ? (
                <DropdownMenuItem key={row.id} className="flex flex-col items-start py-3"
                  onSelect={() => { router.push(row.deepLink); setOpen(false); }}>
                  {content}
                </DropdownMenuItem>
              ) : <div key={row.id} className="flex flex-col items-start px-2 py-3 text-sm">{content}</div>;
            })}
          </div>
        ) : <div role="tabpanel" id="notification-panel-unread" aria-labelledby="notification-tab-unread">
        {unreadQuery.isLoading ? (
          <motion.div 
            className="flex justify-center py-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <Loader2 className="h-6 w-6 animate-spin" />
          </motion.div>
        ) : unreadQuery.isError ? (
          // «Уведомлений нет» и «список не пришёл» — разные факты; второй
          // раньше маскировался первым, и человек не узнавал о новых.
          <LoadFailure
            what="уведомления"
            onRetry={() => void unreadQuery.refetch()}
            isRetrying={unreadQuery.isFetching}
            className="items-center px-4 text-center"
          />
        ) : notifications.length === 0 && !partlyFailed ? (
          <motion.div 
            className="text-center text-muted-foreground py-6 flex flex-col items-center gap-2"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <BellOff className="h-8 w-8 opacity-50" />
            <span>Нет новых уведомлений</span>
          </motion.div>
        ) : (
          <motion.div
            variants={listVariants}
            initial="hidden"
            animate="visible"
          >
            {/* Отказ ОБЪЯВЛЯЕТСЯ, а не только окрашивается: `role="alert"`
                читает скринридер, а «Повторить» рядом — потому что человек
                пришёл сюда за списком, и уходить со страницы ради обновления
                ему незачем. */}
            {partlyFailed && (
              <div
                role="alert"
                className="flex items-center justify-between gap-2 px-4 py-2 text-xs text-destructive"
              >
                <span>Часть уведомлений не загрузилась — список неполный.</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto px-2 py-1 text-xs"
                  onClick={() => void unreadQuery.refetch()}
                  disabled={unreadQuery.isFetching}
                >
                  {unreadQuery.isFetching ? "Обновляем…" : "Повторить"}
                </Button>
              </div>
            )}
            <AnimatePresence mode="popLayout">
              {notifications.map((n: Notification, index: number) => (
                <motion.div
                  key={notificationKey(n)}
                  variants={itemVariants}
                  exit="exit"
                  layout
                >
                  <DropdownMenuItem
                    // Уведомление СО ССЫЛКОЙ ведёт туда, о чём сообщает
                    // (Plane №392): «выделите людей» без перехода к списку
                    // людей — половина уведомления. Для файлов сначала
                    // завершаем скачивание; отказ оставляет возможность повтора.
                    onSelect={(event) => {
                      const endpoint = reportDownloadEndpoint(n.link);
                      if (endpoint) {
                        event.preventDefault();
                        void downloadReport(n, endpoint);
                        return;
                      }
                      readMutation.mutate(n);
                      if (n.link) router.push(n.link);
                    }}
                    disabled={downloading !== null && reportDownloadEndpoint(n.link) !== null}
                    className="flex flex-col items-start space-y-0.5 py-3 cursor-pointer hover:bg-accent/50 transition-colors"
                  >
                    <motion.span 
                      className="font-medium text-primary-ink"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: index * 0.05 + 0.1 }}
                    >
                      {n.title}
                      {downloading === notificationKey(n) && <Loader2 aria-label="Скачивание отчёта" className="ml-2 inline h-4 w-4 animate-spin" />}
                    </motion.span>
                    <motion.span 
                      className="text-xs text-muted-foreground line-clamp-2"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: index * 0.05 + 0.15 }}
                    >
                      {n.message}
                    </motion.span>
                  </DropdownMenuItem>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
        </div>}
      </DropdownMenuContent>
    </DropdownMenu>
    </>
  );
}
