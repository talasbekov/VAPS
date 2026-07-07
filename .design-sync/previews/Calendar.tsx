import { Calendar } from "my-v0-project";
import { ru } from "date-fns/locale";

// Фиксированный месяц и выбранная дата — детерминированный скриншот.
export const DatePicker = () => (
  <Calendar
    mode="single"
    locale={ru}
    month={new Date(2026, 6)}
    selected={new Date(2026, 6, 15)}
    className="rounded-md border shadow-sm"
  />
);
