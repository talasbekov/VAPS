"use client";

// Общий механизм форм: react-hook-form + zod.
//
// Зачем. Из 24 форм на RHF была ОДНА; остальные держали значения в `useState`
// и проверяли их рукописным `validateForm()`. Отсюда три беды, которые чинятся
// только сменой механизма, а не правкой каждой формы по отдельности:
//   • правила валидации расползались (у добавления сотрудника — три копии в
//     двух файлах, у статусов — по копии в каждой из двух модалок);
//   • проверка была ТОЛЬКО на сабмите: ИИН из 11 цифр обнаруживался после
//     нажатия «Добавить»;
//   • ошибка поля и само поле жили порознь — сводка списком внизу формы.
//
// Здесь три вещи, которых не хватало каждой форме: схема как единственный
// источник правил (`useZodForm`), поле, которое НЕ МОЖЕТ забыть связку с
// текстом ошибки (`Field`), и раскладка серверного 400-ответа по полям
// (`applyServerErrors`).
//
// Разметку ошибки (`aria-invalid`, `aria-describedby`, `role="alert"`) не
// переписываем — она уже есть в `shared/lib/field-errors` и проверена пробами
// спринта 3; здесь только источник данных другой.
import type { ReactElement, ReactNode } from "react";
import {
  useForm,
  type DefaultValues,
  type FieldErrors,
  type FieldValues,
  type Path,
  type UseFormReturn,
  type UseFormSetError,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  FieldError as FieldErrorText,
  fieldProps,
  type FieldControlProps,
} from "@/shared/lib/field-errors";

/**
 * Форма на схеме.
 *
 * `mode: "onTouched"` — проверка на уходе фокуса, а дальше на каждом изменении:
 * ошибка находится там, где её ещё можно исправить не глядя на кнопку.
 *
 * `shouldFocusError: false` — фокус ведём сами (`focusFirstError`). Штатный
 * механизм RHF умеет фокусировать только зарегистрированные инпуты, а половина
 * полей здесь — Radix-триггеры и кнопки-календари без ref.
 */
export function useZodForm<T extends FieldValues>(
  schema: z.ZodType<T, z.ZodTypeDef, T>,
  defaultValues: DefaultValues<T>
): UseFormReturn<T> {
  return useForm<T>({
    resolver: zodResolver(schema),
    defaultValues,
    mode: "onTouched",
    shouldFocusError: false,
  });
}

/**
 * Перевести фокус на ВЕРХНЕЕ поле с ошибкой.
 *
 * Порядок берётся из РАЗМЕТКИ, а не из объекта ошибок и не из списка полей.
 *
 * 🔴 Первая версия шла по ключам `formState.errors`, считая, что там порядок
 * схемы. Это неправда: `@hookform/resolvers` пересобирает ошибки и меняет
 * порядок (проба поймала — у откомандирования фокус уезжал на «Подразделение»,
 * третье поле сверху, мимо двух пустых дат). Никакой ОБЪЯВЛЕННЫЙ порядок и не
 * нужен: «верхнее поле» — это буквально положение в документе, и разъехаться
 * с разметкой оно не может.
 *
 * Поля, которых сейчас нет в DOM (скрытая ветка формы), выпадают сами: у них
 * нет элемента, с которым можно сравниться.
 */
export function focusFirstError(errors: FieldErrors): void {
  focusFirstOf(errorPaths(errors));
}

/**
 * Перевести фокус на самое верхнее из перечисленных полей.
 *
 * Отдельно от `focusFirstError` потому, что после `setError` объект ошибок в
 * замыкании обработчика ещё старый — свежий придёт только со следующим
 * рендером. Поля, которые отметил сервер, известны и без него.
 */
export function focusFirstOf(names: readonly string[]): void {
  const elements = names
    .map((name) => document.getElementById(name))
    .filter((element): element is HTMLElement => element !== null);
  if (elements.length === 0) return;
  const first = elements.reduce((top, next) =>
    // DOCUMENT_POSITION_PRECEDING: `next` стоит в документе РАНЬШЕ `top`.
    top.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_PRECEDING
      ? next
      : top
  );
  first.focus();
  first.scrollIntoView({ block: "center", behavior: "smooth" });
}

/** Пути полей с ошибками в порядке схемы; `root` — не поле, его пропускаем. */
function errorPaths(errors: FieldErrors, prefix = ""): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(errors)) {
    if (prefix === "" && key === "root") continue;
    if (value === undefined || value === null) continue;
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof (value as { message?: unknown }).message === "string") {
      paths.push(path);
      continue;
    }
    paths.push(...errorPaths(value as FieldErrors, path));
  }
  return paths;
}

/** Текст ошибки поля — то, что RHF кладёт в `message`, без остальной обвязки. */
export function messageOf(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : undefined;
}

export interface FieldProps {
  /** Имя поля в форме. Оно же — `id` в DOM: одно имя, одна связка. */
  name: string;
  label: string;
  /** Звёздочка в подписи. Само правило живёт в схеме, здесь только пометка. */
  required?: boolean;
  /** Ошибка из `formState.errors` — берётся `message`. */
  error?: unknown;
  hint?: string;
  className?: string;
  /** Оформление подписи там, где у формы своя типографика. */
  labelClassName?: string;
  /** Контрол получает `id` и связку с текстом ошибки — забыть её нельзя. */
  children: (control: FieldControlProps) => ReactNode;
}

/**
 * Поле формы: подпись, контрол и текст ошибки ПОД полем.
 *
 * Контрол получает атрибуты через аргумент, а не «не забудь дописать
 * `fieldProps`»: связка «поле ↔ его ошибка» перестаёт быть договорённостью.
 */
export function Field({
  name,
  label,
  required = false,
  error,
  hint,
  className,
  labelClassName,
  children,
}: FieldProps): ReactElement {
  const message = messageOf(error);
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={name} className={labelClassName}>
        {label}
        {required ? " *" : ""}
      </Label>
      {children(fieldProps(name, message))}
      {hint !== undefined && hint !== "" && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
      <FieldErrorText id={name} error={message} />
    </div>
  );
}

/**
 * Разложить ответ 400/422 по полям формы.
 *
 * `map` переводит имена полей API в имена полей формы. Всё, что перевести не
 * удалось (`detail`, `non_field_errors`, незнакомый ключ), возвращается в
 * `rest` — это сводка формы, а не ошибка поля.
 *
 * До этого полевой отказ печатался как есть: человек читал «date_from: Ensure
 * this value…» и не понимал, какое из двух полей с датой чинить.
 *
 * `fields` — те поля, которые удалось отметить: по ним ведётся фокус, потому
 * что `formState.errors` в этот момент ещё не пересобран.
 */
export function applyServerErrors<T extends FieldValues>(
  setError: UseFormSetError<T>,
  payload: unknown,
  map: Readonly<Record<string, Path<T>>> = {}
): { fields: string[]; rest: string[] } {
  if (typeof payload === "string") {
    return { fields: [], rest: payload === "" ? [] : [payload] };
  }
  if (Array.isArray(payload)) {
    return { fields: [], rest: payload.map(textOf).filter((s) => s !== "") };
  }
  if (payload === null || typeof payload !== "object") {
    return { fields: [], rest: [] };
  }

  const fields: string[] = [];
  const rest: string[] = [];
  for (const [key, raw] of Object.entries(payload as Record<string, unknown>)) {
    const text = textOf(raw);
    if (text === "") continue;
    if (key === "detail" || key === "message" || key === "non_field_errors") {
      rest.push(text);
      continue;
    }
    const field = map[key];
    if (field !== undefined) {
      setError(field, { type: "server", message: text });
      fields.push(field);
    } else {
      rest.push(`${key}: ${text}`);
    }
  }
  return { fields, rest };
}

/** Значение ошибки от API в читаемую строку: там бывает и строка, и список. */
function textOf(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.map(textOf).filter((s) => s !== "").join(", ");
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "object") {
    const values = Object.values(raw as Record<string, unknown>);
    return values.map(textOf).filter((s) => s !== "").join(" ");
  }
  return String(raw);
}
