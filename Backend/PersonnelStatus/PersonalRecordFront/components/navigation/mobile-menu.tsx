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
      <div className="fixed inset-y-0 left-0 z-50 w-80 bg-white shadow-lg transform lg:hidden">
        <div className="flex items-center justify-between h-16 px-4 bg-blue-600">
          <span className="text-white font-bold text-lg">Проект Расход</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-white"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
        {children}
      </div>
    </>
  );
}









