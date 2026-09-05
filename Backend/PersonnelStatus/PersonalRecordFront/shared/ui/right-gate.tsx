"use client";

import {
  createContext,
  useContext,
  useId,
  useMemo,
  type ReactNode,
} from "react";

/**
 * Причина, по которой действие закрыто правом, — ДОСТИЖИМАЯ (Plane №801).
 *
 * 🔴 ЧТО БЫЛО НЕ ТАК И ПОЧЕМУ ЭТО ШАБЛОН, А НЕ ОПЕЧАТКА. По разделу
 * повторялась связка «`disabled` по праву + `title` с причиной» — двенадцать
 * мест в раскладке сил и расстановке. На ВЫКЛЮЧЕННОЙ кнопке браузер подавляет
 * указательные события, а вместе с ними и всплывающую подсказку: `title`
 * показывался бы ровно тогда, когда показаться не может. Человек без права
 * видел серую кнопку и ничего больше — ни почему, ни к кому идти. Тот же
 * разбор уже сделан точечно в №714 и №777; здесь он доведён до всех мест.
 *
 * РЕШЕНИЕ ТО ЖЕ, ЧТО В №714: причина становится ВИДИМОЙ строкой, а связь с
 * кнопкой держит `aria-describedby` — выключенная кнопка фокуса не получает,
 * но виртуальный курсор читалки до неё доходит, и причина звучит вместе с
 * именем кнопки, а не отдельным текстом неизвестно о чём.
 *
 * 🔴 ПОЧЕМУ ПОЯВИЛСЯ `AccessHints` (вторая половина №801, найдена ревью
 * коммита 94f37610). Первый заход рисовал причину У КАЖДОЙ обёртки. На
 * «Расстановке» две обёртки стоят ВНУТРИ цикла по назначенным людям — на
 * шести назначенных это двенадцать одинаковых строк, и ещё одна сверху, в
 * общей подписи шага. Экран превращался в частокол из одной и той же фразы,
 * причём ровно у того, кому и так нечего делать. Комментарий самого экрана
 * (`PlacementStage.tsx`, «Причина недоступности — СЛОВАМИ и ОДИН РАЗ НА ШАГ»)
 * требовал обратного, и правка его нарушила.
 *
 * Теперь текст говорится ОДИН РАЗ на шаг — блоком `AccessHints` в начале
 * карточки, — а каждая обёртка внутри лишь ссылается на него `aria-describedby`
 * по совпадению ТЕКСТА причины. Разные права дают разные строки, поэтому
 * человек с одним правом из двух видит ровно ту причину, которая его касается.
 * Обёртка вне `AccessHints` ведёт себя как прежде и рисует свою строку сама —
 * так продолжают жить одиночные кнопки, у которых блока причин нет.
 *
 * У кого право ЕСТЬ, не меняется ничего: `AccessHints` не рисует ни строки, а
 * обёртка отдаёт `undefined` вместо идентификатора.
 */

/** Текст причины → идентификатор строки, которая его уже произнесла. */
const AccessHintIds = createContext<ReadonlyMap<string, string> | null>(null);

export function AccessHints({
  reasons,
  children,
  className = "",
}: {
  /** Причины ВСЕХ прав шага. Пустые и повторы отбрасываются. */
  reasons: readonly (string | null | undefined)[];
  children: ReactNode;
  /** Класс блока причин. */
  className?: string;
}) {
  const base = useId();
  // Ключ по СОДЕРЖИМОМУ: список причин собирается литералом на каждый рендер,
  // и зависимость от самого массива пересобирала бы карту всегда.
  const key = reasons.map((raw) => (raw ?? "").trim()).join("\u0000");
  const ids = useMemo(() => {
    const map = new Map<string, string>();
    for (const text of key.split("\u0000")) {
      if (text === "" || map.has(text)) continue;
      map.set(text, `${base}r${map.size}`);
    }
    return map;
  }, [base, key]);

  return (
    <AccessHintIds.Provider value={ids}>
      {ids.size > 0 && (
        <div className={`space-y-0.5 ${className}`}>
          {[...ids].map(([text, id]) => (
            <p
              key={id}
              id={id}
              data-slot="access-note"
              className="text-[11px] text-muted-foreground"
            >
              {text}
            </p>
          ))}
        </div>
      )}
      {children}
    </AccessHintIds.Provider>
  );
}

export function RightGate({
  reason,
  children,
  className = "",
}: {
  /** Причина отказа; пусто/`undefined` — право есть, объяснять нечего. */
  reason?: string | null;
  /** Кнопка. Получает идентификатор подписи — или `undefined`, если права
   *  хватает. */
  children: (describedBy: string | undefined) => ReactNode;
  /** Класс обёртки: у разных мест разная раскладка (строка таблицы, панель). */
  className?: string;
}) {
  const shared = useContext(AccessHintIds);
  const ownId = useId();
  const text = (reason ?? "").trim();
  if (text === "") return <>{children(undefined)}</>;

  // Причина уже сказана блоком шага — ссылаемся, но НЕ повторяем.
  const sharedId = shared?.get(text);
  if (sharedId !== undefined) return <>{children(sharedId)}</>;

  return (
    <span className={`inline-flex flex-col items-start gap-0.5 ${className}`}>
      {children(ownId)}
      <span
        id={ownId}
        data-slot="right-hint"
        className="text-[11px] leading-tight text-muted-foreground"
      >
        {text}
      </span>
    </span>
  );
}
