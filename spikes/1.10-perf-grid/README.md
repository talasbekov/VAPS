# Спайк 1.10 — перф-грид на целевой машине

Одноразовый прототип для замера перф-бюджета Epic 9 на целевом железе **4ГБ RAM / Firefox ~100**.
**Это НЕ канон `frontend/` (E8) и НЕ полная реализация грида E9** — только измерительный инструмент.

```bash
npm install        # на dev-машине (online)
npm run build      # → dist/ (статика, target: firefox100)
npm run preview    # локальный просмотр (или: cd dist && python3 -m http.server 8080)
npm run typecheck  # tsc --noEmit
```

**Замер:** перенести `dist/` на целевую машину, открыть в Firefox ~100, ввести 100 символов
слепым вводом (Enter↓ / Tab→ / Esc, без мыши), списать числа с HUD-оверлея + память вкладки
из Firefox `about:processes`. Подробности и таблица бюджета — в [`BUDGET.md`](./BUDGET.md).

Стек: React 19.2 + Vite 7 + `@tanstack/react-virtual`. Никаких Mantine/Query/RHF/роутера (это E8).
