"use client";

import { useState } from "react";
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
  markNotificationRead,
  Notification,
} from "../api/notifications-api";
import { toast } from "@/shared/hooks/use-toast";
import { LoadFailure } from "@/components/load-failure";

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

  const unreadQuery = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: fetchUnreadNotifications,
    staleTime: 30000,
  });

  const notifications = unreadQuery.data || [];

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
    mutationFn: markAllRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast({ title: "Все уведомления прочитаны" });
    },
    onError: () => toast({ title: "Ошибка", variant: "destructive" }),
  });

  const unreadCount = unreadQuery.data?.length ?? 0;

  return (
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
          {unreadCount > 0 && (
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
        ) : notifications.length === 0 ? (
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
            <AnimatePresence mode="popLayout">
              {notifications.map((n: Notification, index: number) => (
                <motion.div
                  key={n.id}
                  variants={itemVariants}
                  exit="exit"
                  layout
                >
                  <DropdownMenuItem
                    // Уведомление СО ССЫЛКОЙ ведёт туда, о чём сообщает
                    // (Plane №392): «выделите людей» без перехода к списку
                    // людей — половина уведомления. Отметка прочтения идёт
                    // тем же нажатием — человек его увидел.
                    onSelect={() => {
                      readMutation.mutate(n);
                      if (n.link) router.push(n.link);
                    }}
                    className="flex flex-col items-start space-y-0.5 py-3 cursor-pointer hover:bg-accent/50 transition-colors"
                  >
                    <motion.span 
                      className="font-medium text-primary-ink"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: index * 0.05 + 0.1 }}
                    >
                      {n.title}
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
