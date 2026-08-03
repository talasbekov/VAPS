// Вендоренный shadcn/ui Card (канон new-york, TW v3-стиль; Д2). Состав по
// контракту донора (prompt.md): Card/Header/Title/Description/Action/Content/
// Footer. CardAction у донора расставлен grid-хедером с :has() — FF100 его не
// умеет (появился в FF121), поэтому колонки заданы безусловно, а Title/
// Description прижаты к первой колонке явным col-start-1 (вид тот же).
import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-card text-card-foreground shadow',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'grid auto-rows-min grid-cols-[1fr_auto] items-start gap-y-1.5 p-6',
        className,
      )}
      {...props}
    />
  )
}

export function CardTitle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'col-start-1 font-semibold leading-none tracking-tight',
        className,
      )}
      {...props}
    />
  )
}

export function CardDescription({
  className,
  ...props
}: ComponentProps<'div'>) {
  return (
    <div
      className={cn('col-start-1 text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export function CardAction({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'col-start-2 row-span-2 row-start-1 self-start justify-self-end',
        className,
      )}
      {...props}
    />
  )
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-6 pt-0', className)} {...props} />
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('flex items-center p-6 pt-0', className)} {...props} />
  )
}
