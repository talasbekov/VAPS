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
  /** Запрос статистики не удался — плитки не «нулевые», а неизвестные. */
  isError?: boolean;
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
  onRetry,
}: StatsCardsProps) {
  if (isLoading) {
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
