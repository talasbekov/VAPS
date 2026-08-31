import type { StatusNaming } from "@/entities/status";
import type { Employee } from "./types";

/**
 * Часть строки, которая приходит от САМОГО СОТРУДНИКА (в отличие от
 * должности, подразделения и номера по порядку — те задаёт штатная единица).
 *
 * Собиралась в трёх местах порознь (`/employees`, карточки, `/statuses`), и
 * поля, которых ручка не отдавала, каждое из них подставляло пустой строкой
 * по-своему. Теперь разбор один: добавилось поле на бэке — оно доезжает во все
 * три экрана разом.
 */
export type EmployeePersonalFields = Pick<
  Employee,
  | "id"
  | "name"
  | "status"
  | "statusCode"
  | "statusSince"
  | "statusUntil"
  | "rank"
  | "iinMasked"
  | "hireDate"
  | "birthDate"
  | "personnelNumber"
  | "photo"
>;

/**
 * `naming` приходит ПАРАМЕТРОМ, а не берётся хуком внутри: это чистый разбор
 * ответа ручки, и хук превратил бы его в компонент — вызывать его из `useMemo`
 * стало бы нельзя. Подпись при этом обязана идти из справочника (Plane №366),
 * иначе тип, заведённый заказчиком в админке, читается как «Не обновлено».
 */
export function personnelFields(
  emp: any,
  naming: StatusNaming
): EmployeePersonalFields {
  const currentStatus = emp.current_status;
  return {
    id: emp.id.toString(),
    name: `${emp.last_name} ${emp.first_name}`,
    // Форматированный статус учитывает `local_status` прикомандированных.
    status: naming.formatEmployee(emp),
    statusCode: currentStatus?.status_type ?? null,
    statusSince: currentStatus?.start_date || "",
    statusUntil: currentStatus?.end_date || "",
    // Ниже — то, что лежало в модели с самого начала и не клалось в ответ
    // ручки штатки. Кадровых КОНТАКТОВ она не отдаёт по-прежнему, и полей под
    // них здесь нет: подпись с пустым значением читается как «не заполнено».
    rank: emp.rank ?? "",
    iinMasked: emp.iin_masked ?? "",
    hireDate: emp.hire_date ?? "",
    birthDate: emp.birth_date ?? "",
    personnelNumber: emp.personnel_number ?? "",
    // Адрес аватарки приходит готовым (`photo_url`, Plane №205). Старое поле
    // `photo` — путь файла у донорского контракта; оно оставлено как запасной
    // источник, но склеивать его с префиксом здесь никто не будет: адрес
    // выдаёт сервер.
    photo: emp.photo_url ?? emp.photo,
  };
}
