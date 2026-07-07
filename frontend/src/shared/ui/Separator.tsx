// Вендоренный shadcn/ui Separator (канон new-york, TW v3-стиль; Д2) поверх
// @radix-ui/react-separator (decorative по умолчанию — вне a11y-дерева).
import { Root as SeparatorPrimitive } from '@radix-ui/react-separator'
import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

export function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: ComponentProps<typeof SeparatorPrimitive>) {
  return (
    <SeparatorPrimitive
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-[1px] w-full' : 'h-full w-[1px]',
        className,
      )}
      {...props}
    />
  )
}
