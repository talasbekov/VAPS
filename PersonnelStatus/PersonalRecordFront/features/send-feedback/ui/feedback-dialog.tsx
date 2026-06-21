import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/shared/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface FeedbackDialogProps {
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function FeedbackDialog({
  children,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: FeedbackDialogProps) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("suggestion");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : open;
  const onOpenChange = isControlled ? controlledOnOpenChange : setOpen;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    setIsSubmitting(true);

    try {
      // Имитация запроса к API
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Здесь будет реальный вызов API:
      // await apiClient.sendFeedback({ type, message });
      
      console.log("Feedback submitted:", { type, message });

      toast({
        title: "Спасибо за отзыв!",
        description: "Ваше сообщение успешно отправлено. Мы обязательно его рассмотрим.",
      });

      setMessage("");
      setType("suggestion");
      onOpenChange?.(false);
    } catch (error) {
      console.error("Error submitting feedback:", error);
      toast({
        title: "Ошибка",
        description: "Не удалось отправить сообщение. Попробуйте позже.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Обратная связь</DialogTitle>
          <DialogDescription>
            Здесь вы можете оставить свои предложения по улучшению системы или сообщить об ошибке.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6 py-4">
          <div className="space-y-2">
            <Label htmlFor="type" className="text-base">Тип обращения</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="type" className="h-12 text-base">
                <SelectValue placeholder="Выберите тип" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="suggestion" className="text-base py-2">Предложение</SelectItem>
                <SelectItem value="bug" className="text-base py-2">Ошибка (Баг)</SelectItem>
                <SelectItem value="question" className="text-base py-2">Вопрос</SelectItem>
                <SelectItem value="other" className="text-base py-2">Другое</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="message" className="text-base">Сообщение</Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Опишите вашу идею или проблему подробно..."
              className="min-h-[200px] text-base resize-y"
              required
            />
            <p className="text-sm text-muted-foreground">
              Мы внимательно читаем все обращения и стараемся сделать систему лучше для вас.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange?.(false)}
              disabled={isSubmitting}
              className="h-11 px-8"
            >
              Отмена
            </Button>
            <Button type="submit" disabled={isSubmitting || !message.trim()} className="h-11 px-8">
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Отправить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

