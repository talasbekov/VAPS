"use client";

// Общий вывод ошибок операций этапа: бизнес-правило (422) — текстом с
// сервера; ошибки полей (400) — списком «поле: сообщение».
import type { OpsApiFailure } from "@/lib/ops-errors";

export function StageError({ error }: { error: OpsApiFailure | null }) {
  if (error === null) return null;
  return (
    <p className="text-sm text-destructive-ink" role="alert">
      {error.message}
    </p>
  );
}

/**
 * Подписи полей, которые сервер называет своими ключами.
 *
 * Ключ приходит машинным путём — `rows.0.group`, `sectorPosts.2.need`. Без
 * перевода человек читал «rows.0.group: Выберите группу» и не понимал ни где
 * это, ни что от него хотят: под таблицей стояли три одинаковые строки, и все
 * три указывали в никуда.
 */
const FIELD_LABEL: Record<string, string> = {
  group: "Группа",
  departmentId: "Департамент",
  shift: "Смена",
  sector: "Направление",
  post: "Пост",
  task: "Задача",
  need: "Количество",
  requirements: "Требования",
  comment: "Комментарий",
  summary: "Итог",
  hours: "Часы",
  incidents: "Инциденты",
  briefDescription: "Краткое описание",
  initialTasks: "Первичные задачи",
  allocatedCount: "Выделено",
  reason: "Причина",
  title: "Заголовок",
  description: "Описание",
  // Ключи окна заведения и правки бюллетеня (Plane №618). Своей поверхности
  // у них нет: страну и город рисует `LocationFields`, атрибуты визита —
  // `PersonDetailsFields`, и ни один из них в форме не зарегистрирован.
  countryId: "Страна",
  cityId: "Город",
  address: "Адрес",
  protectedPersonDetails: "Данные визита охраняемого лица",
  protectedPersonIds: "Охраняемые лица",
  objectId: "Объект",
  // Подпись совпадает с подписью поля на экране («Дата начала»), иначе
  // список, задуманный как указатель «куда смотреть», указывает мимо.
  businessDate: "Дата начала",
  businessDateEnd: "Дата окончания",
  eventTime: "Время",
  chiefEmployeeId: "Старший",
  // Замечания возврата (Plane №506). Строку окно подписывает номером
  // (`remarks.0` → «Строка 1»), а голый ключ встречается у проверки типа
  // («Ожидается список замечаний») — без подписи он читался как «remarks».
  remarks: "Замечания",
};

/** «rows.0.group» → «Строка 1 · Группа»; неизвестный ключ отдаётся как есть. */
export function humanizeFieldPath(path: string): string {
  const parts = path.split(".");
  const labelled: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] as string;
    if (/^\d+$/.test(part)) {
      // Номер строки человек считает с единицы, а сервер — с нуля.
      labelled.push(`Строка ${Number(part) + 1}`);
      continue;
    }
    // Имя коллекции («rows», «sectorPosts») само по себе ничего не говорит:
    // его заменяет номер строки, который идёт следом.
    if (/^\d+$/.test(parts[index + 1] ?? "")) continue;
    labelled.push(FIELD_LABEL[part] ?? part);
  }
  return labelled.join(" · ");
}

export function FieldErrors({
  errors,
}: {
  errors: Record<string, unknown> | null;
}) {
  if (errors === null || Object.keys(errors).length === 0) return null;
  return (
    // 🔴 `role="alert"` НА ОБЁРТКЕ, А НЕ НА СПИСКЕ (найдено ревью №825): на
    // `<ul>` он перекрывает неявную роль `list`, и `<li>` внутри остаются без
    // родителя — часть программ чтения с экрана их не объявит.
    <div role="alert">
      <ul className="list-disc pl-5 text-xs text-destructive-ink">
        {Object.entries(errors).flatMap(([field, value]) =>
          // 🔴 ВСЕ СООБЩЕНИЯ ПОЛЯ, А НЕ ПЕРВОЕ (найдено ревью №825). Здесь
          // стояло `String(value[0])`, а сервер складывает в один список
          // ошибки ВСЕХ строк таблицы: у бюллетеня с тремя охраняемыми лицами
          // человек видел одну строку и не знал, что их три. Молча потерянное
          // сообщение хуже некрасивого списка.
          (Array.isArray(value) ? value : [value]).map((item, index) => (
            <li key={`${field}:${index}`}>
              <span className="font-semibold">{humanizeFieldPath(field)}</span>
              : {String(item)}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
