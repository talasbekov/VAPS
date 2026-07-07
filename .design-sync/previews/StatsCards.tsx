import { StatsCards } from "my-v0-project";

// Реалистичная сводка департамента: 412 по списку, 44 отсутствуют.
const stats = {
  staff_count: 412,
  total_absences: 44,
  by_type: {
    vacation: 12,
    leave_by_report: 3,
    sick_leave: 6,
    business_trip: 7,
    training: 4,
    competition: 2,
    other_absence: 1,
    on_duty: 4,
    after_duty: 2,
    seconded_from: 1,
    seconded_to: 2,
  },
};

// 1) В headless-капче stagger-анимация framer-motion не доигрывается:
//    карточки остаются в initial="hidden" (inline opacity: 0, y: 20).
//    Скоуп-CSS с !important перебивает inline-стили и фиксирует конечное
//    состояние без пересборки Tailwind.
// 2) zoom 0.6 — полный дашборд (13 карточек, 5 рядов по 3 колонки на
//    md-вьюпорте) выше вьюпорта капчи 900x700; уменьшаем, чтобы влез целиком.
export const DashboardStats = () => (
  <div data-ds-static="" style={{ zoom: 0.6 }}>
    <style>{`[data-ds-static] * { opacity: 1 !important; transform: none !important; }`}</style>
    <StatsCards stats={stats} />
  </div>
);

export const LoadingState = () => <StatsCards stats={null} isLoading />;
