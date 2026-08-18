// Типы для сущности Employee (UI-представление)
export interface Employee {
  id: string;
  number: number;
  name: string;
  position: string;
  department: string;
  departmentId: string;
  status: string;
  /**
   * Начало ТЕКУЩЕГО СТАТУСА, пустая строка — статуса нет.
   *
   * Поле звалось `hireDate` и подписывалось «Дата найма», хотя в него клали
   * `current_status.start_date`, а при его отсутствии — сегодняшнее число.
   * Отсюда одинаковая дата у всех строк таблицы и «стаж работы 0 месяцев» у
   * всякого, кто ушёл в отпуск. Даты найма фронт не получает вовсе.
   */
  statusSince: string;
  /** Конец текущего статуса, пустая строка — бессрочный или статуса нет. */
  statusUntil: string;
  birthDate: string;
  address: string;
  manager: string;
  photo?: string;
  /** Штатная единица. Нужна модалке статусов: она адресует сотрудника ключом
   * `${staffUnitId}-${id}`, и без неё строка таблицы туда не доедет. */
  staffUnitId?: string;
}
