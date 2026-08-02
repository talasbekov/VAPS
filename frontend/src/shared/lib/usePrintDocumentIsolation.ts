// Изоляция ПЕЧАТНОГО документа от классов каркаса (Этап M2 host-переноса).
//
// Печатный канон: в документе — только print-классы (placement-print.spec).
// В Vite документ чист сам по себе, но при монтировании SPA внутрь host-
// приложения (PersonalRecordFront/Next) корневой layout вешает на <html>
// шрифт-переменные next/font и antialiased — печатная форма наследовала бы
// чужую типографику каркаса. На время печатного маршрута классы снимаются и
// возвращаются при уходе: печать монопольна по построению.
import { useLayoutEffect } from 'react'

export function usePrintDocumentIsolation(): void {
  useLayoutEffect(() => {
    const html = document.documentElement
    const body = document.body
    const previous = { html: html.className, body: body.className }
    html.className = ''
    body.className = ''
    return () => {
      html.className = previous.html
      body.className = previous.body
    }
  }, [])
}
