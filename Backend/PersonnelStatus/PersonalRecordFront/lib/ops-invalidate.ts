// Сброс кэша по СМЫСЛУ события, а не по имени ключа.
//
// Мероприятие изменилось — устарели не только сами мероприятия, но и всё, что
// из них ВЫВЕДЕНО. С Plane №166 сводка ГВО (деловая дата, ответственный,
// охраняемое лицо, объекты посещения) приходит своим запросом с сервера и об
// изменении мероприятия не знает: панель показывала бы прежний день посещения
// рядом со свежей строкой объекта.
//
// Функция одна на все места правки мероприятия ровно поэтому: десять
// разбросанных `invalidateQueries` расходятся на первой же новой производной —
// одиннадцатое место про неё просто не узнает.
import type { QueryClient } from "@tanstack/react-query";

export function invalidateSecurityEvents(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["ops-security-events"] });
  void queryClient.invalidateQueries({ queryKey: ["ops-gvo-summary"] });
  void queryClient.invalidateQueries({ queryKey: ["ops-gvo-summaries"] });
  // Сбор сил — тоже производная мероприятия (Plane №928). До переезда
  // раскладки во вкладку «Сборы» этого не было видно: редактор
  // (`ForcesSplitPanel`) жил на ленте `/employees`, а карточка сбора — за
  // вкладкой, и устаревал экран, которого в этот момент никто не смотрел.
  // Теперь форма и таблица `[СБС-12]` стоят друг под другом: сохранил
  // раскладку — и таблица над формой показывала бы прежние числа.
  //
  // Оба ключа, а не один: `["ops-force-collection"]` НЕ префикс для
  // `["ops-force-collections"]` — это разные строки, и совпадение по префиксу
  // их не связывает.
  void queryClient.invalidateQueries({ queryKey: ["ops-force-collection"] });
  void queryClient.invalidateQueries({ queryKey: ["ops-force-collections"] });
}
