"use client";

/**
 * Разрез этапа ПО ОБЪЕКТУ ПОСЕЩЕНИЯ — одна реализация на все этапы.
 *
 * Спецификация `[МД-04]`: «у объекта свои этапы 1–5». Пост расчёта принадлежит
 * объекту с Plane №408, выбор объекта появился на рекогносцировке (№409), и
 * расстановке (№410) нужен ТОТ ЖЕ разрез. Вторая копия правила «что показано»
 * разошлась бы с первой при первой же правке: на одном экране объект уже
 * выбран, на другом ещё нет — и человек читал бы два разных ответа про одно
 * мероприятие.
 *
 * Почему переключатель, а не колонка таблицы, — [[Frontend/Decisions]]
 * (03.09.2026, Plane №409): в расчёте уже двенадцать колонок, и аудит
 * `[РЕК-09]` жалуется именно на ширину.
 */
import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReconSectorPost, SecurityEvent } from "@/entities/security-event";

/** Псевдо-объект «строки без владельца». Не `null`: значение переключателя
 *  обязано быть строкой, а «не отнесены» — такой же выбор, как объект. */
export const UNASSIGNED_VISIT = "__unassigned__";

export interface VisitObjectScope {
  /** Что показано: идентификатор объекта посещения или `UNASSIGNED_VISIT`. */
  shown: string;
  setShown: (value: string) => void;
  /** Объект посещения, если показан он; `null` — показаны ничейные строки. */
  visit: SecurityEvent["visitObjects"][number] | null;
  /** Строки расчёта показанного объекта. Остальные не забыты — они просто не
   *  на экране, и сохраняются вместе со всеми. */
  rows: ReconSectorPost[];
  /** Сколько строк расчёта не отнесены ни к какому объекту. */
  unassignedCount: number;
  /** Есть ли из чего выбирать: у ОМ с одним объектом и без ничейных строк
   *  переключатель не показывается — управление с единственным значением
   *  сообщает только о том, что оно есть. */
  hasChoice: boolean;
}

/**
 * 🔴 ПОКАЗАННЫЙ ОБЪЕКТ ЖИВЁТ В АДРЕСЕ (`?visit=`), а не в состоянии вкладки
 * (Plane №388, `[РЕЕ-06]`).
 *
 * До этого шага понятий «текущий объект» у карточки было ДВА: шапка читала
 * `?visit=` (по нему приходят кликом из раскрытой строки реестра), а этап
 * держал свой `useState` и всегда стартовал с первого объекта. Человек,
 * пришедший по ссылке на второй объект, видел его подсвеченным в шапке и
 * посты ПЕРВОГО в дереве — то есть экран отвечал сам себе противоположное.
 *
 * Адрес выбран источником правды, а не поднятое наверх состояние: «этапы вот
 * этого объекта» — то, что пересылают ссылкой на разборе, и то, что обязано
 * переживать перезагрузку страницы. Заодно шапка и этап синхронны без
 * прокладывания пропсов через каждый этап: оба читают одно место.
 */
export function useVisitObjectScope(
  event: SecurityEvent,
  rows: ReconSectorPost[]
): VisitObjectScope {
  const router = useRouter();
  const searchParams = useSearchParams();
  const wanted =
    searchParams.get("visit") ?? event.visitObjects[0]?.id ?? UNASSIGNED_VISIT;
  // `replace`, а не `push`: смена показанного объекта — это не шаг навигации,
  // и «назад» после трёх переключений обязано вернуть в реестр, а не пройти
  // их в обратном порядке.
  const setWanted = useCallback(
    (value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("visit", value);
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );
  const unassignedCount = rows.filter(
    (row) => (row.visitObjectId ?? null) === null
  ).length;
  // Объект мог быть снят с мероприятия в соседней вкладке — тогда показанный
  // выбор указывает в пустоту, и честнее вернуться к первому существующему.
  const alive =
    wanted === UNASSIGNED_VISIT ||
    event.visitObjects.some((visit) => visit.id === wanted);
  const shown = alive ? wanted : (event.visitObjects[0]?.id ?? UNASSIGNED_VISIT);
  const visit = event.visitObjects.find((item) => item.id === shown) ?? null;
  // 🔴 У ЕДИНСТВЕННОГО ОБЪЕКТА НЕРАЗМЕЧЕННЫЕ СТРОКИ — ЕГО. Ровно так считает
  // сервер (`_visit_placement`: при одном объекте неразмеченные посты входят в
  // его потребность), и экран обязан отвечать так же. Иначе пост, заведённый
  // старым клиентом или ручкой API, исчезал бы с расстановки при живом числе
  // в сводке — поймано пробой снятия поста (Plane №410).
  const single = event.visitObjects.length === 1;
  const visible = useMemo(
    () =>
      rows.filter((row) => {
        const owner = row.visitObjectId ?? null;
        if (single) return true;
        return shown === UNASSIGNED_VISIT ? owner === null : owner === shown;
      }),
    [rows, shown, single]
  );
  return {
    shown,
    setShown: setWanted,
    visit,
    rows: visible,
    // При единственном объекте «ничейных» строк нет по определению выше — и
    // предлагать их отдельным пунктом значило бы противоречить самому себе.
    unassignedCount: single ? 0 : unassignedCount,
    hasChoice: event.visitObjects.length > 1,
  };
}

/** Переключатель объекта. `children` — то, что этап дописывает рядом (у
 *  рекогносцировки это перенос ничейных строк). */
export function VisitObjectPicker({
  event,
  scope,
  allRows,
  id = "visit-object-scope",
  children,
}: {
  event: SecurityEvent;
  scope: VisitObjectScope;
  /** ВСЕ строки расчёта — счётчик у каждого объекта считается по ним. */
  allRows: ReconSectorPost[];
  id?: string;
  children?: React.ReactNode;
}) {
  if (!scope.hasChoice) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
      <label className="text-xs font-semibold" htmlFor={id}>
        Объект посещения
      </label>
      <select
        id={id}
        className="h-8 rounded-md border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={scope.shown}
        onChange={(e) => scope.setShown(e.target.value)}
      >
        {event.visitObjects.map((visit) => (
          <option key={visit.id} value={visit.id}>
            {visit.objectName} · постов{" "}
            {allRows.filter((row) => row.visitObjectId === visit.id).length}
          </option>
        ))}
        {scope.unassignedCount > 0 && (
          <option value={UNASSIGNED_VISIT}>
            Не отнесены к объекту · постов {scope.unassignedCount}
          </option>
        )}
      </select>
      {children}
    </div>
  );
}
