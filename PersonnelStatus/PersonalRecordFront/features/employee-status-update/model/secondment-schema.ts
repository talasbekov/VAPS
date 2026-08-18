// Правила формы «Откомандировать сотрудника» — здесь и больше нигде.
//
// До этого те же правила жили в `validateForm()` внутри модалки двумя копиями
// одного и того же: список строк для сводки внизу формы и словарь «поле →
// текст» для подписи под полем. Формулировки расходились, а порядок обхода
// полей задавался третьим списком (`FIELD_ORDER`) — теперь фокус идёт по
// разметке, и списка нет вовсе.
import { z } from "zod";

/**
 * Поля перечислены в порядке появления на экране — так схему проще читать.
 *
 * Обязательность каждой даты объявлена ПОЛЕВЫМ `.refine`: правило про одно
 * поле принадлежит этому полю. Пустой календарь даёт `undefined`, а не
 * «неверную дату», поэтому сообщение про пропуск, а не про тип значения.
 *
 * В `superRefine` остаётся только сравнение дат: оно требует обоих значений
 * сразу и к одному полю не относится.
 */
export const secondmentSchema = z
  .object({
    // `: boolean` в возвращаемом типе — не украшение: без него TypeScript
    // выводит из `value !== undefined` предикат типа, zod сужает вывод схемы
    // до `Date`, и тип формы перестаёт совпадать с тем, что она на самом деле
    // держит (пустой календарь — это `undefined`).
    startDate: z
      .date()
      .optional()
      .refine((value): boolean => value !== undefined, "Укажите дату начала."),
    endDate: z
      .date()
      .optional()
      .refine(
        (value): boolean => value !== undefined,
        "Укажите дату окончания."
      ),
    divisionId: z.string().min(1, "Выберите подразделение."),
    comment: z.string().trim().min(1, "Укажите причину откомандирования."),
  })
  .superRefine((values, ctx) => {
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

export type SecondmentFormValues = z.infer<typeof secondmentSchema>;

export const EMPTY_SECONDMENT_FORM: SecondmentFormValues = {
  startDate: undefined,
  endDate: undefined,
  divisionId: "",
  comment: "",
};

/**
 * Имена полей API → поля формы. Без этой таблицы полевой 400-ответ печатался
 * как есть — человек читал «date_from: ...» и не понимал, какое из двух полей
 * с датой чинить.
 */
export const SECONDMENT_API_FIELDS = {
  start_date: "startDate",
  date_from: "startDate",
  end_date: "endDate",
  date_to: "endDate",
  to_division: "divisionId",
  target_division: "divisionId",
  reason: "comment",
} as const;
