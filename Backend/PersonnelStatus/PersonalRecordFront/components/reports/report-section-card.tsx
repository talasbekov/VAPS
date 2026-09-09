import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ReportSectionCardProps
  extends Omit<ComponentProps<"div">, "title"> {
  /** Иконка раздела — тот же язык, что у «живой» карточки /reports. */
  icon?: LucideIcon;
  iconClassName?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Доп. содержимое в шапке — например бейдж состояния рядом с заголовком. */
  headerExtra?: ReactNode;
  contentClassName?: string;
  children: ReactNode;
}

/**
 * Общий каркас карточки каталога отчётов (Plane №985, [ОТЧ-ОМ-02]): один
 * компонент для «Отчётов по Службе» (`/reports`) и «Отчётов по ОМ»
 * (`/security-ops/service-reports`), чтобы визуальный каркас не расходился
 * по модулям при следующей правке. Остальные `div`-пропы (`role`,
 * `aria-label` и т.п.) прокидываются в `Card` как есть — секции этого экрана
 * были ARIA-группами до переезда в карточки, терять разметку нельзя.
 */
export function ReportSectionCard({
  icon: Icon,
  iconClassName,
  title,
  description,
  headerExtra,
  className,
  contentClassName,
  children,
  ...rest
}: ReportSectionCardProps) {
  return (
    <Card className={className} {...rest}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {Icon ? <Icon className={cn("h-5 w-5", iconClassName)} /> : null}
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {headerExtra}
      </CardHeader>
      <CardContent className={cn("space-y-4", contentClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}
