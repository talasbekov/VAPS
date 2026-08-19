"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-border [&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "bg-muted/50 border-t font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        // Разделитель СВЕТЛЕЕ внешней рамки — так в прототипе (210 40% 95%
        // против 214.3 31.8% 91.4%). Зебры в прототипе нет.
        "border-table-divider hover:bg-muted/40 data-[state=selected]:bg-muted border-b transition-colors",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        // Значения сняты из прототипа: padding:10px 14px; font-size:11px;
        // font-weight:600; color:--muted-foreground; background:hsl(210 40% 98%).
        // Регистр НЕ задаётся: см. e2e/tables-data.spec.ts — заголовки пинятся
        // по тексту, а в прототипе text-transform на th нет.
        // text-muted-foreground на bg-muted/50 давал 4.34-4.45:1 в светлой
        // теме — погранично ниже 4.5:1. `table-head-ink` — тот же оттенок,
        // на тон темнее в светлой теме (4.89-5.03:1 замерено); в тёмной теме
        // не меняется (там уже 7.92:1).
        "text-table-head-ink bg-muted/50 h-auto px-3.5 py-2.5 text-left align-middle text-[11px] font-semibold whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        // Прототип: padding:11px 10px; font-size:12.5px.
        "px-2.5 py-[11px] align-middle text-[12.5px] whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
