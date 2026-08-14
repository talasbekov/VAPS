"use client";

import { useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import {
  Users,
  Calendar,
  Umbrella,
  Stethoscope,
  FileText,
  Plane,
  GraduationCap,
  Trophy,
  Presentation,
  AlertCircle,
  Shield,
  Clock,
  ArrowRightLeft,
} from "lucide-react";

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
}

const absenceTypeConfig = {
  vacation: {
    label: "Отпуска",
    icon: Umbrella,
    color: "text-blue-600",
    bgColor: "text-blue-600",
  },
  leave_by_report: {
    label: "Отпуск по рапорту",
    icon: FileText,
    color: "text-yellow-600",
    bgColor: "text-yellow-600",
  },
  sick_leave: {
    label: "Больничные",
    icon: Stethoscope,
    color: "text-red-600",
    bgColor: "text-red-600",
  },
  business_trip: {
    label: "Командировки",
    icon: Plane,
    color: "text-indigo-600",
    bgColor: "text-indigo-600",
  },
  training: {
    label: "Учёба",
    icon: GraduationCap,
    color: "text-purple-600",
    bgColor: "text-purple-600",
  },
  competition: {
    label: "На соревнованиях",
    icon: Trophy,
    color: "text-pink-600",
    bgColor: "text-pink-600",
  },
  // Без записи здесь карточка молча пропадает (ниже `if (!config) return null`),
  // хотя бэкенд считает конференцию наравне с остальными типами.
  conference: {
    label: "На конференции",
    icon: Presentation,
    color: "text-violet-600",
    bgColor: "text-violet-600",
  },
  other_absence: {
    label: "Иные причины",
    icon: AlertCircle,
    color: "text-gray-600",
    bgColor: "text-gray-600",
  },
  on_duty: {
    label: "На дежурстве",
    icon: Shield,
    color: "text-indigo-600",
    bgColor: "text-indigo-600",
  },
  after_duty: {
    label: "После дежурства",
    icon: Clock,
    color: "text-cyan-600",
    bgColor: "text-cyan-600",
  },
  seconded_from: {
    label: "Прикомандирован из",
    icon: ArrowRightLeft,
    color: "text-orange-600",
    bgColor: "text-orange-600",
  },
  seconded_to: {
    label: "Откомандирован в",
    icon: ArrowRightLeft,
    color: "text-teal-600",
    bgColor: "text-teal-600",
  },
} as const;

// Анимированный счётчик
function AnimatedNumber({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const nodeRef = useRef<HTMLSpanElement>(null);
  const prevValue = useRef(0);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;

    const controls = animate(prevValue.current, value, {
      duration: 0.8,
      ease: "easeOut",
      onUpdate(v) {
        node.textContent = Math.round(v).toString();
      },
    });

    prevValue.current = value;

    return () => controls.stop();
  }, [value]);

  return (
    <span ref={nodeRef} className={className}>
      {value}
    </span>
  );
}

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

export function StatsCards({ stats, isLoading }: StatsCardsProps) {
  if (isLoading) {
    return (
      <div className="space-y-3 mb-3">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  <div className="h-4 w-24 bg-gray-200 animate-pulse rounded" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-8 w-16 bg-gray-200 animate-pulse rounded mb-2" />
                <div className="h-3 w-32 bg-gray-200 animate-pulse rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  const absenceTypes = Object.entries(stats.by_type) as Array<
    [keyof typeof absenceTypeConfig, number]
  >;

  return (
    <div className="space-y-3 mb-3">
      {/* Карточки по типам отсутствий */}
      <motion.div
        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={cardVariants}>
          <Card className="h-full hover:shadow-lg transition-shadow duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-lg font-medium">
                Всего сотрудников
              </CardTitle>
              <motion.div
                whileHover={{ rotate: 15, scale: 1.1 }}
                transition={{ type: "spring" as const, stiffness: 400 }}
              >
                <Users className="h-6 w-6 text-muted-foreground" />
              </motion.div>
            </CardHeader>
            <CardContent>
              <div className="text-6xl font-bold text-center w-full">
                <AnimatedNumber value={stats.staff_count} />
              </div>
              <p className="text-muted-foreground mt-1">В подразделении</p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={cardVariants}>
          <Card className="h-full hover:shadow-lg transition-shadow duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-lg font-medium">
                Всего отсутствий
              </CardTitle>
              <motion.div
                whileHover={{ rotate: 15, scale: 1.1 }}
                transition={{ type: "spring" as const, stiffness: 400 }}
              >
                <Calendar className="h-6 w-6 text-muted-foreground" />
              </motion.div>
            </CardHeader>
            <CardContent>
              <div className="text-6xl font-bold text-center w-full">
                <AnimatedNumber value={stats.total_absences} />
              </div>
              <p className="text-muted-foreground mt-1">На сегодняшний день</p>
            </CardContent>
          </Card>
        </motion.div>

        {absenceTypes.map(([type, count]) => {
          const config = absenceTypeConfig[type];
          if (!config) return null;

          const Icon = config.icon;
          return (
            <motion.div key={type} variants={cardVariants}>
              <Card className="flex flex-col h-full hover:shadow-lg transition-shadow duration-300">
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2 px-4 pt-4 flex-shrink-0 min-h-[3.5rem]">
                  <CardTitle className="text-lg font-medium leading-tight pr-2 flex-1 line-clamp-2">
                    {config.label}
                  </CardTitle>
                  <motion.div
                    whileHover={{ rotate: 15, scale: 1.1 }}
                    transition={{ type: "spring" as const, stiffness: 400 }}
                  >
                    <Icon
                      className={`h-6 w-6 ${config.color} flex-shrink-0 mt-0.5`}
                    />
                  </motion.div>
                </CardHeader>
                <CardContent className="flex-1 flex items-center justify-center pt-0 pb-4 px-4">
                  <div
                    className={`text-6xl font-bold ${config.bgColor} text-center w-full`}
                  >
                    <AnimatedNumber value={count} />
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}
