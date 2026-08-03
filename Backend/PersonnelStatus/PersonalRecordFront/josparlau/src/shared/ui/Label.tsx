// Вендоренный shadcn/ui Label (канон new-york, TW v3-стиль; Д2). Нативный
// <label> вместо @radix-ui/react-label: пакет не в списке зависимостей стори
// (единственный бонус примитива — запрет выделения по даблклику, не стоит
// зависимости); контракт донора (htmlFor + peer-disabled) сохранён.
import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label
      className={cn(
        'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  )
}
