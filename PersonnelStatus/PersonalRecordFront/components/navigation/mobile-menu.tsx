"use client";

// Мобильное меню.
//
// Было: оверлей — кликабельный `<div>` без роли, без `tabIndex` и без
// обработчика клавиш; панель — тоже `<div>` без роли диалога. Меню нельзя было
// закрыть с клавиатуры, Escape не работал, фокус уходил под оверлей на
// страницу, а после закрытия не возвращался на бургер.
//
// Стало: тот же вид на Radix-диалоге — роль, `aria-modal`, ловушка фокуса,
// Escape, возврат фокуса и блокировка прокрутки фона приходят из примитива.
// Свой `DialogContent` здесь потому, что базовый центрирует окно, а меню
// должно выезжать слева на всю высоту.
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function MobileMenu({ isOpen, onClose, children }: MobileMenuProps) {
  return (
    <DialogPrimitive.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 lg:hidden" />
        {/* Панель — колонка: шапка h-16 плюс сайдбар h-screen внутри 100vh
            уводили дно списка за экран, и последние пункты были недостижимы.
            max-w-[85vw] — чтобы на узком экране панель не занимала его весь.
            Фон именно сайдбара, а не карточки: внутрь кладётся <Sidebar>, чей
            текст набран text-sidebar-foreground. */}
        <DialogPrimitive.Content
          aria-label="Меню навигации"
          className="fixed inset-y-0 left-0 z-50 flex w-80 max-w-[85vw] flex-col bg-sidebar shadow-lg outline-none lg:hidden"
        >
          <DialogPrimitive.Title className="sr-only">
            Меню навигации
          </DialogPrimitive.Title>
          <div className="flex h-16 shrink-0 items-center justify-between bg-blue-600 px-4">
            <span className="text-lg font-bold text-white">Проект Расход</span>
            <DialogPrimitive.Close asChild>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 min-w-11 text-white"
                aria-label="Закрыть меню"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
