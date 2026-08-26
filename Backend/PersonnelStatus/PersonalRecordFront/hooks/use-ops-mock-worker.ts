"use client";

// Старт host-MSW раздела ОМ. Вынесен из layout раздела, потому что мок нужен
// НЕ ТОЛЬКО там: экраны доступа живут на /settings/*, вне layout ОМ, и без
// своего старта мок-слоя они молча ходили в живой бэк. Проба мок-контракта на
// них при этом зеленела — она проверяла живой стек, думая, что проверяет мок,
// и завела на стенде настоящую учётную запись (Plane №106, шаг «П-10»).
import { useEffect, useState } from "react";
import { isOpsMockMode } from "@/lib/ops-env";

/** true — мок-слой поднят (или не нужен), рендерить экран можно. */
export function useOpsMockWorker(): boolean {
  // В живом режиме мок не нужен ВООБЩЕ — и ждать его нечего. Раньше здесь
  // всё равно шёл динамический импорт `mocks/ops/browser` (который сам бы
  // сразу вышел), но в dev это компиляция чанка с msw: экран стоял на
  // «Загрузка раздела…» секундами, и снимок раздела ловил меню на середине
  // анимации. Проверка среды — чтение env, синхронное и дешёвое.
  const [ready, setReady] = useState(() => !isOpsMockMode());

  useEffect(() => {
    if (!isOpsMockMode()) return;
    let cancelled = false;
    // Динамический импорт: msw и мок-код не попадают в чанк, пока экран,
    // которому мок нужен, не открыт.
    import("@/mocks/ops/browser")
      .then(({ startOpsMockWorker }) => startOpsMockWorker())
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return ready;
}
