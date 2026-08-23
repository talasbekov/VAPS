"use client";

// «Создать ОМ»: RHF + Zod, объект выбирается из реестра (без id объекта
// версию паспорта не к чему привязать). 400-канал бэка кладёт ошибки в поля
// через setError; успех — переход в карточку созданного ОМ.
//
// Форма была на RHF раньше остальных, но собирала поля вручную: `aria-invalid`
// и `aria-describedby` у неё не было ни у одного поля — текст ошибки лежал
// рядом и ни с чем не связан. Общий `Field` эту связку ставит сам.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
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
import { Field, focusFirstError, useZodForm } from "@/shared/lib/form";
import { useBindableObjects, useCreateSecurityEvent } from "@/hooks/use-create-security-event";

/** Поля — в порядке появления на экране: так схему проще читать. */
const formSchema = z
  .object({
    title: z.string().trim().min(1, "Обязательное поле."),
    objectId: z.string().trim().min(1, "Обязательное поле."),
    businessDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите дату в формате ГГГГ-ММ-ДД."),
    // Пусто — однодневное ОМ: поле НЕобязательное, и пустая строка не должна
    // краснеть как незаполненная.
    businessDateEnd: z
      .string()
      .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Укажите дату в формате ГГГГ-ММ-ДД."),
  })
  // Ту же пару сверяет сервер, но ждать от него отказа незачем: человек видит
  // обе даты на экране и вправе узнать о перевёрнутом периоде сразу.
  .refine(
    (values) =>
      values.businessDateEnd === "" ||
      values.businessDateEnd >= values.businessDate,
    {
      path: ["businessDateEnd"],
      message: "Дата окончания раньше даты начала.",
    }
  );

type FormValues = z.infer<typeof formSchema>;

const EMPTY_FORM: FormValues = {
  title: "",
  objectId: "",
  businessDate: "",
  businessDateEnd: "",
};

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
  } = useZodForm(formSchema, EMPTY_FORM);

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
          {/* Заголовок и надзаголовок эталона. Кнопка реестра называется
              «+ Создать бюллетень» — окно, открывающееся по ней, обязано
              называться так же, иначе человек не уверен, что попал куда хотел. */}
          <p className="text-primary-ink text-[10.5px] font-bold uppercase tracking-[.12em]">
            Новое охранное мероприятие
          </p>
          <DialogTitle>Создать бюллетень</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) =>
            void handleSubmit(
              (values) => mutation.mutate(values),
              (invalid) => focusFirstError(invalid)
            )(e)
          }
        >
          <Field name="title" label="Название ОМ" required error={errors.title}>
            {(field) => (
              <Input
                {...field}
                placeholder="Например, Международный экономический форум"
                {...register("title")}
              />
            )}
          </Field>

          <Field name="objectId" label="Объект" required error={errors.objectId}>
            {(field) => (
              <>
                <select
                  {...field}
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
                  <p className="text-xs text-destructive-ink" role="alert">
                    Реестр объектов недоступен — мероприятие нельзя привязать к
                    объекту.
                  </p>
                )}
              </>
            )}
          </Field>

          {/* Две даты рядом, как в эталоне: период мероприятия читается парой,
              а не двумя разрозненными полями. Окончание принимает и бэк
              (`business_date_end`), и реестр — колонка «Даты» показывает по
              нему продолжительность; до этой правки ввести его было негде, и
              каждое созданное вручную ОМ выходило однодневным. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              name="businessDate"
              label="Дата начала"
              required
              error={errors.businessDate}
            >
              {(field) => (
                <Input {...field} type="date" {...register("businessDate")} />
              )}
            </Field>

            <Field
              name="businessDateEnd"
              label="Дата окончания"
              hint="Пусто — мероприятие на один день"
              error={errors.businessDateEnd}
            >
              {(field) => (
                <Input {...field} type="date" {...register("businessDateEnd")} />
              )}
            </Field>
          </div>

          {mutation.error !== null && (
            <p className="text-sm text-destructive-ink" role="alert">
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
