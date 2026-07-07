// Баррель для design-sync (claude.ai/design): поверхность дизайн-системы донора.
// Не импортируется приложением — служит entry-точкой бандла window.VapsUI.
// Сюда входят только презентационные компоненты; всё, что завязано на
// auth/данные (StatusTable, Header, Sidebar, OrgBoard…), намеренно исключено.

export * from "@/components/ui/alert";
export * from "@/components/ui/avatar";
export * from "@/components/ui/badge";
export * from "@/components/ui/button";
export * from "@/components/ui/calendar";
export * from "@/components/ui/card";
export * from "@/components/ui/checkbox";
export * from "@/components/ui/dialog";
export * from "@/components/ui/dropdown-menu";
export * from "@/components/ui/input";
export * from "@/components/ui/label";
export * from "@/components/ui/popover";
export * from "@/components/ui/progress";
export * from "@/components/ui/select";
export * from "@/components/ui/separator";
export * from "@/components/ui/table";
export * from "@/components/ui/tabs";
export * from "@/components/ui/textarea";
export * from "@/components/ui/toast";
export * from "@/components/ui/tooltip";

export { StatsCards } from "@/components/dashboard/stats-cards";
export { OrgNode } from "@/features/organization-structure/ui/OrgNode";
export { ThemeToggle } from "@/components/theme/ThemeToggle";

// Утилита стилевого идиома shadcn — дизайн-агенту нужна для композиции классов.
export { cn } from "@/lib/utils";
