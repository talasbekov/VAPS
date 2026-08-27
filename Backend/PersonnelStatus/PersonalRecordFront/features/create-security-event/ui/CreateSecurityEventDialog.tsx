"use client";

// «Создать бюллетень»: RHF + Zod, форма эталона Smart Жоспарлау (окно по
// кнопке «+ Создать бюллетень» в реестре ОМ). 400-канал бэка кладёт ошибки в
// поля через setError; успех — переход в карточку созданного ОМ.
//
// Состав полей — из прототипа: название, ТИП МЕРОПРИЯТИЯ (от него зависят
// маршрут согласования и то, кто старший), период с необязательным временем,
// охраняемое лицо, локация, старший. Одно отклонение от эталона осознанное:
// «Объект» в окне ОСТАЁТСЯ (решение заказчика 23.08.2026) — по нему
// привязывается версия паспорта, без него расчёт постов не к чему привязать.
//
// Форма была на RHF раньше остальных, но собирала поля вручную: `aria-invalid`
// и `aria-describedby` у неё не было ни у одного поля — текст ошибки лежал
// рядом и ни с чем не связан. Общий `Field` эту связку ставит сам.
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
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
import { cn } from "@/lib/utils";
import { Field, focusFirstError, useZodForm } from "@/shared/lib/form";
import { ObjectPicker } from "./ObjectPicker";
import {
  useBindableObjects,
  useCreateSecurityEvent,
} from "@/hooks/use-create-security-event";
import { useProtectedPersons } from "@/hooks/use-protected-persons";
import { PersonnelPicker } from "@/features/personnel-picker";
import { ProtectedPersonsPicker } from "./ProtectedPersonsPicker";
import type { SecurityEventKind } from "@/entities/security-event";

const KINDS = ["INTERNAL", "FOREIGN"] as const;

const KIND_OPTIONS: ReadonlyArray<{ value: SecurityEventKind; label: string }> =
  [
    { value: "INTERNAL", label: "Внутреннее" },
    { value: "FOREIGN", label: "С участием иностранцев" },
  ];

/** Подсказка под переключателем типа: чем именно тип меняет ход мероприятия. */
const KIND_HINT: Record<string, string> = {
  "": "Обязательно к выбору — от типа зависит маршрут согласования и состав старших",
  INTERNAL:
    "Внутреннее мероприятие — объекты и посты определяются старшим наряда",
  FOREIGN:
    "Запись появится в реестре ГВО — старший ГВО заполнит сводку по данным МИД и выберет объекты посещения",
};

/** Локация по умолчанию — из эталона: почти все ОМ проходят в столице. */
const DEFAULT_LOCATION = "г. Астана";

/** Поля — в порядке появления на экране: так схему проще читать. */
const formSchema = z
  .object({
    title: z.string().trim().min(1, "Обязательное поле."),
    // Без сужения типа (`value is SecurityEventKind`) намеренно: значение
    // поля до выбора — пустая строка, и суженный тип не дал бы её в
    // начальные значения формы.
    kind: z
      .string()
      .refine(
        (value) => (KINDS as readonly string[]).includes(value),
        "Обязательное поле."
      ),
    businessDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите дату в формате ГГГГ-ММ-ДД."),
    // Пусто — однодневное ОМ: поле НЕобязательное, и пустая строка не должна
    // краснеть как незаполненная.
    businessDateEnd: z
      .string()
      .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Укажите дату в формате ГГГГ-ММ-ДД."),
    eventTime: z
      .string()
      .regex(/^(\d{2}:\d{2})?$/, "Укажите время в формате ЧЧ:ММ."),
    // Лиц может быть НЕСКОЛЬКО (Plane №188); первое — главное.
    protectedPersonIds: z.array(z.string()),
    location: z.string().max(255, "Не длиннее 255 символов."),
    // Объект НЕОБЯЗАТЕЛЕН (решение заказчика 24.08, ClickUp 86eyqf7a7):
    // бюллетень заводят до согласования маршрута, объекты дописывают позже
    // кнопкой у строки реестра.
    objectId: z.string(),
    chiefEmployeeId: z.string(),
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
  kind: "",
  businessDate: "",
  businessDateEnd: "",
  eventTime: "",
  protectedPersonIds: [],
  location: DEFAULT_LOCATION,
  objectId: "",
  chiefEmployeeId: "",
};

/** Подпись поля в эталоне: мелкая и жирная, а не как у остальных форм. */
const LABEL_CLASS = "text-[11.5px] font-bold text-muted-foreground";
/** Контролы эталона выше стандартных (40px) и с радиусом 8px. */
const CONTROL_CLASS = "h-10 rounded-lg";
const SELECT_CLASS =
  "h-10 w-full rounded-lg border border-input bg-background px-2.5 text-sm " +
  "outline-none transition-[color,box-shadow] focus-visible:border-ring " +
  "focus-visible:ring-ring/50 focus-visible:ring-[3px] " +
  "aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50";
/** Пояснение под полем — мельче текста ошибки, как в эталоне. */
const HINT_CLASS = "text-[11px] text-muted-foreground";

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
  const contentRef = useRef<HTMLDivElement>(null);
  const objectsQuery = useBindableObjects();
  const personsQuery = useProtectedPersons();

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    clearErrors,
    watch,
    formState: { errors },
  } = useZodForm(formSchema, EMPTY_FORM);

  const kind = watch("kind");
  const title = watch("title");
  const objectId = watch("objectId");
  const businessDate = watch("businessDate");
  const businessDateEnd = watch("businessDateEnd");
  const chiefEmployeeId = watch("chiefEmployeeId") ?? "";
  // Старший наряда или ГВО — по типу мероприятия: у визита иностранного лица
  // старший другой, и подпись поля обязана это называть до выбора, а не после.
  const foreign = kind === "FOREIGN";
  const chiefLabel = foreign ? "Старший ГВО" : "Старший наряда";
  const chiefHint = foreign
    ? "Визит иностранного охраняемого лица — назначается старший ГВО"
    : "Посещение городских объектов — назначается старший наряда";

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

  // Кнопка гаснет, пока обязательное не заполнено — как в эталоне. Но гасится
  // ВИДОМ, а не `disabled`: нажать её можно, и тогда форма скажет, чего именно
  // не хватает, вместо молчаливого тупика.
  const incomplete =
    title.trim() === "" || kind === "" || businessDate === "";

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent
        ref={contentRef}
        className="gap-0 p-[22px] sm:max-w-[560px]"
        // Фокус на САМО окно, а не на первое поле.
        //
        // 🔴 Штатный автофокус Radix вставал в «Название ОМ». Первый же клик
        // мимо него уводил фокус с пустого обязательного поля, проверка
        // `onTouched` показывала «Обязательное поле.», строка ошибки
        // раздвигала форму — и кнопка «Внутреннее» УЕЗЖАЛА из-под курсора
        // между нажатием и отпусканием: клик не срабатывал вовсе. Снимок
        // окна поймал это дважды подряд.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
      >
        <DialogHeader className="mb-4 gap-1 border-b pb-3.5">
          {/* Заголовок и надзаголовок эталона. Кнопка реестра называется
              «+ Создать бюллетень» — окно, открывающееся по ней, обязано
              называться так же, иначе человек не уверен, что попал куда хотел. */}
          <p className="text-primary-ink text-[10.5px] font-bold uppercase tracking-[.12em]">
            Новое охранное мероприятие
          </p>
          <DialogTitle>Создать бюллетень</DialogTitle>
          <DialogDescription className="text-[11.5px]">
            Бюллетень создаётся в реестре, полный мастер — далее по этапам
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3.5"
          noValidate
          onSubmit={(e) =>
            void handleSubmit(
              (values) =>
                mutation.mutate({
                  title: values.title,
                  objectId: values.objectId,
                  businessDate: values.businessDate,
                  businessDateEnd: values.businessDateEnd,
                  kind: values.kind as SecurityEventKind,
                  eventTime: values.eventTime,
                  protectedPersonIds: values.protectedPersonIds,
                  location: values.location,
                  chiefEmployeeId: values.chiefEmployeeId,
                }),
              (invalid) => focusFirstError(invalid)
            )(e)
          }
        >
          <Field
            name="title"
            label="Название ОМ"
            labelClassName={LABEL_CLASS}
            error={errors.title}
            className="space-y-1.5"
          >
            {(field) => (
              <Input
                {...field}
                className={CONTROL_CLASS}
                aria-required="true"
                placeholder="Например, Международный экономический форум"
                {...register("title")}
              />
            )}
          </Field>

          {/* Тип — не выпадающий список, а две кнопки: выбор из двух, и оба
              варианта должны быть видны сразу вместе с их последствиями. */}
          <fieldset
            className="space-y-1.5"
            aria-describedby={
              errors.kind?.message === undefined ? undefined : "kind-error"
            }
          >
            <legend className={cn(LABEL_CLASS, "mb-1.5")}>
              Тип мероприятия *
            </legend>
            {/* Поле РЕГИСТРИРУЕТСЯ, хотя вводится кнопками: `setValue` по
                незарегистрированному имени кладёт значение в форму, но не
                будит подписчиков `watch` — снимок поймал это буквально
                (первый выбор типа не подсвечивал кнопку и не менял подсказку,
                второй — менял, потому что перерисовку приносила посторонняя
                ошибка поля выше). */}
            <input type="hidden" {...register("kind")} />
            <div className="flex flex-wrap gap-2">
              {KIND_OPTIONS.map((option, index) => (
                <Button
                  key={option.value}
                  // id на ПЕРВОЙ кнопке, а не на обёртке: `focusFirstError`
                  // ищет элемент по имени поля и зовёт focus() — на div это
                  // тихо ничего не делает, и фокус на ошибке терялся бы.
                  id={index === 0 ? "kind" : undefined}
                  type="button"
                  variant={kind === option.value ? "default" : "outline"}
                  className="h-[38px] rounded-lg px-4 text-[12.5px] font-semibold"
                  aria-pressed={kind === option.value}
                  aria-invalid={errors.kind?.message === undefined ? undefined : true}
                  // Выбор гасит ошибку САМОГО поля, а не запускает проверку
                  // формы: `shouldValidate` прогонял схему целиком, и клик по
                  // типу подсвечивал красным ещё не тронутое «Название ОМ».
                  onClick={() => {
                    setValue("kind", option.value, { shouldDirty: true });
                    clearErrors("kind");
                  }}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <p className={HINT_CLASS}>{KIND_HINT[kind] ?? KIND_HINT[""]}</p>
            {errors.kind?.message !== undefined && (
              <p
                id="kind-error"
                role="alert"
                className="text-xs text-destructive-ink"
              >
                {errors.kind.message}
              </p>
            )}
          </fieldset>

          {/* Три поля периода в ряд, как в эталоне: период мероприятия
              читается целиком, а не тремя разрозненными полями. Окончание
              принимает и бэк (`business_date_end`), и реестр — колонка «Даты»
              показывает по нему продолжительность; до 23.08.2026 ввести его
              было негде, и каждое созданное вручную ОМ выходило однодневным. */}
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
                  aria-required="true"
                  {...register("businessDate")}
                />
              )}
            </Field>

            <Field
              name="businessDateEnd"
              label="Дата окончания"
              labelClassName={LABEL_CLASS}
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
              label="Время (необязательно)"
              labelClassName={LABEL_CLASS}
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

          {/* Сводка периода: человек вводит две даты в машинном формате, а
              проверить обязан то, что получилось — с днями недели и числом
              дней. */}
          <p
            className="rounded-lg border bg-muted/40 px-3 py-2.5 text-[11.5px] text-muted-foreground"
            aria-live="polite"
          >
            {periodSummary(businessDate, businessDateEnd)}
          </p>

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
              {(control) => (
                <>
                  <ProtectedPersonsPicker
                    selectId={control.id}
                    value={watch("protectedPersonIds") ?? []}
                    onChange={(next) =>
                      setValue("protectedPersonIds", next, { shouldDirty: true })
                    }
                    options={personsQuery.data?.results ?? []}
                    loading={personsQuery.isPending}
                  />
                  {personsQuery.isError && (
                    <p className="text-xs text-destructive-ink" role="alert">
                      Справочник охраняемых лиц недоступен — лица можно указать
                      позже правкой бюллетеня.
                    </p>
                  )}
                </>
              )}
            </Field>

            <Field
              name="location"
              label="Локация"
              labelClassName={LABEL_CLASS}
              hint={`По умолчанию — ${DEFAULT_LOCATION}`}
              hintClassName={HINT_CLASS}
              error={errors.location}
              className="space-y-1.5"
            >
              {(field) => (
                <Input
                  {...field}
                  className={CONTROL_CLASS}
                  placeholder={DEFAULT_LOCATION}
                  {...register("location")}
                />
              )}
            </Field>
          </div>

          {/* Эталон здесь снова в силе: объект НЕОБЯЗАТЕЛЕН — старший наряда
              определяет его позже (решение заказчика 24.08 отменяет обратное
              решение от 23.08). Без объекта не будет привязки паспорта, и
              импорт постов на рекогносцировке отвечает своим отказом, пока
              объект не добавлен кнопкой у строки реестра. */}
          <Field
            name="objectId"
            label="Объект"
            labelClassName={LABEL_CLASS}
            hint="Необязательно: без объекта версия паспорта не привяжется — объекты можно добавить позже"
            hintClassName={HINT_CLASS}
            error={errors.objectId}
            className="space-y-1.5"
          >
            {() => (
              <>
                {/* Поле РЕГИСТРИРУЕТСЯ, хотя вводится поповером — ровно та же
                    яма, что у «Типа мероприятия» выше: `setValue` по
                    незарегистрированному имени не будит `watch`, и выбранный
                    объект не появился бы в подписи кнопки. */}
                <input type="hidden" {...register("objectId")} />
                <ObjectPicker
                  objects={objectsQuery.data?.results ?? []}
                  isLoading={objectsQuery.isPending}
                  value={objectId}
                  onChange={(next) =>
                    setValue("objectId", next, { shouldDirty: true })
                  }
                  controlClassName={SELECT_CLASS}
                />
                {objectsQuery.isError && (
                  <p className="text-xs text-destructive-ink" role="alert">
                    Реестр объектов недоступен — выбрать объект не из чего;
                    мероприятие можно завести и без него.
                  </p>
                )}
              </>
            )}
          </Field>

          <Field
            name="chiefEmployeeId"
            label={chiefLabel}
            labelClassName={LABEL_CLASS}
            hint={chiefHint}
            hintClassName={HINT_CLASS}
            error={errors.chiefEmployeeId}
            className="space-y-1.5"
          >
            {() => (
              <>
                {/* Поле остаётся ЗАРЕГИСТРИРОВАННЫМ в форме, хотя человек
                    выбирает мышью: `setValue` по незарегистрированному полю
                    кладёт значение, но не будит `watch` — первый выбор
                    выглядел бы «не сработавшим». */}
                <input type="hidden" {...register("chiefEmployeeId")} />
                {/* Список кадров — с поиском и страницами НА СЕРВЕРЕ (Plane
                    №61). Раньше здесь стоял `select` со ВСЕМ кадровым
                    снимком: на живой базе это тысячи строк одним ответом и
                    прокрутка вместо поиска. */}
                <PersonnelPicker
                  value={chiefEmployeeId === "" ? null : chiefEmployeeId}
                  onPick={(id) =>
                    setValue(
                      "chiefEmployeeId",
                      // Повторный клик по выбранному СНИМАЕТ выбор: старший
                      // необязателен, и назначить «никого» иначе было бы
                      // нечем — очистить список выбором нельзя.
                      id === chiefEmployeeId ? "" : id,
                      { shouldValidate: true, shouldDirty: true },
                    )
                  }
                  pageSize={8}
                  // Подпись поля («Старший наряда» / «Старший ГВО») ведёт
                  // именно сюда: иначе `<label for>` указывал бы на скрытое
                  // поле формы, то есть в никуда.
                  searchInputId="chiefEmployeeId"
                />
              </>
            )}
          </Field>

          {mutation.error !== null && (
            <p className="text-sm text-destructive-ink" role="alert">
              Не удалось создать мероприятие. Проверьте поля и попробуйте снова.
            </p>
          )}
          <DialogFooter className="mt-1 border-t pt-3.5">
            <Button
              type="button"
              variant="outline"
              className="h-[38px] rounded-lg text-[13px]"
              onClick={onClose}
            >
              Отмена
            </Button>
            <Button
              type="submit"
              className={cn(
                "h-[38px] rounded-lg text-[13px] font-semibold",
                incomplete &&
                  "bg-secondary text-muted-foreground shadow-none hover:bg-secondary"
              )}
              aria-disabled={incomplete || undefined}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Создание…" : "Создать бюллетень"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Строка-сводка периода под полями дат.
 *
 * Показывает ровно то, что человек ввёл, но по-человечески: дни недели и
 * число дней. Пока одна из дат пуста — говорит, чего ждёт, а не молчит.
 */
function periodSummary(start: string, end: string): string {
  if (start === "" || end === "") {
    return "Укажите обе даты — период появится здесь";
  }
  if (end < start) return "Дата окончания раньше даты начала";
  const days =
    Math.round(
      (Date.parse(`${end}T00:00:00`) - Date.parse(`${start}T00:00:00`)) /
        86_400_000
    ) + 1;
  return `${longDate(start)} — ${longDate(end)} · ${days} ${dayWord(days)}`;
}

function longDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  const day = date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return `${day}, ${date.toLocaleDateString("ru-RU", { weekday: "long" })}`;
}

function dayWord(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (ones === 1 && tens !== 11) return "день";
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return "дня";
  return "дней";
}
