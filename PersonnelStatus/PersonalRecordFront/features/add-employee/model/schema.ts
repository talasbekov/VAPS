// Правила формы «Добавить сотрудника» — здесь и больше нигде.
//
// До этого те же правила лежали в трёх местах: `validateEmployeeFields`
// (по полям), `validateEmployeeForm` (списком строк) и `validateIIN`. Две
// копии разошлись формулировками, третья не использовалась вовсе.
import { z } from "zod";

/** Поля перечислены в порядке появления на экране — так схему проще читать. */
export const employeeFormSchema = z.object({
  lastName: z.string().trim().min(1, "Введите фамилию сотрудника."),
  firstName: z.string().trim().min(1, "Введите имя сотрудника."),
  middleName: z.string().trim(),
  iin: z
    .string()
    .trim()
    .min(1, "Введите ИИН сотрудника.")
    .regex(/^\d{12}$/, "ИИН должен состоять из 12 цифр."),
  divisionId: z.string().min(1, "Выберите подразделение."),
  positionId: z.string().min(1, "Выберите должность."),
  rankId: z.string(),
});

export type EmployeeFormValues = z.infer<typeof employeeFormSchema>;

export const EMPTY_EMPLOYEE_FORM: EmployeeFormValues = {
  lastName: "",
  firstName: "",
  middleName: "",
  iin: "",
  divisionId: "",
  positionId: "",
  rankId: "",
};

/**
 * Имена полей API → поля формы. Без этой таблицы полевой 400-ответ печатался
 * сводкой «iin: Ensure this value…» и не указывал, что чинить.
 */
export const EMPLOYEE_API_FIELDS = {
  iin: "iin",
  first_name: "firstName",
  last_name: "lastName",
  middle_name: "middleName",
  rank: "rankId",
  division: "divisionId",
  position: "positionId",
} as const;
