"use client";

// Окно «Создать бюллетень» — по спецификации `[БЛН-11]`…`[БЛН-13]`
// (Plane №419, Ш-3 плана P2). Порядок полей = порядок колонок бланка:
//
//   1. тип мероприятия (две кнопки — оба варианта видны сразу);
//   2. даты начала и окончания (обе обязательны), время и пометка
//      «вылет / прилёт» с бортом — пометка ложится в атрибуты визита
//      ГЛАВНОГО лица (№418), своего поля у мероприятия для неё нет намеренно;
//   3. охраняемые лица — combobox из справочника, чипами; первое — главное,
//      обязательно минимум одно;
//   4. название;
//   5. локация: страна → город (по умолчанию Казахстан → Астана, обязательны),
//      ниже объект посещения и адрес — необязательно;
//   6. старший наряда / ГВО — combobox с поиском на сервере, без списка на
//      440 строк и страниц «Назад / Дальше» (`[БЛН-13]`);
//   7. живое превью строки бюллетеня — как форма ляжет в бланк.
//
// Кнопка «Создать бюллетень» гаснет видом, пока обязательное не заполнено
// (`[БЛН-12]`), но нажать её можно: тогда форма скажет, чего не хватает.
import { useEffect, useMemo, useRef, useState } from "react";
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
import { useCities, useCountries } from "@/hooks/use-geo";
import { LocationFields } from "./LocationFields";
import { ProtectedPersonsPicker } from "./ProtectedPersonsPicker";
import { ChiefCombobox } from "./ChiefCombobox";
import type { ChiefChoice } from "./ChiefCombobox";
import { BulletinRowPreview } from "./BulletinRowPreview";
import type {
  EventProtectedPersonDetails,
  SecurityEventKind,
} from "@/entities/security-event";

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

/** Пометка к времени (`[БЛН-11]`): к какому событию визита относится час. */
const TIME_MARKS = ["", "arrival", "departure"] as const;
const TIME_MARK_LABEL: Record<(typeof TIME_MARKS)[number], string> = {
  "": "без пометки",
  arrival: "прилёт",
  departure: "вылет",
};

/** Умолчания локации (`[БЛН-11]`): Казахстан → Астана. Ищутся в справочнике
 * по коду и имени, а не по id: id на стендах разные. */
const DEFAULT_COUNTRY_CODE = "KZ";
const DEFAULT_CITY_NAME = "Астана";

/** Поля — в порядке появления на экране: так схему проще читать. */
const formSchema = z
  .object({
    kind: z
      .string()
      .refine(
        (value) => (KINDS as readonly string[]).includes(value),
        "Обязательное поле."
      ),
    businessDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите дату в формате ГГГГ-ММ-ДД."),
    // Окончание ОБЯЗАТЕЛЬНО (`[БЛН-11]`): однодневное — та же дата.
    businessDateEnd: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите дату окончания."),
    eventTime: z
      .string()
      .regex(/^(\d{2}:\d{2})?$/, "Укажите время в формате ЧЧ:ММ."),
    timeMark: z.string(),
    flight: z.string().max(100, "Не длиннее 100 символов."),
    // Минимум одно лицо (`[БЛН-11]`); первое — главное.
    protectedPersonIds: z
      .array(z.string())
      .min(1, "Укажите хотя бы одно охраняемое лицо."),
    title: z.string().trim().min(1, "Обязательное поле."),
    countryId: z.string().min(1, "Укажите страну."),
    cityId: z.string().min(1, "Укажите город."),
    address: z.string().max(255, "Не длиннее 255 символов."),
    // Объект НЕОБЯЗАТЕЛЕН (решение заказчика 24.08): бюллетень заводят до
    // согласования маршрута, объекты дописывают позже кнопкой у строки.
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
  kind: "",
  businessDate: "",
  businessDateEnd: "",
  eventTime: "",
  timeMark: "",
  flight: "",
  protectedPersonIds: [],
  title: "",
  countryId: "",
  cityId: "",
  address: "",
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
  const countries = useCountries();

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
  const eventTime = watch("eventTime");
  const timeMark = watch("timeMark");
  const countryId = watch("countryId");
  const cityId = watch("cityId");
  const address = watch("address");
  const personIds = watch("protectedPersonIds") ?? [];
  const cities = useCities(countryId === "" ? null : countryId);
  // Старший — и id для формы, и имя для превью: сервер отдаёт только id.
  const [chief, setChief] = useState<ChiefChoice | null>(null);

  // Умолчания локации ставятся ОДИН раз, когда справочник приехал и поле
  // ещё пусто: выбор человека не перекрывается.
  useEffect(() => {
    if (countryId !== "" || countries.data === undefined) return;
    const kz = countries.data.results.find((c) => c.code === DEFAULT_COUNTRY_CODE);
    if (kz !== undefined) setValue("countryId", kz.id);
  }, [countries.data, countryId, setValue]);
  useEffect(() => {
    if (cityId !== "" || cities.data === undefined) return;
    const country = countries.data?.results.find((c) => c.id === countryId);
    if (country?.code !== DEFAULT_COUNTRY_CODE) return;
    const astana = cities.data.results.find((c) => c.name === DEFAULT_CITY_NAME);
    if (astana !== undefined) setValue("cityId", astana.id);
  }, [cities.data, cityId, countries.data, countryId, setValue]);

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

  // Превью строки бюллетеня — из тех же значений, что уйдут на сервер.
  const personNames = useMemo(() => {
    const byId = new Map(
      (personsQuery.data?.results ?? []).map((p) => [p.id, p.name])
    );
    return personIds.map((id) => byId.get(id) ?? `лицо №${id}`);
  }, [personIds, personsQuery.data]);
  const previewLocation = useMemo(() => {
    const country = countries.data?.results.find((c) => c.id === countryId)?.name ?? "";
    const city = cities.data?.results.find((c) => c.id === cityId)?.name ?? "";
    const object =
      objectsQuery.data?.results.find((o) => o.id === objectId)?.name ?? "";
    return [country, city, object, address.trim()].filter((p) => p !== "").join(", ");
  }, [address, cities.data, cityId, countries.data, countryId, objectId, objectsQuery.data]);

  // Кнопка гаснет, пока обязательное не заполнено (`[БЛН-12]`). Но гасится
  // ВИДОМ, а не `disabled`: нажать её можно, и тогда форма скажет, чего
  // именно не хватает, вместо молчаливого тупика.
  const incomplete =
    kind === "" ||
    businessDate === "" ||
    businessDateEnd === "" ||
    personIds.length === 0 ||
    title.trim() === "" ||
    countryId === "" ||
    cityId === "";

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent
        ref={contentRef}
        // Колонка на всю высоту: шапка и подвал с кнопками закреплены, крутится
        // только тело формы. Прокрутка ВСЕГО окна прятала кнопку «Создать
        // бюллетень» под краем экрана, и клик по ней не стабилизировался.
        className="flex max-h-[92vh] flex-col gap-0 p-0 sm:max-w-[640px]"
        // Фокус на САМО окно, а не на первое поле.
        //
        // 🔴 Штатный автофокус Radix вставал в первое поле. Первый же клик
        // мимо него уводил фокус с пустого обязательного поля, проверка
        // `onTouched` показывала «Обязательное поле.», строка ошибки
        // раздвигала форму — и кнопка типа УЕЗЖАЛА из-под курсора между
        // нажатием и отпусканием: клик не срабатывал вовсе.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
      >
        <DialogHeader className="shrink-0 gap-1 border-b px-[22px] pb-3.5 pt-[22px]">
          <p className="text-primary-ink text-[10.5px] font-bold uppercase tracking-[.12em]">
            Новое охранное мероприятие
          </p>
          <DialogTitle>Создать бюллетень</DialogTitle>
          <DialogDescription className="text-[11.5px]">
            Поля идут в порядке колонок бланка бюллетеня; внизу — строка, как
            она ляжет в документ.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-1 flex-col"
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
                  protectedPersonDetails: personDetailsOf(values),
                  countryId: values.countryId,
                  cityId: values.cityId,
                  address: values.address,
                  chiefEmployeeId: values.chiefEmployeeId,
                }),
              (invalid) => focusFirstError(invalid)
            )(e)
          }
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-[22px] py-4">
          {/* 1. Тип — не выпадающий список, а две кнопки: выбор из двух, и оба
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
                незарегистрированному имени не будит `watch`. */}
            <input type="hidden" {...register("kind")} />
            <div className="flex flex-wrap gap-2">
              {KIND_OPTIONS.map((option, index) => (
                <Button
                  key={option.value}
                  // id на ПЕРВОЙ кнопке: `focusFirstError` ищет элемент по
                  // имени поля и зовёт focus().
                  id={index === 0 ? "kind" : undefined}
                  type="button"
                  variant={kind === option.value ? "default" : "outline"}
                  className="h-[38px] rounded-lg px-4 text-[12.5px] font-semibold"
                  aria-pressed={kind === option.value}
                  aria-invalid={errors.kind?.message === undefined ? undefined : true}
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
              <p id="kind-error" role="alert" className="text-xs text-destructive-ink">
                {errors.kind.message}
              </p>
            )}
          </fieldset>

          {/* 2. Период и время. Обе даты обязательны (`[БЛН-11]`), под ними —
              сводка периода словами: человек вводит даты в машинном формате,
              а проверить обязан то, что получилось. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              name="businessDate"
              label="Дата начала *"
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
              label="Дата окончания *"
              labelClassName={LABEL_CLASS}
              hint="Однодневное — та же дата"
              hintClassName={HINT_CLASS}
              error={errors.businessDateEnd}
              className="space-y-1.5"
            >
              {(field) => (
                <Input
                  {...field}
                  type="date"
                  className={CONTROL_CLASS}
                  aria-required="true"
                  {...register("businessDateEnd")}
                />
              )}
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              name="eventTime"
              label="Время"
              labelClassName={LABEL_CLASS}
              hint="Необязательно"
              hintClassName={HINT_CLASS}
              error={errors.eventTime}
              className="space-y-1.5"
            >
              {(field) => (
                <Input {...field} type="time" className={CONTROL_CLASS} {...register("eventTime")} />
              )}
            </Field>
            <Field
              name="timeMark"
              label="Пометка к времени"
              labelClassName={LABEL_CLASS}
              hint="Вылет / прилёт главного лица"
              hintClassName={HINT_CLASS}
              error={errors.timeMark}
              className="space-y-1.5"
            >
              {(field) => (
                <select {...field} className={SELECT_CLASS} {...register("timeMark")}>
                  {TIME_MARKS.map((mark) => (
                    <option key={mark} value={mark}>
                      {TIME_MARK_LABEL[mark]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field
              name="flight"
              label="Борт"
              labelClassName={LABEL_CLASS}
              hint="Рейс или тип борта — при пометке"
              hintClassName={HINT_CLASS}
              error={errors.flight}
              className="space-y-1.5"
            >
              {(field) => (
                <Input
                  {...field}
                  className={CONTROL_CLASS}
                  placeholder="KC 871"
                  disabled={timeMark === ""}
                  {...register("flight")}
                />
              )}
            </Field>
          </div>
          <p
            className="rounded-lg border bg-muted/40 px-3 py-2.5 text-[11.5px] text-muted-foreground"
            aria-live="polite"
          >
            {periodSummary(businessDate, businessDateEnd)}
          </p>

          {/* 3. Охраняемые лица — combobox из справочника, чипами. */}
          <Field
            name="protectedPersonIds"
            label="Охраняемые лица *"
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
                  value={personIds}
                  onChange={(next) => {
                    setValue("protectedPersonIds", next, { shouldDirty: true });
                    if (next.length > 0) clearErrors("protectedPersonIds");
                  }}
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

          {/* 4. Название. */}
          <Field
            name="title"
            label="Название ОМ *"
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

          {/* 5. Локация: страна → город обязательны, объект и адрес — нет.
              Объект живёт ВНУТРИ блока локации (`[БЛН-13]`), а не отдельным
              полем: это то же «где», что страна и город. */}
          <fieldset className="space-y-3 rounded-lg border p-3">
            <legend className={cn(LABEL_CLASS, "px-1")}>Локация *</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <LocationFields
                countryId={countryId}
                cityId={cityId}
                onCountry={(next) => {
                  setValue("countryId", next, { shouldDirty: true });
                  setValue("cityId", "", { shouldDirty: true });
                  if (next !== "") clearErrors("countryId");
                }}
                onCity={(next) => {
                  setValue("cityId", next, { shouldDirty: true });
                  if (next !== "") clearErrors("cityId");
                }}
                addressField={
                  <Field
                    name="address"
                    label="Адрес / место"
                    labelClassName={LABEL_CLASS}
                    hint="Необязательно"
                    hintClassName={HINT_CLASS}
                    error={errors.address}
                    className="space-y-1.5"
                  >
                    {(field) => (
                      <Input
                        {...field}
                        className={CONTROL_CLASS}
                        placeholder="Улица, дом, площадка"
                        {...register("address")}
                      />
                    )}
                  </Field>
                }
                labelClassName={LABEL_CLASS}
                selectClassName={SELECT_CLASS}
              />
              <Field
                name="objectId"
                label="Объект посещения"
                labelClassName={LABEL_CLASS}
                hint="Необязательно — объекты можно добавить позже кнопкой «+» у строки"
                hintClassName={HINT_CLASS}
                error={errors.objectId}
                className="space-y-1.5"
              >
                {() => (
                  <>
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
                        Реестр объектов недоступен — мероприятие можно завести
                        и без объекта.
                      </p>
                    )}
                  </>
                )}
              </Field>
            </div>
            {(errors.countryId?.message !== undefined ||
              errors.cityId?.message !== undefined) && (
              <p className="text-xs text-destructive-ink" role="alert">
                {errors.countryId?.message ?? errors.cityId?.message}
              </p>
            )}
          </fieldset>

          {/* 6. Старший — combobox с поиском на сервере. */}
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
                <input type="hidden" {...register("chiefEmployeeId")} />
                <ChiefCombobox
                  inputId="chiefEmployeeId"
                  value={chief}
                  onChange={(next) => {
                    setChief(next);
                    setValue("chiefEmployeeId", next?.id ?? "", {
                      shouldValidate: true,
                      shouldDirty: true,
                    });
                  }}
                />
              </>
            )}
          </Field>

          {/* 7. Превью строки бюллетеня. */}
          <BulletinRowPreview
            businessDate={businessDate}
            businessDateEnd={businessDateEnd}
            eventTime={eventTime}
            timeMark={timeMark === "" ? "" : TIME_MARK_LABEL[timeMark as "arrival" | "departure"] ?? ""}
            persons={personNames}
            title={title}
            location={previewLocation}
            chief={chief?.name ?? ""}
          />

          {mutation.error !== null && (
            <p className="text-sm text-destructive-ink" role="alert">
              Не удалось создать мероприятие. Проверьте поля и попробуйте снова.
            </p>
          )}
          </div>
          <DialogFooter className="shrink-0 border-t px-[22px] py-3.5">
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
 * Пометка «вылет / прилёт» и борт — атрибуты визита ГЛАВНОГО лица (№418):
 * час относится к его прилёту или вылету, и своего поля у мероприятия для
 * этого нет намеренно. Без пометки или без времени детали не шлются.
 */
function personDetailsOf(values: FormValues): EventProtectedPersonDetails[] {
  const main = values.protectedPersonIds[0];
  if (main === undefined || values.timeMark === "" || values.eventTime === "") {
    return [];
  }
  const when = `${values.businessDate}T${values.eventTime}`;
  const flight = values.flight.trim();
  return values.timeMark === "arrival"
    ? [{ id: main, arrivalAt: when, flightArrival: flight }]
    : [{ id: main, departureAt: when, flightDeparture: flight }];
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
