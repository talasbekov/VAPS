"use client";

// Подпись и цвет статуса — ПО СПРАВОЧНИКУ, а не по тринадцати зашитым кодам
// (Plane №366, Ш-1 задачи №365).
//
// ЖАЛОБА ЗАКАЗЧИКА ДОСЛОВНО: «У сотрудника когда меняешь статус на Участие на
// ОМ, то потом не показывается как другие статусы».
//
// ПОЧЕМУ ТАК ВЫШЛО. №354 снял каталог с кода и отдал его справочнику: в окне
// планирования теперь шестнадцать выбираемых типов, и пять из них
// (`BEFORE_DUTY`, `GEV`, `IN_EVENT`, `EVENT_ASSIGNMENT`,
// `EVENT_ASSIGNMENT_GROUP`) своего `legacy_code` не имеют — в базу они ложатся
// собственными кодами. А ВЫВОД остался на старом списке: `EMPLOYEE_STATUS_LABELS`
// знает только тринадцать кадровых кодов, и `getEmployeeStatusLabel` на любом
// другом отвечает «Не обновлено». Человек выбрал «Участие в ОМ», сохранил — и
// в таблице у него написано, что статуса нет вовсе.
//
// ЭТО НЕ ПРО ОМ. Ровно так же выглядит ЛЮБОЙ тип, заведённый заказчиком в
// админке: список открыли справочнику, вывод не открыли. Поэтому лечится
// источник подписи, а не список кодов — дописывать коды руками значило бы
// завести четвёртую копию каталога и вернуться сюда с шестым.
//
// 🔴 ТРИ РАЗНЫХ ОТВЕТА, КОТОРЫЕ НЕЛЬЗЯ ПУТАТЬ:
//   1. статуса НЕТ вовсе            → «Не обновлено» (или то, что просит место);
//   2. статус есть, код известен     → подпись справочника, иначе запасной таблицы;
//   3. статус есть, код незнаком     → САМ КОД, а не «Не обновлено».
// Третий случай раньше сливался с первым, и это худший вид вранья в таблице
// занятости: строка утверждала, что человека не отметили, тогда как его
// отметили — просто типом, которого клиент не знал. Код на экране некрасив, но
// он правда, и по нему видно, чего не хватает в справочнике.

import { useMemo } from "react";

import {
  EMPLOYEE_STATUS_LABELS,
  UNKNOWN_STATUS_PAINT,
  getEmployeeStatusColor,
  getEmployeeStatusPaint,
  type EmployeeStatusType,
  type StatusPaint,
} from "./model";
import { useEmployeeStatusTypes } from "@/hooks/use-employee-status-types";

/** Сотрудник в том виде, в каком подпись статуса читают таблицы и карточки. */
interface EmployeeLike {
  current_status?: { status_type: string } | null;
  local_status?: { status_type: string } | null;
  is_seconded?: boolean;
}

export interface StatusNaming {
  /** Подпись кода. `fallback` — ответ на «статуса нет», а не на «код незнаком». */
  labelOf(code: string | null | undefined, fallback?: string): string;
  /** Классы бейджа. Незнакомый код — нейтральный серый, никогда не зелёный. */
  colorOf(code: string | null | undefined): string;
  /** Полная палитра (бейдж, точка, hex) — для мест со своим стилем. */
  paintOf(code: string | null | undefined): StatusPaint;
  /** Текст статуса сотрудника, с учётом прикомандирования (оба статуса через «/»). */
  formatEmployee(employee: EmployeeLike | null | undefined): string;
  /** Каталог ещё едет: место вправе показать скелет вместо мигания подписью. */
  isLoading: boolean;
}

/**
 * Подписи и цвета статусов, собранные вокруг справочника с сервера.
 *
 * Хук, а не функция: каталог приходит запросом и меняется без выкатки клиента
 * (администратор правит его в админке). Запрос кэширован `useEmployeeStatusTypes`
 * на пять минут и общий на все места — вызвать хук в десяти компонентах дешевле,
 * чем протаскивать карту подписей пропсами через оргструктуру.
 *
 * Каталог берётся ПОЛНЫЙ (`selectableOnly = false`), а не выбираемый: показать
 * надо и то, что человек руками не ставит — прикомандирование заводится своей
 * заявкой, но подпись у него быть обязана.
 */
export function useStatusNaming(): StatusNaming {
  const { types, isLoading } = useEmployeeStatusTypes(false);

  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of types) map.set(item.code, item.label);
    return map;
  }, [types]);

  return useMemo(() => {
    const labelOf = (
      code: string | null | undefined,
      fallback = "Не обновлено"
    ): string => {
      if (!code) return fallback;
      const fromCatalog = labels.get(code);
      if (fromCatalog) return fromCatalog;
      // Запасной путь: пока справочник не доехал (или ответил ошибкой), место
      // обязано остаться читаемым — те же тринадцать кодов, что и раньше.
      const fromTable = EMPLOYEE_STATUS_LABELS[code as EmployeeStatusType];
      if (fromTable) return fromTable;
      return code;
    };

    // Цвет БЕРЁТСЯ ИЗ ПАЛИТРЫ КЛИЕНТА, а не из поля `color` справочника, и это
    // не забытая половина №354. Поле справочника хранит произвольный hex, а
    // здесь ждут классы Tailwind — подставить одно в другое нельзя без
    // разбора контраста пары «фон/текст». Сегодня поле пусто у всех строк
    // (проверено запросом), так что цена решения нулевая; когда заказчик
    // начнёт красить типы в админке, это станет отдельной задачей про
    // контраст, а не строкой здесь.
    const colorOf = (code: string | null | undefined): string =>
      code
        ? getEmployeeStatusColor(code as EmployeeStatusType)
        : UNKNOWN_STATUS_PAINT.badge;

    const paintOf = (code: string | null | undefined): StatusPaint =>
      getEmployeeStatusPaint(code);

    const formatEmployee = (employee: EmployeeLike | null | undefined): string => {
      if (!employee) return "Не обновлено";
      const current = employee.current_status?.status_type;
      const local = employee.local_status?.status_type;
      // Прикомандированный несёт два статуса разом: свой и по месту службы.
      if ((employee.is_seconded || local) && local && current) {
        return `${labelOf(current)} / ${labelOf(local)}`;
      }
      if (local && !current) return labelOf(local);
      return labelOf(current);
    };

    return { labelOf, colorOf, paintOf, formatEmployee, isLoading };
  }, [labels, isLoading]);
}
