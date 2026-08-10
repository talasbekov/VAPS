"use client";

// Маршрут журнала изменений порта. Сам журнал — features/ops-changelog:
// у вью есть проп-шов fixes (порт обратной связи заменит дефолт на запрос),
// а page-экспорт Next пропов, кроме params/searchParams, не принимает.
import { ChangelogView } from "@/features/ops-changelog/changelog-view";

export default function OpsChangelogPage() {
  return <ChangelogView />;
}
