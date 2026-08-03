// Канон-слот shared/lib (architecture L554-555). Склейка классов для
// shadcn-компонентов: clsx (условия) + tailwind-merge v2 (конфликты утилит
// TW v3). Barrel-index запрещён (скан lint-canon) — импортировать напрямую.
import { clsx } from 'clsx'
import type { ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
