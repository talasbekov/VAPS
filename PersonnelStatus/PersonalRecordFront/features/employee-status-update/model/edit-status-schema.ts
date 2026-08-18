// Правила формы «Статусы сотрудника» — здесь и больше нигде.
//
// До этого те же правила лежали в теле модалки (`validateForm`) и ещё раз, в
// виде списка строк, в `validateDutyDraft`. Наряд из-за этого показывал ошибки
// сводкой: список строк не знает, к какому полю относится «Выберите объект».
import { z } from "zod";
import { EMPLOYEE_STATUS_LABELS } from "@/lib/status";

/** «В строю» — бессрочный статус по умолчанию, дат у него нет. */
export const IN_SERVICE_LABEL = EMPLOYEE_STATUS_LABELS.in_service;
/** «На дежурстве» — единственный статус, который дополняется нарядом. */
export const ON_DUTY_LABEL = EMPLOYEE_STATUS_LABELS.on_duty;

/**
 * Черновик наряда: пустая строка — «не выбрано». Имена объекта, поста и
 * группы едут рядом с идентификаторами — их пишет карточка объекта.
 */
export const dutyDraftSchema = z.object({
  dutyKind: z.union([z.literal("POST"), z.literal("GROUP"), z.literal("")]),
  objectId: z.string(),
  objectName: z.string(),
  postId: z.string(),
  postName: z.string(),
  groupId: z.string(),
  groupName: z.string(),
});

/** Поля перечислены в порядке появления на экране — так схему проще читать. */
export const editStatusFormSchema = z
  .object({
    status: z.string().min(1, "Выберите статус."),
    duty: dutyDraftSchema,
    startDate: z.date().optional(),
    endDate: z.date().optional(),
    comment: z.string(),
  })
  .superRefine((values, ctx) => {
    const isInService = values.status === IN_SERVICE_LABEL;
    const isOnDuty = values.status === ON_DUTY_LABEL;

    // Наряд — расшифровка статуса «На дежурстве»: без объекта и вида дежурства
    // он не говорит, где человек стоит.
    if (isOnDuty) {
      if (values.duty.dutyKind === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["duty", "dutyKind"],
          message: "Выберите тип дежурства.",
        });
      }
      if (values.duty.objectId === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["duty", "objectId"],
          message: "Выберите объект.",
        });
      }
      if (values.duty.dutyKind === "POST" && values.duty.postId === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["duty", "postId"],
          message: "Выберите пост.",
        });
      }
      if (values.duty.dutyKind === "GROUP" && values.duty.groupId === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["duty", "groupId"],
          message: "Выберите группу.",
        });
      }
    }

    // «В строю» бессрочен — дат у него нет. У любого другого статуса период
    // обязателен целиком: статус без конца не отличим от забытого.
    //
    // Проверка на пустой статус здесь НЕ лишняя: zod прогоняет `superRefine`
    // даже когда правило самого поля уже нарушено, и без неё пустая форма
    // краснела бы сразу тремя сообщениями вместо одного «Выберите статус».
    if (values.status !== "" && !isInService) {
      if (values.startDate === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["startDate"],
          message: "Укажите дату начала.",
        });
      }
      if (values.endDate === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["endDate"],
          message: "Укажите дату окончания.",
        });
      }
    }

    if (
      values.startDate !== undefined &&
      values.endDate !== undefined &&
      values.startDate > values.endDate
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "Дата окончания раньше даты начала.",
      });
    }
  });

export type EditStatusFormValues = z.infer<typeof editStatusFormSchema>;
export type DutyDraft = z.infer<typeof dutyDraftSchema>;

export const EMPTY_DUTY_DRAFT: DutyDraft = {
  dutyKind: "",
  objectId: "",
  objectName: "",
  postId: "",
  postName: "",
  groupId: "",
  groupName: "",
};

export const EMPTY_EDIT_STATUS_FORM: EditStatusFormValues = {
  status: "",
  duty: EMPTY_DUTY_DRAFT,
  startDate: undefined,
  endDate: undefined,
  comment: "",
};
