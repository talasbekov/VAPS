"use client";

import { useState, useEffect, useRef } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/navigation/sidebar";
import { Header } from "@/components/navigation/header";
import { MobileMenu } from "@/components/navigation/mobile-menu";
import { PerformanceProfiler } from "@/components/profiler";
import { ApiGapNotice } from "@/components/api-gap-notice";
import { findApiGap } from "@/lib/api-gaps";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

/**
 * Ширина бокового меню (Plane №1263, поручение заказчика 12.09.2026: «меню
 * модулей сделай расширяемой по ширине, а то сейчас фиксировано»).
 *
 * По умолчанию — прежние 256 px (их пинит `e2e/prototype-skin.spec.ts`:
 * свежий профиль обязан выглядеть как прототип). Нижняя граница — 224 px:
 * уже этого пункт с бейджем «В разработке» не помещается и ломается на две
 * строки, что и было поводом поручения. Верхняя — 440 px: дальше меню
 * забирает у содержимого больше, чем даёт себе, а самые длинные названия
 * пунктов («Отчёты по Службе» с бейджем) укладываются в одну строку уже к
 * 320. Шаг клавиатуры 16 px — половина пункта за нажатие, не пиксель.
 */
export const SIDEBAR_WIDTH_DEFAULT = 256;
export const SIDEBAR_WIDTH_MIN = 224;
export const SIDEBAR_WIDTH_MAX = 440;
const SIDEBAR_WIDTH_STEP = 16;
const SIDEBAR_WIDTH_KEY = "sidebarWidth";

function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(value)));
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  // Врезка сделана здесь, а не в каждой странице: DashboardLayout — общий
  // корень контента для хостовых экранов, /security-ops/* и /ops. Один вызов
  // покрывает все экраны из реестра, включая ветки loading/error внутри
  // страниц, которые рендерят свой DashboardLayout повторно.
  const pathname = usePathname();
  const apiGap = findApiGap(pathname);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  // 🔴 Начальное состояние — РОВНО то же, что рисует сервер (развёрнутый
  // сайдбар). Читать `localStorage` в инициализаторе нельзя: сервер такого
  // хранилища не видит и всегда отдаёт `true`, а клиент у свернувшего меню
  // пользователя рисовал бы `false` — React ловил это как расхождение
  // гидратации на КАЖДОЙ странице («inert`/`lg:ml-64` против `lg:ml-0`) и
  // отказывался чинить поддерево. Сохранённое значение применяем после
  // монтирования, когда сервер уже не участвует.
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  // Ширина — по той же причине из дефолта, а не из хранилища: она уезжает в
  // inline-стиль корня (`--sidebar-w`), и расхождение сервер/клиент было бы
  // тем же расхождением гидратации, что и у `sidebarOpen`.
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_WIDTH_DEFAULT);
  const [resizing, setResizing] = useState(false);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("sidebarOpen");
      if (saved !== null) setDesktopSidebarOpen(saved === "true");
      const savedWidth = localStorage.getItem(SIDEBAR_WIDTH_KEY);
      if (savedWidth !== null) setSidebarWidth(clampSidebarWidth(Number(savedWidth)));
    } catch {
      // Приватный режим и заблокированное хранилище — не повод падать:
      // сайдбар просто останется развёрнутым и в ширину по умолчанию.
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    // До восстановления писать нечего: иначе первый проход затрёт сохранённое
    // значение дефолтом ещё до того, как мы его прочитали.
    if (!restored) return;
    try {
      localStorage.setItem("sidebarOpen", String(desktopSidebarOpen));
    } catch {
      // См. выше: без хранилища состояние живёт только в этой вкладке.
    }
  }, [desktopSidebarOpen, restored]);

  useEffect(() => {
    // Ширина пишется ПОСЛЕ отпускания края, а не на каждом движении мыши:
    // во время перетаскивания значение меняется десятки раз в секунду, и
    // столько же раз дёргать хранилище незачем.
    if (!restored || resizing) return;
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    } catch {
      // См. выше.
    }
  }, [sidebarWidth, restored, resizing]);

  // Перетаскивание края: указатель захватывается рукояткой
  // (`setPointerCapture`), поэтому движение и отпускание приходят к ней и
  // тогда, когда курсор ушёл далеко в содержимое или за окно. Ширина
  // считается ОТ ТОЧКИ ЗАХВАТА (`startWidth + смещение`), а не как
  // абсолютный `clientX`: рукоятка шире линии границы на несколько
  // пикселей, и «ширина = clientX» дёргала меню на первом же движении —
  // на столько, на сколько человек промахнулся мимо самой линии.
  const dragStart = useRef<{ x: number; width: number } | null>(null);
  const onHandlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { x: e.clientX, width: sidebarWidth };
    setResizing(true);
  };
  const onHandlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!resizing || start === null) return;
    setSidebarWidth(clampSidebarWidth(start.width + (e.clientX - start.x)));
  };
  const onHandlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!resizing) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragStart.current = null;
    setResizing(false);
  };
  // Клавиатура — обязательная альтернатива перетаскиванию (WCAG 2.2
  // «Dragging Movements»): стрелки меняют ширину шагом, Home/End ставят
  // границы, а двойной клик и Backspace возвращают ширину по умолчанию.
  const onHandleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = {
      ArrowRight: sidebarWidth + SIDEBAR_WIDTH_STEP,
      ArrowLeft: sidebarWidth - SIDEBAR_WIDTH_STEP,
      Home: SIDEBAR_WIDTH_MIN,
      End: SIDEBAR_WIDTH_MAX,
      Backspace: SIDEBAR_WIDTH_DEFAULT,
    };
    const next = steps[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setSidebarWidth(clampSidebarWidth(next));
  };

  return (
    <PerformanceProfiler id="DashboardLayout">
      {/* Без bg-*: полотно даёт body (--canvas), карточки всплывают над ним.
          `--sidebar-w` — единственный источник ширины меню: её читают и
          обёртка сайдбара, и отступ содержимого, поэтому разойтись они не
          могут. Во время перетаскивания выделение текста снимается со всей
          страницы: иначе движение мыши по содержимому красит его синим. */}
      <div
        className={`flex min-h-screen ${resizing ? "cursor-col-resize select-none" : ""}`}
        style={{ "--sidebar-w": `${sidebarWidth}px` } as CSSProperties}
      >
        {/* Проброс к содержимому: до первой кнопки контента на «Управлении
            персоналом» было 26 нажатий Tab — весь сайдбар целиком. Ссылка
            невидима, пока не получит фокус. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
        >
          Перейти к содержимому
        </a>

        {/* Desktop Sidebar - Fixed */}
        <div
          // Уехавший за левый край сайдбар оставался в порядке табуляции: ~25
          // ссылок ловили фокус за экраном. inert убирает и фокус, и чтение
          // скринридером, но оставляет анимацию скрытия.
          inert={desktopSidebarOpen ? undefined : true}
          // Анимация включается только ПОСЛЕ восстановления: иначе свёрнутый
          // сайдбар на каждой загрузке заново уезжал бы за край на глазах у
          // пользователя. Ручное переключение анимируется как прежде.
          className={`hidden lg:block fixed left-0 top-0 h-screen z-30 ${
            restored ? "transition-transform duration-300 ease-in-out" : ""
          } ${desktopSidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
        >
          <div className="h-full w-[var(--sidebar-w)]">
            <Sidebar />
          </div>
          {/* РУКОЯТКА ШИРИНЫ (Plane №1263): полоска по правому краю панели,
              вылезающая на 4 px в содержимое, чтобы её можно было схватить
              и чуть правее границы. Это `separator`, а не `button`:
              `e2e/prototype-skin.spec.ts` стережёт, что в меню нет ни одной
              кнопки с `aria-expanded`, а для скринридера разделитель с
              `aria-valuenow` и есть «регулируемая граница». Стоит ВНЕ
              `<aside>`: обход `smoke-buttons` нажимает всё внутри него. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Ширина бокового меню"
            aria-valuemin={SIDEBAR_WIDTH_MIN}
            aria-valuemax={SIDEBAR_WIDTH_MAX}
            aria-valuenow={sidebarWidth}
            tabIndex={desktopSidebarOpen ? 0 : -1}
            title="Потяните, чтобы изменить ширину меню. Двойной клик — ширина по умолчанию"
            data-slot="sidebar-resize-handle"
            data-resizing={resizing ? "true" : undefined}
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerUp}
            onDoubleClick={() => setSidebarWidth(SIDEBAR_WIDTH_DEFAULT)}
            onKeyDown={onHandleKeyDown}
            className={`group absolute -right-1 top-0 z-40 h-full w-2.5 cursor-col-resize touch-none outline-none ${
              resizing ? "" : "transition-colors"
            }`}
          >
            {/* Видимая часть — тонкая линия по границе: тихая, пока над ней
                нет курсора, заметная при наведении, фокусе и перетаскивании. */}
            <span
              aria-hidden="true"
              className={`absolute left-1 top-0 h-full w-0.5 ${
                resizing
                  ? "bg-primary"
                  : "bg-transparent group-hover:bg-primary/50 group-focus-visible:bg-primary"
              }`}
            />
          </div>
        </div>

        {/* Mobile Menu */}
        <MobileMenu isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)}>
          <Sidebar />
        </MobileMenu>

        {/* Main Content */}
        <div
          className={`flex flex-col flex-1 min-w-0 ${
            desktopSidebarOpen ? "lg:ml-[var(--sidebar-w)]" : "lg:ml-0"
          } ${restored && !resizing ? "transition-all duration-300" : ""}`}
        >
          <Header
            onMenuClick={() => setSidebarOpen(true)}
            onDesktopMenuClick={() =>
              setDesktopSidebarOpen(!desktopSidebarOpen)
            }
            desktopSidebarOpen={desktopSidebarOpen}
          />

          {/* Page content */}
          <main
            id="main-content"
            // tabIndex={-1}: без него переход по «якорю» в части браузеров
            // сдвигает только прокрутку, а фокус остаётся на skip-link.
            tabIndex={-1}
            className="flex-1 px-4 sm:px-6 lg:px-8 py-4"
          >
            {apiGap && <ApiGapNotice gap={apiGap} />}
            {children}
          </main>
        </div>
      </div>
    </PerformanceProfiler>
  );
}
