"use client";

import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function MobileMenu({ isOpen, onClose, children }: MobileMenuProps) {
  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40 bg-black bg-opacity-25 lg:hidden"
        onClick={onClose}
      />

      {/* Mobile Sidebar */}
      {/* Фон именно сайдбара, а не карточки: внутрь кладётся <Sidebar>, чей
          текст набран text-sidebar-foreground — на bg-card в тёмной теме
          получалось светлое по светлому. */}
      {/* Панель — колонка: шапка h-16 плюс сайдбар h-screen внутри 100vh
          уводили дно списка за экран, и последние пункты были недостижимы.
          max-w-[85vw] — чтобы на 320 px панель не занимала весь экран. */}
      <div className="fixed inset-y-0 left-0 z-50 flex w-80 max-w-[85vw] flex-col bg-sidebar shadow-lg lg:hidden">
        <div className="flex h-16 shrink-0 items-center justify-between px-4 bg-blue-600">
          <span className="text-white font-bold text-lg">Проект Расход</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-white min-h-11 min-w-11"
            aria-label="Закрыть меню"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </>
  );
}









