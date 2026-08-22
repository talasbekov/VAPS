"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth, ROLES } from "@/lib/auth";
import {
  BarChart3,
  ClipboardList,
  FileText,
  Landmark,
  LineChart,
  MessageSquarePlus,
  Scale,
  ScrollText,
  Settings,
  Shield,
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
// Прототип: компактный пункт 13px, radius 9px. Было 15px/600 с px-4 py-3 —
// при 256px такие пункты переносились в две строки.
const ITEM_CLASS =
  "flex items-center rounded-[9px] px-3 py-2 text-[13px] font-medium transition-colors";

type NavItem = {
  name: string;
  href: string;
  icon: LucideIcon;
  // Права проверяются ТОЛЬКО у портальных экранов — там гвард живёт в хосте.
  // У экранов раздела ОМ прав здесь нет намеренно: их считают сами страницы
  // (hooks/use-ops-permissions), и дублировать решение в меню значило бы
  // завести вторую правду о видимости.
  resource?: string;
  action?: string;
  // Адреса, на которых пункт тоже подсвечивается. Нужен там, где у одного
  // экрана два входа: «Обратная связь» отрисована на /feedback, но открывается
  // и по /security-ops/feedback (реализация одна, адреса два).
  match?: string[];
};

// Категории нераскрываемые: заголовок — не кнопка, список под ним всегда
// виден. Прежний аккордеон (aria-expanded + ChevronDown) убран целиком —
// состояние группы больше не существует, значит и хранить его нечем.
const CATEGORIES: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Личный кабинет",
    items: [
      { name: "Мой профиль", href: "/security-ops/profile", icon: UserRound },
    ],
  },
  {
    title: "Ежедневный расход",
    items: [
      { name: "Командный центр", href: "/security-ops/command-center", icon: LineChart },
      { name: "Обзор", href: "/dashboard", icon: BarChart3, resource: "organization", action: "read" },
      { name: "Статусы сотрудников", href: "/statuses", icon: Shield, resource: "statuses", action: "read" },
      { name: "Сбор сил на ОМ", href: "/employees", icon: Users, resource: "employees", action: "read" },
      { name: "Аналитика службы", href: "/security-ops/analytics", icon: LineChart },
      { name: "Ежедневный отчет", href: "/reports", icon: FileText, resource: "reports", action: "read" },
    ],
  },
  {
    title: "Объекты",
    items: [
      { name: "Объекты и паспорта", href: "/security-ops/objects", icon: Landmark },
    ],
  },
  {
    title: "Охранные мероприятия",
    items: [
      { name: "Реестр ОМ", href: "/security-ops/events", icon: ClipboardList },
      // Реестр ГВО идёт сразу за реестром ОМ: его записи — проекция тех же
      // мероприятий, и появляются они вместе с бюллетенем.
      { name: "Реестр ГВО", href: "/security-ops/gvo", icon: Users },
      { name: "Охраняемые лица", href: "/security-ops/persons", icon: UserRound },
      { name: "Законы об ОМ", href: "/security-ops/laws", icon: Scale },
      // Экран существовал с 17.08.2026, но в меню не стоял никогда — на него
      // попадали только по ссылкам с других экранов.
      { name: "Аналитика ОМ", href: "/security-ops/analytics/operations", icon: LineChart },
      { name: "Отчеты по ОМ", href: "/security-ops/service-reports", icon: ScrollText },
    ],
  },
  {
    title: "Администрирование",
    items: [
      { name: "Справочники", href: "/security-ops/dictionaries", icon: ClipboardList },
      { name: "Настройки ОМ", href: "/security-ops/settings", icon: Settings },
      { name: "Аудит", href: "/security-ops/audit", icon: ScrollText },
      { name: "Журнал изменений", href: "/security-ops/changelog", icon: ClipboardList },
    ],
  },
  {
    title: "Обратная связь",
    items: [
      {
        name: "Обратная связь",
        href: "/feedback",
        icon: MessageSquarePlus,
        match: ["/security-ops/feedback"],
      },
    ],
  },
];

function NavLink({
  href,
  name,
  icon: Icon,
  active,
}: {
  href: string;
  name: string;
  icon: LucideIcon;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      // aria-current="page" — единственный признак «вы здесь», который читает
      // скринридер; цветом он же дублируется для глаза.
      aria-current={active ? "page" : undefined}
      className={`${ITEM_CLASS} ${
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent"
      }`}
    >
      <Icon className="mr-3 h-5 w-5 shrink-0" aria-hidden="true" />
      <span>{name}</span>
    </Link>
  );
}

export function Sidebar() {
  const { user, hasPermission } = useAuth();
  const userRole = user ? ROLES[user.role] : null;
  const pathname = normalizePath(usePathname() ?? "");

  // Подсвечивается ОДИН пункт — самый длинный подошедший адрес. Простое
  // `startsWith` зажигало бы «Аналитику службы» (/security-ops/analytics)
  // заодно с «Аналитикой ОМ» (/security-ops/analytics/operations): второй
  // адрес вложен в первый.
  const activeHref = CATEGORIES.flatMap((category) =>
    category.items.flatMap((item) =>
      [item.href, ...(item.match ?? [])].map((prefix) => ({ href: item.href, prefix }))
    )
  )
    .filter(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0]?.href;

  // FIX: на /security-ops пользователь может быть не залогинен в хост
  // (middleware эти пути не закрывает) — фильтр по правам оставлял меню
  // пустым, и модули «исчезали». Без host-логина показываем навигацию целиком
  // (страницы защищают себя сами); для залогиненных фильтр работает как раньше.
  const visibleCategories = CATEGORIES.map((category) => ({
    ...category,
    items: category.items.filter(
      (item) =>
        user === null ||
        item.resource === undefined ||
        hasPermission(item.resource, item.action ?? "read")
    ),
  })).filter((category) => category.items.length > 0);

  // Сквозной счётчик для stagger-анимации: задержка считается от начала
  // меню, а не от начала своей категории, иначе пункты разных категорий
  // выезжали бы одновременно.
  //
  // Задержка обрезана восемью шагами. Раньше свёрнутые группы не рендерили
  // своих пунктов, и до потолка дело не доходило; развернув все категории,
  // сквозной счётчик дорос до 19 — нижние пункты («Обратная связь») выезжали
  // почти через полторы секунды после загрузки. Эффект нужен на первых
  // строках, а не в качестве задержки для половины меню.
  const MAX_STAGGER_STEPS = 8;
  let itemIndex = -1;

  return (
    <aside className="h-screen w-full bg-sidebar border-r border-sidebar-border shadow-lg flex flex-col">
      {/* Логотип */}
      <div
        data-slot="sidebar-brand"
        className="bg-sidebar border-sidebar-border flex h-16 flex-shrink-0 items-center gap-[11px] border-b px-[18px]"
      >
        {/* Прототип: плитка 36px, radius 10px, bg-primary, белый текст 800/13px.
            Заливка ушла с шапки на плитку — шапка стала светлой. */}
        <div className="bg-primary text-primary-foreground grid size-9 shrink-0 place-items-center rounded-[10px] text-[13px] font-extrabold">
          ПР
        </div>
        <div className="min-w-0">
          <div className="text-sidebar-foreground truncate text-[15px] font-bold tracking-[.06em]">
            Проект Расход
          </div>
          <div className="text-sidebar-foreground/55 truncate text-[10.5px]">
            Учёт личного состава
          </div>
        </div>
      </div>

      {/* Навигация. Ссылки — next/link: раньше это были сырые <a>, и каждый
          клик по меню перезагружал документ (сброс кэша запросов, повторный
          бутстрап раздела, потеря позиции прокрутки). */}
      <nav className="mt-6 px-4 flex-1 overflow-y-auto" aria-label="Основная навигация">
        {visibleCategories.map((category, categoryIndex) => {
          const headingId = `sidebar-category-${categoryIndex}`;
          return (
            <div key={category.title} className={categoryIndex > 0 ? "mt-6" : undefined}>
              {/* Заголовок категории — настоящий h2, а не подпись: категории
                  стали единственной структурой меню, и скринридер должен уметь
                  прыгать по ним, а не читать список из 20 ссылок подряд.
                  Капс делает CSS — в разметке естественный регистр, иначе
                  теряются акронимы («ОМ», «ГВО»). */}
              <h2
                id={headingId}
                className="text-sidebar-foreground/45 mx-2.5 mb-1.5 text-[10px] font-bold tracking-[.12em] uppercase"
              >
                {category.title}
              </h2>
              <ul className="space-y-1" aria-labelledby={headingId}>
                {category.items.map((item) => {
                  itemIndex += 1;
                  return (
                    <li
                      key={item.href}
                      className="sidebar-nav-item"
                      style={{
                        animationDelay: `${Math.min(itemIndex, MAX_STAGGER_STEPS) * 50}ms`,
                      }}
                    >
                      <NavLink
                        href={item.href}
                        name={item.name}
                        icon={item.icon}
                        active={item.href === activeHref}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Информация о роли */}
      {userRole && (
        <div
          className="border-sidebar-border flex items-center gap-2.5 border-t px-3 py-2.5 sidebar-role-card"
          // Описание роли и отдел не помещаются в строку при 256px — уходят в
          // title, а не пропадают совсем.
          title={`${userRole.description}. Отдел: ${user?.department}`}
        >
          <div className="min-w-0 flex-1">
            <p className="text-sidebar-foreground/45 text-[10px] uppercase tracking-[.12em]">
              Текущая роль
            </p>
            <p className="text-sidebar-foreground truncate text-[12.5px] font-semibold">
              {userRole.name}
            </p>
          </div>
        </div>
      )}
    </aside>
  );
}
