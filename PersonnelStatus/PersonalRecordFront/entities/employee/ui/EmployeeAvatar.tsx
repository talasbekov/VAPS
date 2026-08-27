"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * Аватарка сотрудника — ОДНО правило на все экраны (Plane №206).
 *
 * ЗАЧЕМ ОТДЕЛЬНЫМ КОМПОНЕНТОМ. Фотография показывается в реестре, в карточке
 * и в дереве оргструктуры. Три копии «картинка, а если нет — заглушка»
 * разъезжаются на первой же правке: в одном месте круг, в другом квадрат, в
 * третьем битая картинка вместо инициалов.
 *
 * ЗАГЛУШКА — ИНИЦИАЛЫ, А НЕ КАРТИНКА-ЧЕЛОВЕЧЕК. У 426 человек стенда
 * одинаковый серый силуэт не несёт ни бита; инициалы различают строки и
 * читаются в списке. `AvatarFallback` показывается И когда адреса нет вовсе,
 * И когда файл не загрузился — то есть битый файл даёт инициалы, а не
 * сломанную иконку браузера.
 *
 * АДРЕС НЕ ВЫДУМЫВАЕТСЯ. Пустой `photo` — это «фотографии нет»; склеивать
 * путь с префиксом «по соглашению» нельзя, адрес приходит с сервера готовым
 * (`photo_url`).
 *
 * РАЗМЕР ЗАДАН ЯВНО и в пикселях: место под картинку резервируется до
 * загрузки, иначе строка таблицы прыгает по мере прихода четырёх сотен
 * файлов.
 *
 * ALT ПУСТОЙ СОЗНАТЕЛЬНО. Рядом с аватаркой всегда стоит имя; описательный
 * `alt` заставил бы скринридер прочитать его дважды. Картинка здесь —
 * украшение строки, а не её содержание.
 */
const SIZES = {
  sm: "size-9", // строка таблицы: 36 px, при высоте строки в 64 px
  md: "size-12",
  lg: "size-16", // шапка карточки
} as const;

export type EmployeeAvatarSize = keyof typeof SIZES;

export function initialsOf(name: string): string {
  return name
    .split(" ")
    .filter((part) => part !== "")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function EmployeeAvatar({
  name,
  photo,
  size = "sm",
  className,
}: {
  name: string;
  photo?: string | null;
  size?: EmployeeAvatarSize;
  className?: string;
}) {
  const src = photo != null && photo !== "" ? photo : undefined;

  return (
    // `aria-hidden` на всей аватарке, включая инициалы: рядом стоит имя, и
    // скринридер иначе прочитал бы «А С Абенов Санжар». Инициалы — картинка,
    // набранная буквами, а не содержание строки.
    <Avatar aria-hidden="true" className={cn(SIZES[size], "shrink-0", className)}>
      {src !== undefined && (
        <AvatarImage
          src={src}
          alt=""
          loading="lazy"
          // Лицо на фотографии выше центра кадра: обрезка по центру срезает
          // макушку у половины снимков.
          className="object-cover object-top"
        />
      )}
      <AvatarFallback
        className={cn(
          "font-medium text-muted-foreground",
          size === "sm" ? "text-xs" : "text-lg"
        )}
      >
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  );
}
