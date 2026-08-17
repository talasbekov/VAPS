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
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("sidebarOpen");
      return saved !== null ? saved === "true" : true;
    }
    return true;
  });

  useEffect(() => {
    localStorage.setItem("sidebarOpen", String(desktopSidebarOpen));
  }, [desktopSidebarOpen]);

  return (
    <PerformanceProfiler id="DashboardLayout">
      <div className="flex min-h-screen bg-background">
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
          className={`hidden lg:block fixed left-0 top-0 h-screen z-30 transition-transform duration-300 ease-in-out ${
            desktopSidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="w-80 h-full">
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
            desktopSidebarOpen ? "lg:ml-80" : "lg:ml-0"
          } transition-all duration-300`}
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
