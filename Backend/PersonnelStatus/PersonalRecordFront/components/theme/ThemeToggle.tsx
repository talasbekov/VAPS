"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Избегаем гидратации mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-9 w-9"
        aria-label="Переключение темы"
        disabled
      >
        <Sun className="h-5 w-5" aria-hidden="true" />
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-9 w-9"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      // title всплывает по наведению и мимо клавиатуры — доступное имя даёт
      // aria-label, он же остаётся при выключенных подсказках.
      aria-label={
        theme === "dark"
          ? "Переключить на светлую тему"
          : "Переключить на тёмную тему"
      }
      title={
        theme === "dark"
          ? "Переключить на светлую тему"
          : "Переключить на тёмную тему"
      }
    >
      {theme === "dark" ? (
        <Sun className="h-5 w-5" aria-hidden="true" />
      ) : (
        <Moon className="h-5 w-5" aria-hidden="true" />
      )}
    </Button>
  );
}
