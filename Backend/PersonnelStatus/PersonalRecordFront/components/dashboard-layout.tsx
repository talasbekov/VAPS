"use client";

import { useState, useEffect } from "react";
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
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("sidebarOpen");
      if (saved !== null) setDesktopSidebarOpen(saved === "true");
    } catch {
      // Приватный режим и заблокированное хранилище — не повод падать:
      // сайдбар просто останется развёрнутым.
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

  return (
    <PerformanceProfiler id="DashboardLayout">
      {/* Без bg-*: полотно даёт body (--canvas), карточки всплывают над ним. */}
      <div className="flex min-h-screen">
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
          <div className="w-64 h-full">
            <Sidebar />
          </div>
        </div>

        {/* Mobile Menu */}
        <MobileMenu isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)}>
          <Sidebar />
        </MobileMenu>

        {/* Main Content */}
        <div
          className={`flex flex-col flex-1 min-w-0 ${
            desktopSidebarOpen ? "lg:ml-64" : "lg:ml-0"
          } ${restored ? "transition-all duration-300" : ""}`}
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
