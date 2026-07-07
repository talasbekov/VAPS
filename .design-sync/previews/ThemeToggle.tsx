import { ThemeToggle } from "my-v0-project";
import { ThemeProvider } from "next-themes";

// В приложении ThemeToggle живёт в шапке; здесь — строка с подписью,
// обёрнутая в ThemeProvider (useTheme требует контекст next-themes).
// defaultTheme="light" + enableSystem=false — детерминированный скриншот.
export const HeaderRow = () => (
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
    <div className="flex w-72 items-center justify-between rounded-md border bg-background px-3 py-2">
      <span className="text-sm text-muted-foreground">
        Переключатель темы
      </span>
      <ThemeToggle />
    </div>
  </ThemeProvider>
);
