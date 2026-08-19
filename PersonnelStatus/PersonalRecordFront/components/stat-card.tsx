import { cn } from "@/lib/utils";

type StatTone = "neutral" | "success" | "warning" | "danger" | "info";

const DOT_CLASS: Record<StatTone, string> = {
  neutral: "bg-muted-foreground",
  success: "bg-green-600",
  warning: "bg-amber-500",
  danger: "bg-destructive",
  info: "bg-primary",
};

const VALUE_CLASS: Record<StatTone, string> = {
  neutral: "",
  success: "text-green-700",
  warning: "text-amber-700",
  danger: "text-destructive-ink",
  info: "text-primary-ink",
};

interface StatCardProps {
  label: string;
  value: string | number;
  caption?: string;
  tone?: StatTone;
  className?: string;
}

/**
 * KPI-плитка в наборе прототипа: точка-индикатор, мелкий лейбл, число
 * 24px/800/tabular-nums, подпись.
 *
 * 🔴 Лейбл НЕ обрезается по ширине: прежние плитки резали «Командирові» и
 * «Прикоманди» посреди слова. Длинная подпись переносится, а не прячется.
 */
export function StatCard({ label, value, caption, tone = "neutral", className }: StatCardProps) {
  return (
    <div
      data-slot="stat-card"
      className={cn("bg-card rounded-xl border p-4", className)}
    >
      <div className="flex items-start gap-2">
        <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", DOT_CLASS[tone])} aria-hidden />
        <span
          data-slot="stat-label"
          className="text-muted-foreground text-[11px] leading-snug font-medium text-balance"
        >
          {label}
        </span>
      </div>
      <div
        data-slot="stat-value"
        className={cn("mt-[5px] text-2xl font-extrabold tabular-nums", VALUE_CLASS[tone])}
      >
        {value}
      </div>
      {caption ? (
        <div className="text-muted-foreground mt-1 text-[11px] leading-snug">{caption}</div>
      ) : null}
    </div>
  );
}
