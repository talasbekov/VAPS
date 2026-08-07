"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send, User } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useSession } from "next-auth/react";
import { getFeedback, sendFeedback } from "../api/feedback-api";
import type { FeedbackMessage } from "../model/types";

export function FeedbackChat() {
  const [messages, setMessages] = useState<FeedbackMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Первая загрузка показывает лоадер, фоновые — нет. Ref, а не state: опрос
  // живёт внутри одного эффекта и не должен его перезапускать.
  const firstLoadRef = useRef(true);
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    const stopPolling = () => {
      if (interval !== undefined) {
        clearInterval(interval);
        interval = undefined;
      }
    };

    const loadMessages = async () => {
      try {
        // Не показываем лоадер при фоновом обновлении, только при первой загрузке
        if (firstLoadRef.current) setIsLoading(true);
        const response = await getFeedback(1, 100);
        if (cancelled) return;
        // Сортируем сообщения по дате (старые сверху)
        const sorted = response.results.sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        setMessages(sorted);
        setLoadError(null);
      } catch (error) {
        if (cancelled) return;
        // Раньше ошибка только писалась в консоль: опрос раз в 3 секунды
        // продолжался бесконечно (на стенде — сплошная очередь 404 к
        // /api/dictionaries/feedback/), а экран показывал «Пока нет сообщений»,
        // то есть выдавал отсутствующий бэкенд за пустой список. Останавливаем
        // опрос на первой же ошибке и показываем её.
        stopPolling();
        setLoadError(
          error instanceof Error ? error.message : "Неизвестная ошибка"
        );
      } finally {
        firstLoadRef.current = false;
        if (!cancelled) setIsLoading(false);
      }
    };

    void loadMessages();
    // Опрашиваем сервер каждые 3 секунды для получения новых сообщений
    interval = setInterval(() => void loadMessages(), 3000);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!newMessage.trim()) return;

    try {
      setIsSending(true);
      const sentMessage = await sendFeedback(newMessage);
      // Добавляем новое сообщение
      setMessages((prev) => [...prev, sentMessage]);
      setNewMessage("");
    } catch (error) {
      console.error("Failed to send feedback", error);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Card className="h-full flex flex-col w-full max-w-3xl mx-auto">
      <CardHeader>
        <CardTitle>Обратная связь</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-4 overflow-hidden p-4">
        <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 pr-2">
          {isLoading && messages.length === 0 ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            messages.map((msg) => {
              // Приводим к строке для надежного сравнения
              const isMine = String(msg.created_by) === String(currentUserId);

              return (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${
                    isMine ? "flex-row-reverse" : "flex-row"
                  }`}
                >
                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <User className="h-4 w-4" />
                  </div>
                  <div
                    className={`max-w-[80%] rounded-lg p-3 ${
                      isMine ? "bg-primary text-primary-foreground" : "bg-muted"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold opacity-90">
                        {msg.created_by_name}
                      </span>
                      <span className="text-[10px] opacity-70">
                        {format(new Date(msg.created_at), "HH:mm dd.MM", {
                          locale: ru,
                        })}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                  </div>
                </div>
              );
            })
          )}
          {!isLoading && messages.length === 0 && (
            <div className="text-center py-8">
              {loadError ? (
                // Не выдаём сбой за пустой список: при недоступном источнике
                // «Пока нет сообщений» неотличимо от «сообщений правда нет».
                <span className="text-destructive">
                  Лента недоступна: {loadError}. Обновление остановлено.
                </span>
              ) : (
                <span className="text-muted-foreground">Пока нет сообщений</span>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-2 mt-auto pt-2">
          <Textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Напишите сообщение..."
            className="min-h-[50px] max-h-[120px] resize-none"
          />
          <Button
            onClick={handleSend}
            disabled={isSending || !newMessage.trim()}
            className="h-auto"
          >
            {isSending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}








