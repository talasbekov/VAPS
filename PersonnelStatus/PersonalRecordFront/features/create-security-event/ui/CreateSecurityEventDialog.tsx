"use client";

// «Создать ОМ»: RHF + Zod, объект выбирается из реестра (без id объекта
// версию паспорта не к чему привязать). 400-канал бэка кладёт ошибки в поля
// через setError; успех — переход в карточку созданного ОМ.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBindableObjects, useCreateSecurityEvent } from "@/hooks/use-create-security-event";

const formSchema = z.object({
  title: z.string().trim().min(1, "Обязательное поле."),
  objectId: z.string().trim().min(1, "Обязательное поле."),
  businessDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите дату в формате ГГГГ-ММ-ДД."),
});

type FormValues = z.infer<typeof formSchema>;

export interface CreateSecurityEventDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CreateSecurityEventDialog({
  open,
  onClose,
}: CreateSecurityEventDialogProps) {
  if (!open) return null;
  // размонтирование = закрытие: state формы не переживает переоткрытие
  return <OpenDialog onClose={onClose} />;
}

function OpenDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const objectsQuery = useBindableObjects();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  const mutation = useCreateSecurityEvent({
    onFormError: (details) => {
      for (const [field, value] of Object.entries(details)) {
        const message = Array.isArray(value) ? String(value[0]) : String(value);
        setError(field as keyof FormValues, { message });
      }
    },
  });

  useEffect(() => {
    if (mutation.data !== undefined) {
      router.push(`/security-ops/events/${mutation.data.id}`);
      onClose();
    }
  }, [mutation.data, router, onClose]);

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Создать охранное мероприятие</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => void handleSubmit((values) => mutation.mutate(values))(e)}
        >
          <div className="space-y-1">
            <Label htmlFor="om-title">Название</Label>
            <Input id="om-title" {...register("title")} />
            {errors.title && (
              <p className="text-xs text-destructive">{errors.title.message}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="om-object">Объект</Label>
            <select
              id="om-object"
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              defaultValue=""
              disabled={objectsQuery.isPending}
              {...register("objectId")}
            >
              <option value="">
                {objectsQuery.isPending
                  ? "Загрузка реестра…"
                  : "— выберите объект —"}
              </option>
              {(objectsQuery.data?.results ?? []).map((object) => (
                <option key={object.id} value={object.id}>
                  {/* отсутствие опубликованного паспорта названо прямо в списке:
                      узнать об этом после создания ОМ поздно; выбирать такой
                      объект при этом можно — вести мероприятие не запрещено */}
                  {object.code} · {object.name}
                  {object.publishedVersionCount === 0
                    ? " — паспорт не опубликован"
                    : ""}
                </option>
              ))}
            </select>
            {objectsQuery.isError && (
              <p className="text-xs text-destructive" role="alert">
                Реестр объектов недоступен — мероприятие нельзя привязать к
                объекту.
              </p>
            )}
            {errors.objectId && (
              <p className="text-xs text-destructive">{errors.objectId.message}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="om-date">Дата проведения</Label>
            <Input id="om-date" type="date" {...register("businessDate")} />
            {errors.businessDate && (
              <p className="text-xs text-destructive">
                {errors.businessDate.message}
              </p>
            )}
          </div>
          {mutation.error !== null && (
            <p className="text-sm text-destructive" role="alert">
              Не удалось создать мероприятие. Проверьте поля и попробуйте снова.
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Создание…" : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
