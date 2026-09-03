"use client";

// «Правка бюллетеня»: окно по иконке карандаша в строке реестра (Plane №192).
// Требование заказчика дословно: «Нету кнопки Редактировать. После плюсика,
// поставить иконку для редактирования».
//
// ПОЧЕМУ ОТДЕЛЬНОЕ ОКНО, А НЕ `CreateSecurityEventDialog` В РЕЖИМЕ ПРАВКИ.
// Состав полей у них РАЗНЫЙ, и разный не по недосмотру:
//
// * ТИПА мероприятия здесь нет — от него зависят маршрут согласования и то,
//   кто считается старшим (наряда против ГВО). Смена типа на полпути означала
//   бы другую цепочку у мероприятия, которое уже идёт по этой;
// * ОБЪЕКТА здесь нет — у объектов посещения свои кнопки в той же строке, они
//   несут паспорта и расстановку, и правка «объекта мероприятия» рядом с ними
//   давала бы два способа сделать одно;
// * СТАРШЕГО здесь нет — у него своя кнопка в колонке «Старший» с №190 и своя
//   запись журнала.
//
// Окно создания с флагом «правка» пришлось бы читать вместе с этим флагом на
// каждом поле, а три невидимых в одном режиме поля — это не режим, а другая
// форма.
//
// ЧАСТИЧНАЯ ручка, но окно шлёт ВСЕ поля, включая пустые: сервер понимает
// «ключа нет» как «не трогай», а пустую строку — как «очисти», и человек,
// стерший локацию, ждёт, что она сотрётся.
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, focusFirstError, focusFirstOf, useZodForm } from "@/shared/lib/form";
import { useToast } from "@/shared/hooks/use-toast";
import { useUpdateBulletinDetails } from "@/hooks/use-create-security-event";
import { useProtectedPersons } from "@/hooks/use-protected-persons";
import { LocationFields } from "./LocationFields";
import { PersonDetailsFields, detailsOf } from "./PersonDetailsFields";
import type { PersonDetailsMap } from "./PersonDetailsFields";
import type { SecurityEvent } from "@/entities/security-event";
import { ProtectedPersonsPicker } from "./ProtectedPersonsPicker";

const LABEL_CLASS = "text-[11.5px] font-bold text-muted-foreground";
const CONTROL_CLASS = "h-10 rounded-lg";
const SELECT_CLASS =
  "h-10 w-full rounded-lg border border-input bg-background px-2.5 text-sm " +
  "outline-none transition-[color,box-shadow] focus-visible:border-ring " +
  "focus-visible:ring-ring/50 focus-visible:ring-[3px] " +
  "aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50";
const HINT_CLASS = "text-[11px] text-muted-foreground";

const formSchema = z
  .object({
    title: z.string().trim().min(1, "Обязательное поле."),
    businessDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите дату в формате ГГГГ-ММ-ДД."),
    businessDateEnd: z
      .string()
      .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Укажите дату в формате ГГГГ-ММ-ДД."),
    eventTime: z
      .string()
      .regex(/^(\d{2}:\d{2})?$/, "Укажите время в формате ЧЧ:ММ."),
    // Список, а не одно лицо (Plane №188). Первое — главное.
    protectedPersonIds: z.array(z.string()),
    // Локация структурой (Plane №418); строку собирает сервер.
    countryId: z.string(),
    cityId: z.string(),
    address: z.string().max(255, "Не длиннее 255 символов."),
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

/** Лица мероприятия в порядке «главное первым».
 *
 * Сервер отдаёт список отсортированным ПО ИМЕНИ — у связи своего порядка нет.
 * Форме же порядок значим: первое лицо становится главным при сохранении.
 * Без этой перестановки открытое и тут же сохранённое окно меняло бы главное
 * лицо молча — на то, чьё имя раньше по алфавиту.
 */
function orderedPersonIds(event: SecurityEvent): string[] {
  const rest = event.protectedPersons
    .map((person) => person.id)
    .filter((id) => id !== event.protectedPersonId);
  return event.protectedPersonId === null
    ? rest
    : [event.protectedPersonId, ...rest];
}

/** Значения формы ИЗ МЕРОПРИЯТИЯ, а не из пустого бланка: правка начинается с
 * того, что стоит сейчас, иначе «сохранить» стёрло бы всё, чего не тронули. */
function valuesOf(event: SecurityEvent): FormValues {
  return {
    title: event.title,
    businessDate: event.businessDate,
    businessDateEnd: event.businessDateEnd ?? "",
    eventTime: event.eventTime ?? "",
    // Список берётся из `protectedPersons`, а главное лицо ставится ПЕРВЫМ:
    // сервер отдаёт список отсортированным по имени, и без этой перестановки
    // открытое и сразу сохранённое окно молча меняло бы главное лицо.
    protectedPersonIds: orderedPersonIds(event),
    countryId: event.countryId ?? "",
    cityId: event.cityId ?? "",
    address: event.address,
  };
}

export function EditBulletinDialog({
  event,
  open,
  onClose,
}: {
  event: SecurityEvent;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const personsQuery = useProtectedPersons();
  const form = useZodForm(formSchema, valuesOf(event));
  // Атрибуты визита лиц (Plane №418) — вне zod-формы: строк столько, сколько
  // отмечено лиц, и состав меняется по ходу правки.
  const [personDetails, setPersonDetails] = useState<PersonDetailsMap>(() =>
    detailsOf(event.protectedPersons)
  );
  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = form;

  // Открыли окно — начинаем с ТЕКУЩИХ значений мероприятия. Без этого второе
  // открытие показывало бы черновик первого, в том числе после отмены.
  useEffect(() => {
    if (open) {
      reset(valuesOf(event));
      setPersonDetails(detailsOf(event.protectedPersons));
    }
  }, [open, event, reset]);

  // Окно закрывается ОТВЕТОМ сервера, а не кликом: отказ («закрытое
  // мероприятие», «лицо не найдено») человек должен увидеть здесь же.
  const saved = useUpdateBulletinDetails(event.id, {
    // 400-канал бэка кладёт ошибки В ПОЛЯ: «проверьте форму» без указания
    // поля заставляет человека искать самому.
    onFormError: (details) => {
      const named = Object.keys(details);
      for (const [field, messages] of Object.entries(details)) {
        const text = Array.isArray(messages) ? String(messages[0]) : String(messages);
        setError(field as keyof FormValues, { type: "server", message: text });
      }
      // `focusFirstOf`, а не `focusFirstError`: объект ошибок в этом
      // замыкании ещё старый — свежий придёт только со следующим рендером,
      // а поля, отмеченные сервером, известны прямо здесь.
      focusFirstOf(named);
    },
  });

  const save = saved;
  useEffect(() => {
    if (save.data !== undefined) {
      toast({ title: `Бюллетень ${event.code} изменён` });
      onClose();
    }
    // `save.data` — единственный признак успеха у этого хука; следить за ним
    // эффектом дешевле, чем заводить свой `onSuccess` рядом с тем, что уже
    // кладёт ответ в кэш.
  }, [save.data, event.code, onClose, toast]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {/* Шире прежнего (`3xl`): таблица атрибутов лиц (Plane №418) в 2xl
          прокручивалась уже на двух лицах. */}
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Правка бюллетеня</DialogTitle>
          <DialogDescription>
            {event.code}. Здесь правятся сведения бюллетеня. Тип мероприятия,
            объекты посещения и старший меняются не здесь: тип задаёт маршрут
            согласования, у объектов и старшего свои кнопки в строке.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          noValidate
          onSubmit={(submitEvent) =>
            void handleSubmit(
              (values) =>
                save.mutate({
                  ...values,
                  // Только отмеченные лица: у снятого атрибутов больше нет.
                  protectedPersonDetails: values.protectedPersonIds
                    .map((id) => personDetails[id])
                    .filter((row) => row !== undefined),
                }),
              (invalid) => focusFirstError(invalid)
            )(submitEvent)
          }
        >
          <Field
            name="title"
            label="Название мероприятия"
            labelClassName={LABEL_CLASS}
            error={errors.title}
            className="space-y-1.5"
          >
            {(field) => (
              <Input {...field} className={CONTROL_CLASS} {...register("title")} />
            )}
          </Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              name="businessDate"
              label="Дата начала"
              labelClassName={LABEL_CLASS}
              error={errors.businessDate}
              className="space-y-1.5"
            >
              {(field) => (
                <Input
                  {...field}
                  type="date"
                  className={CONTROL_CLASS}
                  {...register("businessDate")}
                />
              )}
            </Field>
            <Field
              name="businessDateEnd"
              label="Дата окончания"
              labelClassName={LABEL_CLASS}
              hint="Пусто — однодневное"
              hintClassName={HINT_CLASS}
              error={errors.businessDateEnd}
              className="space-y-1.5"
            >
              {(field) => (
                <Input
                  {...field}
                  type="date"
                  className={CONTROL_CLASS}
                  {...register("businessDateEnd")}
                />
              )}
            </Field>
            <Field
              name="eventTime"
              label="Время"
              labelClassName={LABEL_CLASS}
              hint="Пусто — час не назван"
              hintClassName={HINT_CLASS}
              error={errors.eventTime}
              className="space-y-1.5"
            >
              {(field) => (
                <Input
                  {...field}
                  type="time"
                  className={CONTROL_CLASS}
                  {...register("eventTime")}
                />
              )}
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              name="protectedPersonIds"
              label="Охраняемые лица"
              labelClassName={LABEL_CLASS}
              hint="Первое в списке — главное: оно печатается в бланке бюллетеня"
              hintClassName={HINT_CLASS}
              error={errors.protectedPersonIds}
              className="space-y-1.5"
            >
              {/* `id` берётся у самого `Field`: он же стоит в `htmlFor`
                  подписи и в связке с текстом ошибки. Свой литерал здесь
                  разошёлся бы с ними при первом переименовании поля. */}
              {(control) => (
                <ProtectedPersonsPicker
                  selectId={control.id}
                  value={watch("protectedPersonIds") ?? []}
                  onChange={(next) =>
                    setValue("protectedPersonIds", next, { shouldDirty: true })
                  }
                  options={personsQuery.data?.results ?? []}
                  loading={personsQuery.isPending}
                />
              )}
            </Field>

            <LocationFields
              countryId={watch("countryId")}
              cityId={watch("cityId")}
              onCountry={(next) => {
                setValue("countryId", next, { shouldDirty: true });
                setValue("cityId", "", { shouldDirty: true });
              }}
              onCity={(next) => setValue("cityId", next, { shouldDirty: true })}
              addressField={
                <Field
                  name="address"
                  label="Адрес / место"
                  labelClassName={LABEL_CLASS}
                  error={errors.address}
                  className="space-y-1.5"
                >
                  {(field) => (
                    <Input
                      {...field}
                      className={CONTROL_CLASS}
                      {...register("address")}
                    />
                  )}
                </Field>
              }
              labelClassName={LABEL_CLASS}
              selectClassName={SELECT_CLASS}
            />
          </div>

          <PersonDetailsFields
            persons={event.protectedPersons}
            selectedIds={watch("protectedPersonIds") ?? []}
            value={personDetails}
            onChange={setPersonDetails}
            labelClassName={LABEL_CLASS}
            controlClassName={CONTROL_CLASS}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" disabled={isSubmitting || save.isPending}>
              {save.isPending ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
