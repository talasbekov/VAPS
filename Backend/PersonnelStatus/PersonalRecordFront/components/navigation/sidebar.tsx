"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth, ROLES } from "@/lib/auth";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { modulePermissionOf } from "@/entities/portal-access";
import { useSecurityEvents } from "@/hooks/use-security-events";
import { useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Car,
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
  // Портальные экраны гейтятся парой resource/action (права хоста,
  // `lib/auth.tsx`). У экранов РАЗДЕЛА ОМ право не пишется здесь: оно берётся
  // по адресу из `entities/portal-access`, того же источника, из которого его
  // берёт гейт самой страницы.
  //
  // 🔴 ПРАВИЛО ИЗМЕНИЛОСЬ 31.08.2026 (Plane №350, решение заказчика). Раньше
  // тут стояло «прав у пунктов ОМ нет намеренно: их считают сами страницы, и
  // дублировать решение в меню значило бы завести вторую правду о видимости».
  // Довод был верным, а вывод — нет: под ролью «Сотрудник» в меню оставалось
  // десять пунктов из шестнадцати, каждый из которых отвечает «Доступ закрыт»,
  // и заказчик прочитал это как сломанную систему. Второй правды при этом не
  // появилось — появился ОДИН источник на меню и на страницу.
  resource?: string;
  action?: string;
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
      { name: "Реестр ОМ", href: "/security-ops/events", icon: ClipboardList, counter: "events" },
      // Пункта «Реестр ГВО» здесь БОЛЬШЕ НЕТ (Plane «Реестр ОМ-35.8»):
      // заказчик снял модуль, сводка живёт панелью в карточке мероприятия
      // («Информация по ГВО»), а сводный взгляд — вкладкой «Визиты
      // иностранных ОЛ» внутри реестра ОМ. Отдельный пункт вернул бы третий
      // вход в одни и те же данные.
      { name: "Охраняемые лица", href: "/security-ops/persons", icon: UserRound },
      { name: "Законы об ОМ", href: "/security-ops/laws", icon: Scale },
      // Реестр транспорта ГОН (Plane №215): свой пункт, а не вкладка внутри
      // объектов — это парк службы, он живёт независимо от мероприятий и
      // читается сам по себе.
      { name: "Транспорт ГОН", href: "/security-ops/vehicles", icon: Car },
      // Экран существовал с 17.08.2026, но в меню не стоял никогда — на него
      // попадали только по ссылкам с других экранов.
      { name: "Аналитика ОМ", href: "/security-ops/analytics/operations", icon: LineChart },
      { name: "Отчеты по ОМ", href: "/security-ops/service-reports", icon: ScrollText },
    ],
  },
  {
    // Категория названа «Система», а пункт внутри неё — «Администрирование»
    // (решение заказчика 25.08.2026, Plane №50). До этого группа и её пункт
    // носили одно имя, и в меню две строки подряд читались как повтор, а
    // надзаголовок страницы совпадал с её же заголовком.
    title: "Система",
    items: [
      { name: "Справочники", href: "/security-ops/dictionaries", icon: ClipboardList },
      { name: "Администрирование", href: "/security-ops/settings", icon: Settings },
      // Экраны раздела доступа (Plane №36, шаги «П-6»…«П-8») существовали с
      // 26.08.2026, но в меню не стояли: на них попадали только по прямому
      // адресу. Права здесь НЕ проверяются — как и у остальных экранов ОМ:
      // видимость считают сами страницы (`useOpsPermissions`), и вторая
      // правда о ней в меню разошлась бы с первой. Без права раздел отвечает
      // «Доступ закрыт», а не пустой страницей.
      { name: "Права", href: "/settings/permissions", icon: KeyRound },
      { name: "Роли", href: "/settings/roles", icon: ShieldCheck },
      { name: "Пользователи", href: "/settings/users", icon: Users },
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
  counter,
}: {
  href: string;
  name: string;
  icon: LucideIcon;
  active: boolean;
  counter?: { value: number; hint: string };
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
      <span className="flex-1">{name}</span>
      {counter !== undefined && (
        // Бейдж — не «украшение справа»: для скринридера он часть имени
        // ссылки, иначе тот прочитает «Реестр ОМ 6» без объяснения, что за 6.
        <span
          data-slot="sidebar-counter"
          className="bg-sidebar-accent text-sidebar-accent-foreground ml-2 grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[11px] font-bold tabular-nums"
          title={counter.hint}
          aria-label={`${counter.hint}: ${counter.value}`}
        >
          {counter.value}
        </span>
      )}
    </Link>
  );
}

/** Инициалы для аватара подвала: две первые буквы слов имени. */
function initialsOf(name: string | undefined): string {
  if (name === undefined || name.trim() === "") return "—";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("");
}

/**
 * «Закрытый контур · связь есть» из подвала прототипа.
 *
 * Точка НЕ декоративная: она читает состояние САМОГО СВЕЖЕГО запроса
 * приложения (react-query знает, когда каждый из них последний раз ответил
 * или упал) и офлайн-признак браузера. Зелёная точка, нарисованная константой,
 * утверждала бы «связь есть» ровно в ту минуту, когда её нет, — это худший
 * вид индикатора, чем его отсутствие.
 */
function LinkStatus() {
  const client = useQueryClient();

  // 🔴 useSyncExternalStore, а не useState + подписка. Кэш запросов меняется
  // ВО ВРЕМЯ рендера других компонентов (панель закрытия дёргает свою мутацию
  // при монтировании), и setState из обработчика подписки давал React-варнинг
  // «Cannot update a component while rendering a different component» —
  // e2e закрытия ловил его как ошибку консоли.
  const subscribe = useCallback(
    (notify: () => void) => {
      const unsubscribe = client.getQueryCache().subscribe(notify);
      window.addEventListener("online", notify);
      window.addEventListener("offline", notify);
      return () => {
        unsubscribe();
        window.removeEventListener("online", notify);
        window.removeEventListener("offline", notify);
      };
    },
    [client]
  );

  const getSnapshot = useCallback((): boolean => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return false;
    }
    // Свежесть меряется по ПОСЛЕДНЕМУ ответу — неважно, удачному или нет:
    // старый успех не отменяет только что случившегося отказа, и наоборот.
    //
    // 🔴 Но «отказ» здесь — только СЕТЕВОЙ. 403 «нет права» это ОТВЕТ сервера,
    // то есть связь как раз есть: первая версия гасила индикатор у любой
    // персоны без права `event.view` — экран честно писал «связи нет» там, где
    // связь работала. Признак берётся у клиента ОМ: `kind === "network"`.
    let latest = 0;
    let latestOffline = false;
    for (const query of client.getQueryCache().getAll()) {
      const state = query.state;
      const stamp = Math.max(state.dataUpdatedAt, state.errorUpdatedAt);
      if (stamp === 0 || stamp < latest) continue;
      latest = stamp;
      const error = state.error as { kind?: string } | null;
      latestOffline = state.status === "error" && error?.kind === "network";
    }
    return latest === 0 ? true : !latestOffline;
  }, [client]);

  // Снимок — примитив: сравнение по значению, лишних перерисовок нет.
  // На сервере связь считается живой: индикатор о клиентском соединении, а
  // разметка первого кадра должна совпасть с серверной.
  const online = useSyncExternalStore(subscribe, getSnapshot, () => true);

  return (
    <p
      data-slot="sidebar-link-status"
      className="text-sidebar-foreground/60 flex items-center gap-1.5 px-1.5 text-xs leading-4"
    >
      <span
        aria-hidden="true"
        className={`size-[7px] shrink-0 rounded-full ${
          online ? "bg-emerald-500 sidebar-pulse" : "bg-amber-500"
        }`}
      />
      Закрытый контур · {online ? "связь есть" : "связи нет"}
    </p>
  );
}

export function Sidebar() {
  const { user, hasPermission } = useAuth();
  const userRole = user ? ROLES[user.role] : null;
  const pathname = normalizePath(usePathname() ?? "");

  // Счётчик у «Реестра ОМ». Берётся `count` СЕРВЕРА при `page_size=1`: строки
  // не нужны, нужно число, и тащить ради бейджа страницу мероприятий было бы
  // расточительством на каждом экране приложения. Отказ (нет права `event.view`
  // — сервер отвечает 403) гасит бейдж целиком: пустое место честнее нуля,
  // который читался бы как «мероприятий нет».
  const eventsCount = useSecurityEvents({
    search: "",
    stage: "ALL",
    page: 1,
    from: "",
    to: "",
    owner: "",
    pageSize: 1,
  });
  const counters: Record<NonNullable<NavItem["counter"]>, { value: number; hint: string } | null> = {
    events:
      eventsCount.data === undefined
        ? null
        : { value: eventsCount.data.count, hint: "Мероприятий в реестре" },
  };

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
  //
  // ПРАВА РАЗДЕЛА ждут ответа сервера, и пока он не пришёл, пункты раздела
  // показываются ВСЕ. Спрятать их на время загрузки значило бы устроить
  // мигание меню на каждом открытии приложения — и, что хуже, показать
  // человеку неполное меню как окончательное, если запрос прав не ответит
  // вовсе. Отказ страницы остаётся вторым рубежом: он никуда не делся.
  const { hasPermission: hasOpsPermission, isLoading: opsPermissionsLoading } =
    useOpsPermissions();

  const visibleCategories = CATEGORIES.map((category) => ({
    ...category,
    items: category.items.filter((item) => {
      if (user === null) return true;
      if (item.resource !== undefined) {
        return hasPermission(item.resource, item.action ?? "read");
      }
      const required = modulePermissionOf(item.href);
      if (required === null || opsPermissionsLoading) return true;
      return hasOpsPermission(required);
    }),
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
          SЖ
        </div>
        <div className="min-w-0">
          <div className="text-sidebar-foreground truncate text-base font-bold leading-5 tracking-[.06em]">
            Smart Жоспарлау
          </div>
          <div className="text-sidebar-foreground/55 truncate text-xs leading-4">
            Силы и мероприятия
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
                          counter={
                            item.counter === undefined
                              ? undefined
                              : counters[item.counter] ?? undefined
                          }
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

      {/* Подвал прототипа: состояние связи и карточка человека. */}
      <div className="border-sidebar-border shrink-0 border-t p-3 sidebar-role-card">
        <LinkStatus />
        {userRole && (
          <Link
            href="/security-ops/profile"
            className="bg-sidebar-accent/60 hover:bg-sidebar-accent mt-2.5 flex w-full items-center gap-2.5 rounded-[9px] p-2.5 text-left transition-colors"
            // Описание роли и отдел не помещаются в строку при 256px — уходят в
            // title, а не пропадают совсем.
            title={`${userRole.description}. Отдел: ${user?.department}`}
          >
            <span className="bg-primary/10 text-primary-ink grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold">
              {initialsOf(user?.name)}
            </span>
            <span className="min-w-0 flex-1">
              {/* Кегли по той же шкале, что и меню (12/14). Однострочный вариант
                  на 10/12px был частью погони за высотой — отменён вместе с ней. */}
              <span className="text-sidebar-foreground block truncate text-sm font-semibold leading-5">
                {user?.name ?? "—"}
              </span>
              <span className="text-sidebar-foreground/60 block truncate text-xs leading-4">
                {userRole.name}
              </span>
            </span>
          </Link>
        )}
      </div>
    </aside>
  );
}
