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

# VapsUI (my-v0-project@0.1.0)

This design system is the published my-v0-project React library, bundled as a single
browser global. All 23 components are the real upstream code.

## Where things are

- `_ds_bundle.js` — the whole-DS bundle at the project root; loads every component to `window.VapsUI`. First line is a `/* @ds-bundle: … */` metadata header.
- `styles.css` — the single stylesheet entry: it `@import`s the tokens, fonts, and component styles (`_ds_bundle.css`). Link this one file.
- `components/<group>/<Name>/<Name>.prompt.md` (example JSX + variants), `<Name>.d.ts` (types), `<Name>.html` (variant grid).
- `tokens/*.css` — CSS custom properties, names verbatim from upstream.
- `fonts/` — `@font-face` files + `fonts.css` (when the package ships fonts).

For a specific component, `read_file("components/<group>/<Name>/<Name>.prompt.md")`.

## Loading

Add these two lines to your page once (React must be on the page first):

```html
<link rel="stylesheet" href="styles.css">
<script src="_ds_bundle.js"></script>
```

Components are then available at `window.VapsUI.*`. Mount into a dedicated child node (e.g. `<div id="ds-root">`), not the host page's own React root, so the two trees don't collide:

```jsx
const { Alert } = window.VapsUI;
ReactDOM.createRoot(document.getElementById('ds-root')).render(<Alert />);
```

## Tokens

106 CSS custom properties from my-v0-project. Names are
preserved verbatim from upstream. They are declared inside `_ds_bundle.css` (this DS ships one compiled stylesheet rather than separate token files).

- **color** (9): `--tw-border-spacing-x`, `--tw-border-spacing-y`, `--tw-ring-offset-color`, …
- **spacing** (3): `--tw-ring-inset`, `--tw-space-x-reverse`, `--tw-space-y-reverse`
- **radius** (1): `--radius`
- **shadow** (4): `--tw-ring-offset-shadow`, `--tw-ring-shadow`, `--tw-shadow`, …
- **other** (89): `--tw-translate-x`, `--tw-translate-y`, `--tw-rotate`, …

## Components

### general
- `Alert`
- `Avatar`
- `Badge`
- `Button`
- `Calendar`
- `Card`
- `Checkbox`
- `Dialog`
- `DropdownMenu`
- `Input`
- `Label`
- `Popover`
- `Progress`
- `Select`
- `Separator`
- `Table`
- `Tabs`
- `Textarea`
- `Toast`
- `Tooltip`

### organization-structure
- `OrgNode`

### dashboard
- `StatsCards`

### theme
- `ThemeToggle`
