# VAPS Design System — конвенции

Дизайн-система кадрового учёта (PersonnelStatus). Язык интерфейса — русский. 23 компонента
shadcn/ui (стиль new-york) + доменные StatsCards, OrgNode, ThemeToggle. Иконки — lucide-react.

## Обёртка и настройка

Провайдер приложению НЕ нужен: токены — глобальные CSS-переменные из `styles.css`, светлая тема
по умолчанию. Тёмная тема: класс `dark` на корневом контейнере — все токены переключаются сами.
Шрифт — системный sans-стек (Inter НЕ подключать: система рендерится системным шрифтом).

Контекстные композиции обязательны (иначе компонент падает или невидим):
- `Toast` — только внутри `ToastProvider`, рядом `ToastViewport`.
- `Tooltip` — внутри `TooltipProvider`.
- `Select` — пункты `SelectItem` внутри `SelectContent`; выбранное значение показывает `SelectValue`.
- Составные части (`CardHeader`, `DialogContent`, `DropdownMenuItem`, `TableRow`, `TabsTrigger`…)
  используются только внутри своего корня.

## Стилевой идиом: Tailwind-утилиты + семантические токены

Никаких сырых hex-цветов. Цвет и фон — только через семейства токенов:

| Семейство | Классы |
|---|---|
| Поверхности | `bg-background` `bg-card` `bg-popover` `bg-muted` `bg-accent` |
| Текст | `text-foreground` `text-muted-foreground` `text-card-foreground` |
| Акценты | `bg-primary text-primary-foreground` · `bg-secondary text-secondary-foreground` · `bg-destructive` |
| Границы | `border` (цвет-токен по умолчанию) · `border-input` |
| Радиусы | `rounded-lg` `rounded-md` `rounded-sm` (от `--radius: 0.5rem`) |

Статусные бейджи персонала — пары `bg-<цвет>-100 text-<цвет>-800`; доступны green, yellow,
amber, red, purple, indigo, pink, orange, blue, cyan, teal, emerald, gray. «На месте» в системе —
зелёная пара; семантику остальных статусов задают данные.

Утилиты: `cn(...)` — склейка классов; `buttonVariants({variant, size})` и `badgeVariants({variant})` —
классы вариантов вне компонента (например, ссылка в виде кнопки).

ВАЖНО: CSS собран из реального приложения — редкая утилита может отсутствовать. Перед
использованием нестандартного класса сверься со `styles.css` (и его импортом `_ds_bundle.css`);
надёжнее держаться перечисленных семейств и обычного layout-набора (flex/grid, gap-*, p-*, m-*).

## Где правда

- `styles.css` → импортирует `_ds_bundle.css`: токены `:root`/`.dark` и все доступные утилиты.
- `components/<группа>/<Имя>/<Имя>.d.ts` — точный контракт пропсов (`<Имя>Props`).
- `components/<группа>/<Имя>/<Имя>.prompt.md` — рабочие примеры композиции.

## Идиоматичный пример

```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardAction,
         CardContent, CardFooter, Button, Badge } from "my-v0-project";

<Card className="w-full max-w-sm">
  <CardHeader>
    <CardTitle>Ахметов Данияр Серикович</CardTitle>
    <CardDescription>Главный специалист · Управление кадров</CardDescription>
    <CardAction>
      <Badge className="bg-green-100 text-green-800">На месте</Badge>
    </CardAction>
  </CardHeader>
  <CardContent>
    <p className="text-sm text-muted-foreground">Табельный номер 04-1287.</p>
  </CardContent>
  <CardFooter className="gap-2">
    <Button size="sm">Профиль</Button>
    <Button size="sm" variant="outline">Изменить статус</Button>
  </CardFooter>
</Card>
```
