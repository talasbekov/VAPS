// Правила формы «Массовое обновление статусов» — здесь и больше нигде.
//
// До этого те же правила жили в рукописном `validateForm()` внутри разметки:
// одна половина складывалась в сводку строк, вторая — в словарь по полям, и
// формулировки в этих двух половинах уже разошлись («Укажите дату начала» и
// «Укажите дату начала.»). Порядок полей для фокуса лежал третьим списком
// (`FIELD_ORDER`) — теперь фокус идёт по разметке, и списка нет вовсе.
import { z } from "zod";
import { EMPLOYEE_STATUS_LABELS } from "@/lib/status";

/** Поля перечислены в порядке появления на экране — так схему проще читать. */
export const massStatusSchema = z
  .object({
    status: z.string().min(1, "Выберите статус."),
    startDate: z.date().optional(),
    endDate: z.date().optional(),
    comment: z.string(),
    notifyManagers: z.boolean(),
    scheduleUpdate: z.boolean(),
  })
  .superRefine((values, ctx) => {
    // Правило то же, что в одиночной модалке: «В строю» бессрочен и дат не
    // требует, у остальных период обязателен целиком. Прежний список был
    // перечислением трёх статусов из тринадцати — для «Учёбы» или «На
    // дежурстве» форма пропускала пустые даты, а статус без даты начала
    // невозможен, и обновление отклонялось уже на сервере.
    const needsPeriod =
      values.status !== "" &&
      values.status !== EMPLOYEE_STATUS_LABELS.in_service;

    if (needsPeriod) {
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

    // Перевёрнутый период ловим у ВТОРОЙ даты: чинить надо ту, которую человек
    // только что поставил, к ней и ведём фокус.
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

export type MassStatusFormValues = z.infer<typeof massStatusSchema>;

export const EMPTY_MASS_STATUS_FORM: MassStatusFormValues = {
  status: "",
  startDate: undefined,
  endDate: undefined,
  comment: "",
  notifyManagers: true,
  scheduleUpdate: false,
};
