"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { motion } from "framer-motion";
import { LoadFailure } from "@/components/load-failure";

interface StatsCardsProps {
  stats: {
    staff_count: number;
    total_absences: number;
    by_type: {
      vacation: number;
      leave_by_report: number;
      sick_leave: number;
      business_trip: number;
      training: number;
      competition: number;
      conference: number;
      other_absence: number;
      on_duty: number;
      after_duty: number;
      seconded_from: number;
      seconded_to: number;
    };
  } | null;
  isLoading?: boolean;
  compact?: boolean;
  /** Запрос статистики не удался — плитки не «нулевые», а неизвестные. */
  isError?: boolean;
  /** ПОЧЕМУ не удался (Plane №340). `unlinked` — учётка не привязана к
   *  сотруднику: сводка считается по ЕГО подразделению, и без привязки
   *  считать её не по чему. Это штатное состояние служебной учётки, и
   *  предлагать «повторить» здесь — предлагать чинить то, что не сломано. */
  failure?: "unlinked" | "other" | null;
  onRetry?: () => void;
}

const absenceTypeConfig = {
  vacation: { label: "Отпуска" },
  leave_by_report: { label: "Отпуск по рапорту" },
  sick_leave: { label: "Больничные" },
  business_trip: { label: "Командировки" },
  training: { label: "Учёба" },
  competition: { label: "На соревнованиях" },
  // Без записи здесь карточка молча пропадает (ниже `if (!config) return null`),
  // хотя бэкенд считает конференцию наравне с остальными типами.
  conference: { label: "На конференции" },
  other_absence: { label: "Иные причины" },
  on_duty: { label: "На дежурстве" },
  after_duty: { label: "После дежурства" },
  seconded_from: { label: "Прикомандирован" },
  seconded_to: { label: "Откомандирован" },
} as const;

// Варианты анимации для контейнера
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.1,
    },
  },
} as const;

// Варианты анимации для карточек
const cardVariants = {
  hidden: {
    opacity: 0,
    y: 20,
    scale: 0.95,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: "spring" as const,
      stiffness: 300,
      damping: 24,
    },
  },
};

export function StatsCards({
  stats,
  isLoading,
  isError,
  failure = null,
  onRetry,
  compact = false,
}: StatsCardsProps) {
  if (isLoading) {
    if (compact) return <div role="status" className="h-24 animate-pulse rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">Загрузка сводки…</div>;
    return (
      <div className="space-y-3 mb-3">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  <div className="h-4 w-24 bg-muted animate-pulse rounded" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-8 w-16 bg-muted animate-pulse rounded mb-2" />
                <div className="h-3 w-32 bg-muted animate-pulse rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // ШТАТНОЕ СОСТОЯНИЕ, А НЕ СБОЙ (Plane №340). Служебная учётка к сотруднику
  // не привязана, и сводка по «его подразделению» для неё не существует.
  // Обход 28 ролевых учёток 30.08.2026 показал: все 28 видели здесь «Не
  // удалось загрузить сводку… Повторить» — то есть приглашение чинить то,
  // что не сломано. Кнопки повтора тут нет намеренно: повтор ничего не
  // изменит, привязку заводит кадровая служба.
  if (failure === "unlinked") {
    return (
      <div className="mb-3">
        <div
          role="status"
          className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground"
        >
          Сводка по личному составу считается по подразделению сотрудника, а эта
          учётная запись с сотрудником не связана. Служебные учётные записи
          заводятся без привязки — связать её может кадровая служба.
        </div>
      </div>
    );
  }

  // `return null` при отсутствии данных превращал сбой статистики в молчаливо
  // пустой дашборд: ни цифр, ни объяснения, ни кнопки.
  if (isError === true || !stats) {
    return (
      <div className="mb-3">
        <LoadFailure
          what="сводку по личному составу"
          onRetry={onRetry}
          className="rounded-xl border bg-card px-4"
        />
      </div>
    );
  }

  const absenceTypes = Object.entries(stats.by_type) as Array<
    [keyof typeof absenceTypeConfig, number]
  >;

  if (compact) {
    return (
      <div className="rounded-xl border bg-card px-4 py-3">
        <p className="mb-1 text-xs text-muted-foreground">Сводка подразделения на сегодняшний день</p>
        <dl className="flex flex-wrap gap-x-10 gap-y-3">
          <div className="flex items-baseline gap-3">
            <dt className="text-sm text-muted-foreground">Всего сотрудников</dt>
            <dd className="text-2xl font-semibold tabular-nums">{stats.staff_count}</dd>
          </div>
          <div className="flex items-baseline gap-3">
            <dt className="text-sm text-muted-foreground">Всего отсутствий</dt>
            <dd className="text-2xl font-semibold tabular-nums">{stats.total_absences}</dd>
          </div>
        </dl>
        <details className="mt-2 text-sm">
          <summary className="w-fit cursor-pointer rounded text-primary-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">Подробная сводка статусов</summary>
          <dl className="mt-3 grid gap-x-8 gap-y-2 border-t pt-3 sm:grid-cols-2 lg:grid-cols-3">
            {absenceTypes.map(([type, count]) => absenceTypeConfig[type] && (
              <div key={type} className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">{absenceTypeConfig[type].label}</dt>
                <dd className="font-semibold tabular-nums">{count}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
    );
  }

  return (
    <div className="space-y-3 mb-3">
      {/* Карточки по типам отсутствий */}
      <motion.div
        // На 375 px две колонки давали ~90 px под русскую подпись — видно было
        // 8-10 символов («Командиро», «На соревнован»). До sm карточка занимает
        // всю ширину, дальше сетка прежняя.
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={cardVariants}>
          <StatCard label="Всего сотрудников" value={stats.staff_count} caption="В подразделении" />
        </motion.div>

        <motion.div variants={cardVariants}>
          <StatCard
            label="Всего отсутствий"
            value={stats.total_absences}
            caption="На сегодняшний день"
          />
        </motion.div>

        {absenceTypes.map(([type, count]) => {
          const config = absenceTypeConfig[type];
          if (!config) return null;

          return (
            <motion.div key={type} variants={cardVariants}>
              <StatCard label={config.label} value={count} />
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}
