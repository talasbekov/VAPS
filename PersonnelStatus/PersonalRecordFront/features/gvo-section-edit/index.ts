// Окно правки ОДНОГО раздела сводки (`GvoSectionDialog`) отсюда снято
// 06.09.2026 — Plane №803, решение заказчика. Компонент не отрисовывался НИ С
// ОДНОГО экрана: греп находил его только в собственном файле и в этой строке
// экспорта, а живая правка сводки идёт формой `widgets/gvo-summary/ui/
// GvoEditForm.tsx`. При этом его чинили дважды (№517, №693) — то есть работа
// уходила в код, которого человеку не видно, а дефект в нём нельзя было найти
// по симптому. Заказчик выбрал снять окно, а не подключать его.
//
// Каталог остался: `GvoVisitsDialog` рядом ЖИВОЙ — его открывает
// `widgets/gvo-summary/ui/GvoSummaryPanel.tsx`.
export { GvoVisitsDialog } from "./ui/GvoVisitsDialog";
export type { GvoVisitsDialogProps } from "./ui/GvoVisitsDialog";
