"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useId,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { moduleOpenFor } from "@/entities/portal-access";
import { useSecurityEvents } from "@/hooks/use-security-events";
import { InDevelopmentBadge } from "@/components/in-development-badge";
import {
  inDevelopmentOfRoute,
  inDevelopmentSummary,
} from "@/shared/config/in-development";
import { useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Car,
  ClipboardCheck,
  ClipboardList,
  FileText,
  KeyRound,
  Landmark,
  LineChart,
  MessageSquarePlus,
  Scale,
  ScrollText,
  Settings,
  Shield,
  ShieldCheck,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import "./sidebar.css";

/** Активность пункта: `trailingSlash: true` в конфиге, хвостовой слэш есть. */
function normalizePath(path: string): string {
  return path !== "/" && path.endsWith("/") ? path.slice(0, -1) : path;
}

// Общий вид пункта: единственное место, где живёт разметка ссылки меню.
//
// 🔴 История и урок (22.08.2026). Меню дважды жали, чтобы все 19 пунктов
// влезли в вьюпорт ноутбука: кегль дошёл до 13px, пункт до 22px, зазор до
// 2px — шаг ровно 24px. 24px — это ПОЛ WCAG 2.2 AA (2.5.8 Target Size), то
// есть граница соответствия, а не цель проектирования: спроектировав ровно
// по ней, меню получило вид «мелко и тесно» — так его и прочитал заказчик.
// Курс отменён. Правило теперь такое:
//
//   размер строки НЕ разменивается на количество видимых пунктов.
//
// Пункт 36px, кегль 14px, зазор 4px (шаг 40px) — комфортная плотность, а не
// пороговая. Пунктов больше, чем помещается на 648px, и это нормально:
// список прокручивается, у прокрутки есть видимый признак (градиент внизу),
// а активный пункт подводится в зону видимости сам. Сторожи в
// e2e/prototype-skin.spec.ts пинят ЧИТАЕМОСТЬ (кегль, высоту, шаг) и
// достижимость нижних пунктов — не влезание любой ценой.
const ITEM_CLASS =
  "flex items-center rounded-[9px] px-3 py-2 text-sm leading-5 font-medium transition-colors";

type NavItem = {
  name: string;
  href: string;
  icon: LucideIcon;
  // Право пункта здесь НЕ пишется: оно берётся по адресу из
  // `entities/portal-access` — того же источника, из которого его берёт гейт
  // самой страницы.
  //
  // 🔴 ПРАВИЛО ИЗМЕНИЛОСЬ ДВАЖДЫ ЗА ДЕНЬ, и оба раза по решению заказчика.
  // 31.08.2026, Plane №350: раньше тут стояло «прав у пунктов ОМ нет
  // намеренно: их считают сами страницы, и дублировать решение в меню значило
  // бы завести вторую правду о видимости». Довод был верным, вывод — нет: под
  // ролью «Сотрудник» в меню оставалось десять пунктов из шестнадцати, каждый
  // отвечал «Доступ закрыт», и это читается как сломанная система. Второй
  // правды не появилось — появился ОДИН источник на меню и на страницу.
  // 31.08.2026, Plane №352: пара `resource`/`action` (права зашитой
  // портальной роли из `lib/auth.tsx`) снята вовсе. Заказчик потребовал
  // работать по семи ролям, а они живут в каталоге РАЗДЕЛА; портальные пункты
  // теперь спрашивают его же.
  // Адреса, на которых пункт тоже подсвечивается. Нужен там, где у одного
  // экрана два входа: «Обратная связь» отрисована на /feedback, но открывается
  // и по /security-ops/feedback (реализация одна, адреса два).
  match?: string[];
  /** Пункт несёт бейдж-счётчик прототипа. Число берётся ТОЛЬКО из ответа
   * сервера: счётчик в меню — обещание «здесь столько-то дел», и выдуманное
   * число врёт на каждой странице приложения сразу. */
  counter?: "events";
};

// Категории нераскрываемые: заголовок — не кнопка, список под ним всегда
// виден. Прежний аккордеон (aria-expanded + ChevronDown) убран целиком —
// состояние группы больше не существует, значит и хранить его нечем.
const CATEGORIES: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Личный кабинет",
    items: [
      { name: "Мой профиль", href: "/security-ops/profile", icon: UserRound },
      { name: "Сотрудники Службы", href: "/service-employees", icon: Users },
    ],
  },
  {
    title: "Ежедневный расход",
    items: [
      { name: "Командный центр", href: "/security-ops/command-center", icon: LineChart },
      { name: "Обзор", href: "/dashboard", icon: BarChart3 },
      { name: "Статусы сотрудников", href: "/statuses", icon: Shield },
      { name: "Сбор сил на ОМ", href: "/employees", icon: Users },
      { name: "Аналитика службы", href: "/security-ops/analytics", icon: LineChart },
      { name: "Ежедневный отчет", href: "/reports", icon: FileText },
      // CSV «Расход личного состава» формирует маршрут service-reports, но
      // относится к Службе, а не к конкретному охранному мероприятию. URL и
      // его `report.generate` остаются прежними: меняется только понятный
      // человеку вход, без второй копии экрана в меню (Plane №1071).
      { name: "Отчёты по Службе", href: "/security-ops/service-reports", icon: ScrollText },
