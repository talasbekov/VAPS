"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
      <Icon className="mr-3 h-4 w-4 shrink-0" aria-hidden="true" />
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

  // Прокрутка меню — штатное состояние, а не авария: пунктов больше, чем
  // помещается на вьюпорте ноутбука, и уменьшать их ради влезания запрещено
  // (см. комментарий у ITEM_CLASS). Значит прокрутке нужны две вещи, без
  // которых она превращается в спрятанные пункты:
  //
  //   1. ВИДИМЫЙ признак, что список продолжается ниже, — иначе последний
  //      видимый пункт читается как последний вообще;
  //   2. активный пункт в зоне видимости при загрузке — иначе «вы здесь»
  //      есть в разметке, но не на экране.
  const navRef = useRef<HTMLElement | null>(null);
  const [hasMoreBelow, setHasMoreBelow] = useState(false);
  const [hasMoreAbove, setHasMoreAbove] = useState(false);
  // Пока человек не тронул список сам, подводка вправе им распоряжаться;
  // после первой РУЧНОЙ прокрутки — нет, иначе любое изменение размеров
  // дёргало бы список обратно из-под руки.
  const userScrolledRef = useRef(false);
  const selfScrollRef = useRef(false);

  const syncScrollHint = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    // Полпикселя допуска: дробные высоты строк дают остаток, при котором
    // «до низа доскроллено» иначе никогда не становится правдой.
    setHasMoreBelow(nav.scrollHeight - nav.scrollTop - nav.clientHeight > 0.5);
    setHasMoreAbove(nav.scrollTop > 0.5);
  }, []);

  const handleScroll = useCallback(() => {
    if (selfScrollRef.current) {
      selfScrollRef.current = false;
    } else {
      userScrolledRef.current = true;
    }
    syncScrollHint();
  }, [syncScrollHint]);

  const revealActive = useCallback(() => {
    const nav = navRef.current;
    if (!nav || userScrolledRef.current) return;
    const link = nav.querySelector('a[aria-current="page"]');
    if (!link) return;
    const navBox = nav.getBoundingClientRect();
    const linkBox = link.getBoundingClientRect();
    // Нижний зазор больше высоты градиента-подсказки (32px): подведя пункт
    // впритык к нижнему краю, мы спрятали бы его под собственной подсказкой.
    const BOTTOM_INSET = 40;
    const TOP_INSET = 12;
    let delta = 0;
    if (linkBox.top < navBox.top + TOP_INSET) {
      delta = linkBox.top - navBox.top - TOP_INSET;
    } else if (linkBox.bottom > navBox.bottom - BOTTOM_INSET) {
      delta = linkBox.bottom - navBox.bottom + BOTTOM_INSET;
    }
    if (delta === 0) return;
    // Считаем по СВОЕМУ контейнеру, а не через scrollIntoView: тот прокручивает
    // всех прокручиваемых предков, включая окно, и уводил бы вниз саму страницу.
    selfScrollRef.current = true;
    nav.scrollTop += delta;
    syncScrollHint();
  }, [syncScrollHint]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    // 🔴 ResizeObserver здесь не для красоты. Карточка роли рисуется только
    // когда доехал `user`, то есть ПОСЛЕ первого кадра: меню в этот момент
    // становится ниже на её высоту (~57px). Подводка, отработавшая один раз
    // на монтировании, оказывалась короткой ровно на эту величину, и активный
    // пункт снова уходил под нижний край.
    const observer = new ResizeObserver(() => {
      syncScrollHint();
      revealActive();
    });
    observer.observe(nav);
    syncScrollHint();
    revealActive();
    return () => observer.disconnect();
  }, [syncScrollHint, revealActive]);

  // Смена адреса — новая цель подводки, и право на неё возвращается: человек
  // прокрутил список ради ПРОШЛОГО экрана, к новому это отношения не имеет.
  useEffect(() => {
    userScrolledRef.current = false;
    revealActive();
  }, [activeHref, revealActive]);

  return (
    <aside className="h-screen w-full bg-sidebar border-r border-sidebar-border shadow-lg flex flex-col">
      {/* Логотип */}
      <div
        data-slot="sidebar-brand"
        className="bg-sidebar border-sidebar-border flex h-16 flex-shrink-0 items-center gap-[11px] border-b px-[18px]"
      >
        {/* Прототип: плитка 36px, radius 10px, bg-primary, белый текст 800/13px.
            Заливка ушла с шапки на плитку — шапка стала светлой.
            Ужимание шапки 64→48px ради лишних пунктов отменено вместе с
            остальной погоней за влезанием — см. комментарий у ITEM_CLASS. */}
        <div className="bg-primary text-primary-foreground grid size-9 shrink-0 place-items-center rounded-[10px] text-[13px] font-extrabold">
          ПР
        </div>
        <div className="min-w-0">
          <div className="text-sidebar-foreground truncate text-base font-bold leading-5 tracking-[.06em]">
            Проект Расход
          </div>
          <div className="text-sidebar-foreground/55 truncate text-xs leading-4">
            Учёт личного состава
          </div>
        </div>
      </div>

      {/* Навигация. Ссылки — next/link: раньше это были сырые <a>, и каждый
          клик по меню перезагружал документ (сброс кэша запросов, повторный
          бутстрап раздела, потеря позиции прокрутки). */}
      {/* Обёртка нужна градиенту: он лежит НАД прокруткой, а не внутри неё —
          иначе уезжал бы вместе с содержимым и был бы виден только внизу. */}
      <div className="relative min-h-0 flex-1">
        <nav
          ref={navRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto px-4 py-3"
          aria-label="Основная навигация"
        >
          {visibleCategories.map((category, categoryIndex) => {
            const headingId = `sidebar-category-${categoryIndex}`;
            return (
              <div key={category.title} className={categoryIndex > 0 ? "mt-4" : undefined}>
                {/* Заголовок категории — настоящий h2, а не подпись: категории
                    стали единственной структурой меню, и скринридер должен уметь
                    прыгать по ним, а не читать список из 20 ссылок подряд.
                    Капс делает CSS — в разметке естественный регистр, иначе
                    теряются акронимы («ОМ», «ГВО»). */}
                <h2
                  id={headingId}
                  className="text-sidebar-foreground/60 mx-3 mb-1 text-xs font-bold leading-4 tracking-[.1em] uppercase"
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
        {/* Признаки продолжения списка. `aria-hidden` — они дублируют то, что
            скринридер и так знает по разметке; для глаза это единственная
            подсказка, что список продолжается за краем.

            Верхний нужен не меньше нижнего: прокрутившись, список упирается в
            шапку, и заголовок категории режется ровно пополам — обрывок текста
            под краем читается как брак вёрстки, а не как «выше есть ещё». */}
        <div
          data-slot="sidebar-scroll-hint-top"
          aria-hidden="true"
          className={`from-sidebar pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b to-transparent transition-opacity duration-200 ${
            hasMoreAbove ? "opacity-100" : "opacity-0"
          }`}
        />
        <div
          data-slot="sidebar-scroll-hint"
          aria-hidden="true"
          className={`from-sidebar pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t to-transparent transition-opacity duration-200 ${
            hasMoreBelow ? "opacity-100" : "opacity-0"
          }`}
        />
      </div>

      {/* Информация о роли */}
      {userRole && (
        <div
          className="border-sidebar-border flex items-center gap-2.5 border-t px-4 py-3 sidebar-role-card"
          // Описание роли и отдел не помещаются в строку при 256px — уходят в
          // title, а не пропадают совсем.
          title={`${userRole.description}. Отдел: ${user?.department}`}
        >
          <div className="min-w-0 flex-1">
            {/* Кегли по той же шкале, что и меню (12/14). Однострочный вариант
                на 10/12px был частью погони за высотой — отменён вместе с ней. */}
            <p className="text-sidebar-foreground/60 text-xs uppercase leading-4 tracking-[.1em]">
              Текущая роль
            </p>
            <p className="text-sidebar-foreground truncate text-sm font-semibold leading-5">
              {userRole.name}
            </p>
          </div>
        </div>
      )}
    </aside>
  );
}
