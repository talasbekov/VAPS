"use client";

import { useId } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

const example = 'Подготовь наряд на внутреннее мероприятие «Встреча» 25.10.2026 на объекте Аккорда. Запроси во втором департаменте 4 человека, в шестом 6.';

/** Same controlled input on the workdesk and detailed assistant. Writer owns submission/retry. */
export function AssistantBrief({ value, onChange, disabled, pending, onSubmit, reviewBeforeExecute = false }: {
  value: string; onChange(value: string): void; disabled: boolean; pending: boolean; onSubmit(): void; reviewBeforeExecute?: boolean;
}) {
  const id = useId();
  return <form onSubmit={event => { event.preventDefault(); if (!disabled && value.trim()) onSubmit(); }}>
    <label className="block text-lg font-semibold tracking-tight" htmlFor={id}>Какой наряд нужно подготовить?</label>
    <textarea id={id} className="mt-3 min-h-32 w-full resize-y rounded-xl border border-input bg-background p-4 text-base leading-relaxed text-foreground disabled:opacity-60"
      maxLength={4000} disabled={disabled} value={value} onChange={event => onChange(event.target.value)}
      placeholder="Например: наряд на Аккорду на 23 октября, 200 человек" />
    <details className="mt-2 text-sm text-muted-foreground"><summary className="min-h-9 cursor-pointer py-2">Пример поручения</summary>
      <p className="mt-1 leading-relaxed">{example}</p>
      <button type="button" className="mt-2 min-h-9 font-medium text-primary-ink underline" disabled={disabled} onClick={() => onChange(example)}>Вставить пример</button>
    </details>
    <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
      <Button type="submit" className="h-auto min-h-11 max-w-full whitespace-normal px-5 py-2" disabled={disabled || !value.trim()}>
        {pending ? 'Сохраняем поручение…' : reviewBeforeExecute ? 'Подготовить план' : 'Подготовить по поручению'}<ArrowUpRight className="ml-2 size-4 shrink-0" aria-hidden />
      </Button>
      <p className="max-w-80 text-xs leading-relaxed text-muted-foreground">{reviewBeforeExecute ? 'Сохранит поручение и подготовит план. Создание ОМ и отправка запросов требуют отдельного подтверждения.' : 'Сохранит поручение и уточнит недостающие сведения.'}</p>
    </div>
  </form>;
}
