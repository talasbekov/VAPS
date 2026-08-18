"use client";

// Форма на react-hook-form + zod.
//
// Проверки у формы не было вовсе: «Отправить» просто гасла на пустом
// сообщении. Погашенная кнопка не объясняет, чего от человека хотят, — теперь
// правило живёт в схеме и говорит словами под полем.
import { useState } from "react";
import { Controller } from "react-hook-form";
import { z } from "zod";
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
import { Field, focusFirstError, useZodForm } from "@/shared/lib/form";

/** Поля — в порядке появления на экране: так схему проще читать. */
const feedbackSchema = z.object({
  type: z.string().min(1, "Выберите тип обращения."),
  message: z.string().trim().min(1, "Опишите идею или проблему."),
});

type FeedbackFormValues = z.infer<typeof feedbackSchema>;

const EMPTY_FEEDBACK_FORM: FeedbackFormValues = {
  type: "suggestion",
  message: "",
};

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
  const { toast } = useToast();

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useZodForm(feedbackSchema, EMPTY_FEEDBACK_FORM);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : open;
  const onOpenChange = isControlled ? controlledOnOpenChange : setOpen;

  const submit = async (values: FeedbackFormValues) => {
    try {
      // Имитация запроса к API
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Здесь будет реальный вызов API:
      // await apiClient.sendFeedback({ type, message });

      console.log("Feedback submitted:", values);

      toast({
        title: "Спасибо за отзыв!",
        description: "Ваше сообщение успешно отправлено. Мы обязательно его рассмотрим.",
      });

      reset(EMPTY_FEEDBACK_FORM);
      onOpenChange?.(false);
    } catch (error) {
      console.error("Error submitting feedback:", error);
      toast({
        title: "Ошибка",
        description: "Не удалось отправить сообщение. Попробуйте позже.",
        variant: "destructive",
      });
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
        <form
          onSubmit={(e) =>
            void handleSubmit(submit, (invalid) => focusFirstError(invalid))(e)
          }
          className="space-y-6 py-4"
          noValidate
        >
          <Field
            name="type"
            label="Тип обращения"
            error={errors.type}
            labelClassName="text-base"
          >
            {(field) => (
              <Controller
                control={control}
                name="type"
                render={({ field: input }) => (
                  <Select value={input.value} onValueChange={input.onChange}>
                    <SelectTrigger
                      {...field}
                      ref={input.ref}
                      onBlur={input.onBlur}
                      className="h-12 text-base"
                    >
                      <SelectValue placeholder="Выберите тип" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="suggestion" className="text-base py-2">Предложение</SelectItem>
                      <SelectItem value="bug" className="text-base py-2">Ошибка (Баг)</SelectItem>
                      <SelectItem value="question" className="text-base py-2">Вопрос</SelectItem>
                      <SelectItem value="other" className="text-base py-2">Другое</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            )}
          </Field>

          <Field
            name="message"
            label="Сообщение"
            required
            error={errors.message}
            hint="Мы внимательно читаем все обращения и стараемся сделать систему лучше для вас."
            labelClassName="text-base"
          >
            {(field) => (
              <Textarea
                {...field}
                placeholder="Опишите вашу идею или проблему подробно..."
                className="min-h-[200px] text-base resize-y"
                {...register("message")}
              />
            )}
          </Field>

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
            {/* Кнопка больше не гаснет на пустом поле: причину отказа
                объясняет сообщение под полем, а погашенная кнопка — нет. */}
            <Button type="submit" disabled={isSubmitting} className="h-11 px-8">
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Отправить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
