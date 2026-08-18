"use client";

// Ошибки формы, привязанные к полям.
//
// Зачем. Во фронте 23 рукописных формы из 24 показывали ошибки СВОДКОЙ в конце
// формы: само поле ничем не помечалось, `aria-invalid` вне `components/ui/`
// не встречался ни разу, `aria-describedby` — один на весь проект. В форме на
// 600 строк сводка оказывалась за пределами экрана, и неудачный сабмит выглядел
// как «ничего не произошло».
//
// Здесь минимум, которого не хватало: связка «поле ↔ его ошибка» по id,
// разметка сообщения и перевод фокуса на первое неверное поле. Это не замена
// react-hook-form — это то, что должно быть в любой форме независимо от того,
// чем она собрана.
import type { ReactElement } from "react";

/** Атрибуты, которые получает контрол: id и связка с текстом ошибки. */
export interface FieldControlProps {
  id: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
}

/** Атрибуты поля: помечают его неверным и связывают с текстом ошибки. */
export function fieldProps(
  id: string,
  error: string | undefined
): FieldControlProps {
  if (error === undefined) return { id };
  return { id, "aria-invalid": true, "aria-describedby": `${id}-error` };
}

/** Текст ошибки под полем. `id` — тот же, что у поля. */
export function FieldError({
  id,
  error,
}: {
  id: string;
  error: string | undefined;
}): ReactElement | null {
  if (error === undefined) return null;
  return (
    <p id={`${id}-error`} role="alert" className="text-xs text-destructive-ink">
      {error}
    </p>
  );
}

/**
 * Перевести фокус на первое поле с ошибкой.
 *
 * `order` задаёт визуальный порядок полей: объект ошибок его не хранит, а
 * прыгать надо к ВЕРХНЕМУ неверному полю, а не к первому попавшемуся ключу.
 * Radix-селекты фокусируются через кнопку-триггер с тем же id.
 */
export function focusFirstInvalid(
  order: readonly string[],
  errors: Record<string, string | undefined>
): void {
  const first = order.find((id) => errors[id] !== undefined);
  if (first === undefined) return;
  const element = document.getElementById(first);
  if (element === null) return;
  if (typeof (element as HTMLElement).focus === "function") {
    (element as HTMLElement).focus();
    element.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}
