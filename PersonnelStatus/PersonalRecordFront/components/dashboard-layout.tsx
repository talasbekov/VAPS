"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/navigation/sidebar";
import { Header } from "@/components/navigation/header";
import { MobileMenu } from "@/components/navigation/mobile-menu";
import { PerformanceProfiler } from "@/components/profiler";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
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
        {/* Desktop Sidebar - Fixed */}
        <div
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
          <main className="flex-1 px-4 sm:px-6 lg:px-8 py-4">{children}</main>
        </div>
      </div>
    </PerformanceProfiler>
  );
}
