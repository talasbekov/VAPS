"use client";

/**
 * Баннер «Запрос на ОМ-…: выделено X из Y» на «Статусах сотрудников»
 * (Plane №394, `[СБС-30]`).
 *
 * Отдельной страницы у запроса нет — так в эталоне: начальник управления
 * приходит из уведомления («Выделите N сотрудников на ОМ-… (дата)»), и
 * экран, где он отмечает людей, обязан сказать, ЗАЧЕМ он здесь и сколько
 * ещё нужно. Без баннера уведомление привело бы на обычную таблицу, и
 * человек искал бы глазами, что от него хотят.
 *
 * Адрес запроса — `?forcesRequest=<allocationId>`: его кладёт ссылка
 * уведомления (`notifications-api.ts`).
 *
 * 🔴 БЕЗ ПАРАМЕТРА БАННЕР ТОЖЕ РАБОТАЕТ (Plane №487). Раньше здесь стояло
 * «нет параметра — нет баннера», и это оказалось дырой во всю цепочку:
 * статус «Участие в ОМ» вручную запрещён (№427, сервер отвечает 422 и шлёт
 * сюда), а сюда можно было попасть ТОЛЬКО по ссылке из уведомления. Человек,
 * открывший «Статусы сотрудников» из меню, не мог поставить статус ничем —
 * это и есть жалоба заказчика «с модуля не ставятся статус Участие на ОМ».
 * Уведомление к тому же доставляется не всегда (идемпотентность рассылки по
 * дню, получатели без фильтра прав — отдельные карточки), поэтому опираться
 * на него одно нельзя. Теперь баннер сам спрашивает «что просят у моего
 * управления».
 *
 * ЧТО ПОКАЗЫВАЕТ. Только СВОЮ строку управления: цифру раскладки
 * департамента и сколько уже проставлено «Участие в ОМ» (считает сервер по
 * статусам — `_with_directorate_progress`), плюс чекбоксы таблицы ниже →
 * «Участие в ОМ» (`[СБС-31]`, Plane №395).
 *
 * НЕСКОЛЬКО ЗАПРОСОВ — ВЫБОР ЧИПАМИ В ТОМ ЖЕ БАННЕРЕ, а не отдельный экран:
 * выделение всегда идёт в ОДИН запрос, и вопрос «в какой» — часть этого же
 * действия. Пока не выбран — активного нет и кнопки выделения нет: молча
 * подставить первый значило бы отправить людей не на то мероприятие. Когда
 * запрос ровно один, выбирать нечего, и он подставляется сам.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Megaphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useDirectorateForcesRequest,
  useDirectorateForcesRequests,
  useSelectForRequest,
} from "@/hooks/use-forces-request-banner";
import { employeeIdOfKey } from "@/features/employee-status-update/model/row-key";
import { formatIsoDate, formatIsoDateTime } from "@/shared/lib/date";

export function ForcesRequestBanner({
  selectedEmployees = [],
  onSelected,
}: {
  /** Кого начальник отметил чекбоксами в таблице ниже (Plane №395,
   *  `[СБС-31]`): выделение идёт ИЗ ЗАПРОСА — мероприятие и даты он не
   *  выбирает, статус ставит сервер. */
  selectedEmployees?: string[];
  /** После выделения — таблице пора перечитать статусы и снять отметки. */
  onSelected?: () => void;
}) {
  const searchParams = useSearchParams();
  const linkedId = searchParams.get("forcesRequest");
  // Список нужен, только когда человек пришёл БЕЗ ссылки: по ссылке предмет
  // разговора уже назван, и лишний запрос за соседними заявками ничего к
  // нему не добавит.
  const mine = useDirectorateForcesRequests({ enabled: linkedId === null });
  const rows = mine.data?.results ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  // Обоснование обхода мягкого конфликта (Plane №545) — ОДНО на повтор:
  // человек объясняет одно решение про отмеченную пачку, а не по строке.
  const [overrideReason, setOverrideReason] = useState("");
  // Порядок значим: ссылка из уведомления сильнее выбора и списка — человек
  // пришёл по конкретному адресу. Дальше — его собственный выбор. И только
  // когда запрос ровно один, он подставляется сам.
  // Выбор живёт, ПОКА ЗАПРОС В СПИСКЕ (Plane №755). Запрос, снятый штабом
  // после того, как человек его выбрал, отвечает 404 — и без этой проверки
  // выбор остался бы намертво указывать на мёртвую заявку: перечитывание
  // списка ничего бы не меняло, потому что `picked` сильнее его. Забытый
  // выбор — не потеря: список стал другим, и подставится либо единственный
  // оставшийся, либо ни один (тогда баннер спросит заново).
  const pickedAlive =
    picked !== null && rows.some((row) => row.allocationId === picked)
      ? picked
      : null;
  const allocationId =
    linkedId ?? pickedAlive ?? (rows.length === 1 ? rows[0].allocationId : null);
  const request = useDirectorateForcesRequest(allocationId);
  const select = useSelectForRequest(allocationId);
  // 🔴 ОТЧЁТ ПРИНАДЛЕЖИТ ЗАПРОСУ, А НЕ ЭКРАНУ (Plane №546). Состояние
  // мутации не ключится по `allocationId` и не сбрасывается при его смене, а
  // баннер печатал `select.data` безусловно. Человек выделял двоих по
  // запросу A, открывал уведомление запроса B — адрес менялся, страница НЕ
  // перемонтировалась, — и под свежей шапкой запроса B висело «Выделено: 2 ·
  // не выделены: …» от запроса A. Та же строка переживала и обновление
  // данных, выдавая себя за итог по новой таблице; `select.isError`
  // переживал смену так же.
  //
  // Сброс на СМЕНУ ЗАПРОСА, а не на каждый показ: отчёт об удавшемся
  // выделении обязан остаться на экране — это итог действия человека, и он
  // читает его после того, как таблица уже перечиталась.
  const { reset: resetReport } = select;
  useEffect(() => {
    resetReport();
    // Обоснование обхода принадлежит тому же отчёту (Plane №545): набранный
    // для запроса A текст под шапкой запроса B объяснял бы чужое решение.
    setOverrideReason("");
  }, [allocationId, resetReport]);
  // 🔴 СТРОКА ТАБЛИЦЫ СТАТУСОВ АДРЕСУЕТ СОТРУДНИКА СОСТАВНЫМ КЛЮЧОМ
  // `${staffUnitId}-${employeeId}` (см. `status-table.tsx`, `employeeIdOf`),
  // а вакансии — `${unitId}-vacant…`. Серверу нужен ГОЛЫЙ employeeId: первая
  // редакция слала ключ как есть, и сервер честно отвечал «5132-18 —
  // Сотрудник не вашего управления» (поймано живой пробой).
  //
  // РАЗБОР КЛЮЧА — ОБЩИЙ (Plane №547). Здесь стояла своя копия правила, и
  // она разошлась бы с оригиналом при первой же смене формата ключа: у
  // `employeeIdOfKey` тот же предмет и та же оговорка про вакансии.
  const employeeIds = selectedEmployees
    .map((key) => employeeIdOfKey(key))
    .filter((id): id is number => id !== null)
    .map(String);
  // 🔴 РАСХОЖДЕНИЕ СЧЁТЧИКОВ НАЗЫВАЕТСЯ ВСЛУХ (Plane №547). Таблица считает
  // ВЫБРАННЫЕ СТРОКИ («Выбрано: 10»), а выделить можно только сотрудников —
  // вакансия это пустая штатная единица, выделять по ней некого. Числа
  // расходились молча: «Выбрано: 10» и «Выделить на ОМ-…: 7», и разницу
  // человеку не объяснял никто. Прятать её, убрав вакансии из выбора, —
  // не наш выбор: строку выделяют галочкой в общей таблице, и запрещать
  // галочку ради одной кнопки значило бы чинить не там.
  const vacantSelected = selectedEmployees.length - employeeIds.length;
  // Кого можно взять повторно, с обоснованием (Plane №545). Считается по
  // признаку отказа, а не по его коду: список кодов на клиенте разошёлся бы
  // с сервером при первом же новом виде конфликта.
  const overridableRefused = (select.data?.refused ?? []).filter(
    (row) => row.overridable
  );

  // Пока список едет — НЕ рисуем скелет: на «Статусах сотрудников» запроса
  // чаще всего нет вовсе, и полоса-заглушка обещала бы содержимое, которого
  // не будет. По ссылке скелет ниже уместен: там содержимое обещано адресом.
  if (linkedId === null && (mine.isPending || rows.length === 0)) return null;

  // 🔴 ВЫБОР ЗАПРОСА (Plane №487). Показывается, только когда запросов
  // БОЛЬШЕ ОДНОГО: у одного выбирать нечего. Активный виден, а не угадывается
  // (правило «Active State»), и до выбора кнопки выделения нет вовсе.
  const chooser =
    linkedId === null && rows.length > 1 ? (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">
          Запрос, по которому отмечаете людей:
        </span>
        {rows.map((row) => {
          const active = row.allocationId === allocationId;
          const need = row.directorates.reduce((sum, item) => sum + item.need, 0);
          const assigned = row.directorates.reduce((sum, item) => sum + item.assigned, 0);
          return (
            <button
              key={row.allocationId}
              type="button"
              aria-pressed={active}
              onClick={() => setPicked(row.allocationId)}
              // ЗОНА НАЖАТИЯ 44 px (Plane №782, образец — №684). Было
              // `px-3 py-1`: около 24 px в высоту, вдвое меньше минимума.
              // Чип — это ВЫБОР МЕРОПРИЯТИЯ, на которое уедут люди, а
              // «Статусы сотрудников» открывают и с планшета: промах пальцем
              // по соседнему чипу отправляет выделение не на то ОМ. Высота
              // задана КОНТЕЙНЕРУ (`min-h-11` + `inline-flex items-center`),
              // шрифт остался `text-xs` — раздутый шрифт разнёс бы строку и
              // сделал чипы шире экрана.
              className={
                "inline-flex min-h-11 items-center rounded-full border px-4 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                (active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted")
              }
            >
              {row.code} · {assigned} из {need}
            </button>
          );
        })}
      </div>
    ) : null;

  if (allocationId === null) {
    // Запросов несколько, ни один не выбран: баннер называет задачу и ждёт
    // выбора — но НЕ подставляет первый сам.
    return (
      <section
        role="status"
        aria-label="Запросы на сбор сил"
        data-slot="forces-request-chooser"
        className="border-primary/40 bg-primary/5 space-y-2 rounded-lg border px-4 py-3"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Megaphone className="text-primary-ink h-4 w-4" aria-hidden="true" />
          <span className="font-semibold">
            Вашему управлению адресованы запросы на сбор сил: {rows.length}
          </span>
        </div>
        {chooser}
      </section>
    );
  }
  if (request.isPending) {
    return (
      <div className="bg-muted h-14 w-full animate-pulse rounded-lg" aria-hidden />
    );
  }
  if (request.isError || request.data === undefined) {
    // Заявка чужая или снята — сказать словами, а не молча спрятать баннер:
    // человек вправе узнать, почему на этом месте ничего нет.
    //
    // 🔴 ПЕРЕКЛЮЧАТЕЛЬ ОСТАЁТСЯ ЗДЕСЬ (Plane №755). Раньше эта ветка рисовала
    // одну строку текста, и вместе с баннером с экрана уезжали чипы: у
    // начальника с несколькими запросами отказ ОДНОГО уносил возможность
    // вернуться к остальным — выйти из тупика можно было только
    // перезагрузкой страницы. Отказ — не повод отбирать органы управления, из
    // которых человек в него попал; правило «ошибка называет следующий шаг»
    // требует ровно обратного.
    //
    // ТЕКСТ РАЗЛИЧАЕТ ДВА ПУТИ. Пришёл по ссылке из уведомления — «по ссылке»
    // (эту формулировку читает и проба `department-requests`); выбрал чип сам
    // — «выбранный запрос», потому что никакой ссылки он не открывал и фраза
    // про неё отправила бы его искать несуществующее письмо.
    return (
      <section
        aria-label="Запрос на сбор сил не найден"
        data-slot="forces-request-missing"
        className="space-y-2 rounded-lg border px-4 py-3"
      >
        <p role="alert" className="text-muted-foreground text-sm">
          {linkedId === null
            ? "Выбранный запрос на сбор сил не найден — возможно, его сняли, пока страница была открыта."
            : "Запрос на сбор сил по ссылке не найден — возможно, он снят или адресован другому управлению."}
        </p>
        {chooser}
        {/* Запрос был ровно один — чипов нет, и без этой кнопки ветка стала бы
            тем же тупиком, из которого её вынимали: список запросов
            перечитывается здесь же, без перезагрузки страницы. По ссылке
            перечитывать нечего — там список не запрашивался вовсе. */}
        {linkedId === null && rows.length <= 1 ? (
          <Button
            type="button"
            variant="outline"
            // 44 px, как и всё остальное в баннере (Plane №782): `size="sm"`
            // даёт h-8. Единственный орган управления этой ветки — промах по
            // нему читается как «баннер не отвечает».
            className="h-11"
            disabled={mine.isFetching}
            onClick={() => void mine.refetch()}
          >
            {mine.isFetching ? "Обновляю…" : "Обновить список запросов"}
          </Button>
        ) : null}
      </section>
    );
  }

  const data = request.data;
  return (
    <section
      role="status"
      aria-label={`Запрос на ${data.code}`}
      data-slot="forces-request-banner"
      className="border-primary/40 bg-primary/5 space-y-2 rounded-lg border px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Megaphone className="text-primary-ink h-4 w-4" aria-hidden="true" />
        <span className="font-semibold">
          Запрос на {data.code} ({formatIsoDate(data.businessDate)})
        </span>
        <span className="text-muted-foreground text-sm">
          {data.title} · от «{data.departmentName}»
          {data.dueAt ? ` · срок ${formatIsoDateTime(data.dueAt)}` : ""}
        </span>
      </div>
      {chooser}
      <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {data.directorates.map((row) => {
          const done = row.need > 0 && row.assigned >= row.need;
          return (
            <li key={row.divisionId} className="flex items-center gap-2">
              <span>{row.name}:</span>
              {/* `text-green-700` — тот же класс, что у `StatCard tone="success"`:
                  «своих» токенов вроде `text-success-ink` в системе нет, и
                  выдуманный класс молча отрисовался бы как ничто. */}
              <b className={`tabular-nums ${done ? "text-green-700" : ""}`}>
                выделено {row.assigned} из {row.need}
              </b>
              {!done && row.need > 0 && (
                <span className="text-muted-foreground">· ещё {row.need - row.assigned}</span>
              )}
            </li>
          );
        })}
      </ul>
      {/* ЧЕКБОКСЫ → «УЧАСТИЕ В ОМ» (`[СБС-31]`, Plane №395). Кнопка живёт в
          баннере, а не в диалоге статуса: человек не выбирает мероприятие и
          дат не вводит — всё это даёт запрос. Отказы приходят построчно и
          видны здесь же, а не в тосте, который уедет.

          ПОИМЁННО — ТОЛЬКО ПО СВОИМ (Plane №543). Отказ по чужому сотруднику
          несёт идентификатор вместо фамилии: подтверждать существование людей
          вне своей области значило бы отдать перебор по кадрам. На экране это
          незаметно — отметить чужого в таблице своего управления нельзя, — и
          заметно только тому, кто шлёт запрос руками. */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          // 44 px (Plane №782): главное действие баннера и самое дорогое —
          // оно ставит людям статус участия в мероприятии.
          //
          // 🔴 ВЫСОТА МИНИМАЛЬНАЯ, А ПОДПИСЬ ПЕРЕНОСИТСЯ. У кнопки shadcn в
          // основе `whitespace-nowrap`, а подпись пустого выбора длинная
          // («Отметьте сотрудников в таблице — и выделите на ОМ», 399 px).
          // На узком экране она вылезала за баннер и тянула ГОРИЗОНТАЛЬНУЮ
          // ПРОКРУТКУ всей страницы: замерено на 420 px — `scrollWidth` 432
          // при `clientWidth` 420, и это ДО правки (44 px добавляли к беде 8
          // px, а не создавали её). «Статусы» открывают с планшета, ради
          // этого вся карточка и правится, — чинится здесь же.
          className="h-auto min-h-11 max-w-full py-2 text-left whitespace-normal"
          disabled={employeeIds.length === 0 || select.isPending}
          onClick={() =>
            select.mutate({ employeeIds }, { onSuccess: () => onSelected?.() })
          }
        >
          {select.isPending
            ? "Выделяю…"
            : employeeIds.length === 0
              ? "Отметьте сотрудников в таблице — и выделите на ОМ"
              : `Выделить на ${data.code}: ${employeeIds.length}`}
        </Button>
        {vacantSelected > 0 && (
          <span className="text-muted-foreground text-xs">
            Выбрано строк: {selectedEmployees.length}, из них вакансий:{" "}
            {vacantSelected} — выделяются только сотрудники.
          </span>
        )}
        <span className="text-muted-foreground text-xs">
          Статус «Участие в ОМ» с датами мероприятия проставится сам; объект
          назначит штаб.{" "}
          <Link
            href={`/security-ops/events/${data.eventId}/`}
            className="text-primary-ink font-medium hover:underline"
          >
            Карточка мероприятия →
          </Link>
        </span>
      </div>
      {select.data !== undefined && (
        <p role="status" className="text-sm" data-slot="select-report">
          Выделено: <b className="tabular-nums">{select.data.selected.length}</b>
          {select.data.refused.length > 0 && (
            <>
              {" "}· не выделены:{" "}
              {select.data.refused.map((row) => `${row.name} — ${row.message}`).join("; ")}
            </>
          )}
        </p>
      )}
      {/* 🔴 МЯГКИЙ ОТКАЗ ПЕРЕСТАЛ БЫТЬ ТУПИКОМ (Plane №545). Сервер отвечает
          «статус пересекается» и помечает такой отказ обходимым — но обойти
          его было нечем: поля обоснования на экране не было, а второго пути у
          начальника управления нет (ручной статус «Участие в ОМ» запрещён
          решением заказчика, №427). Жёсткие отказы сюда не попадают: их
          сервер помечает `overridable: false`, и предлагать по ним кнопку
          значило бы обещать то, чего он не сделает. */}
      {overridableRefused.length > 0 && (
        <div className="flex flex-wrap items-end gap-2" data-slot="select-override">
          <div className="grid gap-1">
            {/* Подпись ВИДИМАЯ, а не плейсхолдер: плейсхолдер исчезает при
                первом же символе, и человек перестаёт видеть, что он пишет. */}
            <Label htmlFor="forces-override-reason" className="text-xs">
              Обоснование: почему берём, несмотря на занятость
            </Label>
            <Input
              id="forces-override-reason"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              // 44 px (Plane №782): поле и кнопка обхода стоят в одну
              // строку, и разная высота у соседей читается как сбитая
              // вёрстка — а зона нажатия у поля ввода нужна не меньше, чем
              // у кнопки.
              className="h-11 w-72 text-sm"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={overrideReason.trim() === "" || select.isPending}
            onClick={() =>
              select.mutate(
                {
                  employeeIds: overridableRefused.map((row) => row.employeeId),
                  override: true,
                  override_reason: overrideReason.trim(),
                },
                {
                  onSuccess: () => {
                    setOverrideReason("");
                    onSelected?.();
                  },
                }
              )
            }
          >
            {select.isPending
              ? "Выделяю…"
              : `Выделить с обоснованием: ${overridableRefused.length}`}
          </Button>
        </div>
      )}
      {select.isError && (
        <p role="alert" className="text-destructive-ink text-sm">
          {select.error?.message ?? "Выделить не удалось"}
        </p>
      )}
    </section>
  );
}
