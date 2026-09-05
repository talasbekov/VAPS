"use client";

import { ChevronDown, ChevronRight, Pencil, X } from "lucide-react";
import { AssignChiefDialog } from "@/features/event-visit-objects/ui/AssignChiefDialog";

// Этап «Рекогносцировка»: чек-лист объекта и event-specific расчёт постов.
// Импорт из привязанной версии паспорта ДОБАВЛЯЕТ строки (ручные не
// затираются), повторный импорт дубли не плодит. «Требует изменений» в
// чек-листе обязывает к комментарию.
//
// Экран приведён к эталону прототипа (задача заказчика Plane №64): заголовок
// «Рекогносцировка объекта» с подписью, чек-лист рекогносцировки с обязательными
// пунктами, расчёт постов ИЕРАРХИЕЙ «сектор → пост → подпост» со сворачиванием
// секторов, подпись «Расчёт для текущего ОМ · …», кнопки «+ Добавить сектор» и
// «Сохранить расчёт», переход «Завершить этап и перейти далее».
//
// Чего из прототипа НЕТ и почему:
//
// * «Запрос личного состава» и поле «Требуемое число сотрудников» — заказчик
//   снял их с этого этапа явно («запрос сил не нужно делать на этом этапе»).
//   Штаб получает РАСЧЁТ ПО ПОСТАМ, который сервер считает сам на завершении
//   этапа, — см. `complete_recon`;
// * фотографии к пунктам чек-листа и «Материалы рекогносцировки» — файлового
//   хранилища у системы нет, приложить файл некуда. Названо строкой на экране,
//   а не нарисовано пустой кнопкой;
// * «Задача поста» в эталоне — выбор из кодов приказов; у нас это текст из
//   паспорта объекта, справочника нарядов в данных нет.
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  useCompleteRecon,
  useImportReconPosts,
  useUpdateRecon,
} from "@/hooks/use-security-event-stages";
import { useSecurityObject } from "@/hooks/use-security-objects";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { EVENT_MANAGE, useChainAccess } from "@/features/forces-split/ui/chain-access";
import type {
  ReconCheckState,
  ReconChecklistItem,
  ReconSectorPost,
  SecurityEvent,
} from "@/entities/security-event";
import {
  useVisitObjectScope,
  UNASSIGNED_VISIT,
  VisitObjectPicker,
} from "./useVisitObjectScope";
import { Fact } from "./Fact";
import { FieldErrors, StageError } from "./StageErrors";
import { formatIsoDate } from "@/shared/lib/date";

/** Тип поста из эталона. Список закрытый, но чужое значение не выбрасывается:
 * строки паспорта могли прийти с типом вне списка, и молча заменить его на
 * «—» значило бы стереть данные объекта. */
const POST_TYPES = ["Группа досмотра", "Группа БВС", "Физнаряд"] as const;

// Пометка ещё не сохранённой строки. Была счётчиком, обнулявшимся на каждой
// загрузке страницы, — и так как сервер писал присланный id как есть, у одного
// ОМ накапливались посты с одинаковым `recon-local-1` (Plane №30). Теперь id
// строке выдаёт СЕРВЕР, а это имя живёт только до сохранения: оно должно быть
// уникальным в пределах вкладки, потому что служит ключом React.
function nextLocalId(): string {
  const unique =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return `recon-local-${unique}`;
}

/** Сектор расчёта: имя и его строки в порядке таблицы. */
interface SectorGroup {
  name: string;
  rows: ReconSectorPost[];
}

export function ReconStage({ event }: { event: SecurityEvent }) {
  const [checklist, setChecklist] = useState<ReconChecklistItem[]>(
    event.reconChecklist
  );
  const [rows, setRows] = useState<ReconSectorPost[]>(event.reconSectorPosts);
  // Секторы, у которых ещё нет ни одного поста. Живут ОТДЕЛЬНО от строк:
  // сектор — заголовок группы, а не запись расчёта, и сервер про пустой сектор
  // не знает. Заведённый и не наполненный сектор исчезнет при перезагрузке —
  // это честно: сохранять нечего.
  const [emptySectors, setEmptySectors] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [chiefDialogOpen, setChiefDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, unknown> | null>(
    null
  );

  // Ответ сохранения переносится в форму: id строкам выдаёт сервер, и без
  // переноса форма осталась бы с локальными именами — «Сохранить» считало бы
  // черновик изменённым навсегда, а «Завершить» осталось бы заблокированным.
  const update = useUpdateRecon(event.id, {
    onFormError: (details) => setFieldErrors(details),
    onEvent: (fresh) => {
      setChecklist(fresh.reconChecklist);
      setRows(fresh.reconSectorPosts);
      // Сектор, в котором появились посты, больше не пустой — иначе он остался
      // бы вторым заголовком с тем же именем.
      setEmptySectors((prev) =>
        prev.filter(
          (name) => !fresh.reconSectorPosts.some((row) => row.sector === name)
        )
      );
    },
  });
  // Импорт добавляет строки на СЕРВЕРЕ, поэтому его ответ переносится в форму
  // явно: карточка ОМ больше не пересобирается на каждом обновлении данных, и
  // без этого импортированные посты не появились бы. Несохранённые ручные
  // строки при этом остаются — их сервер ещё не видел.
  const importPosts = useImportReconPosts(event.id, {
    onEvent: (fresh) =>
      setRows((prev) => [
        ...fresh.reconSectorPosts,
        ...prev.filter((row) => row.id.startsWith("recon-local-")),
      ]),
  });
  const complete = useCompleteRecon(event.id);
  const access = useChainAccess();

  /* ── Принадлежность расчёта объекту посещения (Plane №409) ──────────────
   *
   * Спецификация `[МД-04]`: у объекта СВОИ этапы, `[РЕК-07]`: подвал считает
   * «потребность ПО ОБЪЕКТУ». Пост принадлежит объекту с №408, но выбрать
   * этот объект было негде: импорт у ОМ с двумя объектами отвечал «выберите,
   * для какого», а выбора на экране не было.
   *
   * Разрез общий с расстановкой (`useVisitObjectScope`): два экрана обязаны
   * отвечать на «что показано» одинаково.
   */
  const scope = useVisitObjectScope(event, rows);
  const activeVisitObject = scope.visit;
  const visibleRows = scope.rows;

  /** Отнести строки к объекту: одну (перенос) или все нераспределённые. */
  function assignToVisit(visitObjectId: string, only?: string): void {
    setRows((prev) =>
      prev.map((row) =>
        (only === undefined ? (row.visitObjectId ?? null) === null : row.id === only)
          ? { ...row, visitObjectId }
          : row
      )
    );
  }

  const dirty =
    JSON.stringify({ checklist, rows }) !==
    JSON.stringify({
      checklist: event.reconChecklist,
      rows: event.reconSectorPosts,
    });

  /** Расчёт по постам — то самое число, которое завершение этапа отправит
   * штабу 2-го департамента. Считает его СЕРВЕР; здесь оно показывается,
   * чтобы старший наряда видел, что уходит. */
  const needFromPosts = rows.reduce((sum, row) => sum + (row.need || 0), 0);

  /** Паспорт, из которого пойдёт импорт: у объекта СВОЙ снимок версии
   *  (`[РЕК-05]` — «импорт из паспорта объекта посещения»).
   *
   *  Снимок мероприятия годится ТОЛЬКО когда объект посещения — тот же объект
   *  реестра, что у мероприятия: так выглядят строки, заведённые до появления
   *  собственных привязок. Для ЧУЖОГО объекта такая подстановка означала бы
   *  импорт постов одного объекта в расчёт другого — ТО ЖЕ ПРАВИЛО СТОИТ НА
   *  СЕРВЕРЕ, и разойтись с ним нельзя: кнопка была бы живой, а сервер
   *  отвечал бы отказом (поймано пробой). */
  const importPassport =
    activeVisitObject?.passportBinding ??
    (activeVisitObject !== null &&
    activeVisitObject.objectId !== null &&
    activeVisitObject.objectId === event.objectId
      ? event.passportBinding
      : null);

  /** Потребность ПОКАЗАННОГО объекта — то, что просит подвал `[РЕК-07]`.
   *  Общее число остаётся рядом: штабу уходит сумма по мероприятию. */
  const needOfVisit = visibleRows.reduce((sum, row) => sum + (row.need || 0), 0);

  /** Группы «сектор → строки» в порядке появления строк. Пустые секторы
   * дописываются в хвост. */
  const groups: SectorGroup[] = useMemo(() => {
    const order: string[] = [];
    const byName = new Map<string, ReconSectorPost[]>();
    for (const row of visibleRows) {
      let bucket = byName.get(row.sector);
      if (bucket === undefined) {
        bucket = [];
        byName.set(row.sector, bucket);
        order.push(row.sector);
      }
      bucket.push(row);
    }
    for (const name of emptySectors) {
      if (byName.has(name)) continue;
      byName.set(name, []);
      order.push(name);
    }
    return order.map((name) => ({ name, rows: byName.get(name) ?? [] }));
  }, [visibleRows, emptySectors]);

  function patchItem(id: string, patch: Partial<ReconChecklistItem>): void {
    setChecklist((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }

  /**
   * Смена состояния пункта — вместе с ВЫВОДИМЫМИ `done` и `result`
   * (Plane №707).
   *
   * 🔴 ЧТО БЫЛО НЕ ТАК. Кнопка меняла только `state`, и наверх уходило тело
   * `{state: 'UNCHECKED', done: true, result: 'MATCHES'}` — с прежними
   * значениями старых ключей. Серверное правило «явное UNCHECKED поверх
   * done — не верим» (`normalize_check_item`) переписывало состояние обратно
   * в NORMAL, ответ переносился в форму, счётчик откатывался, и ошибки не
   * было НИКАКОЙ: человек снимал отметку, а она возвращалась сама.
   *
   * ТОГО СЕРВЕРНОГО ПРАВИЛА БОЛЬШЕ НЕТ (Plane №538): явное состояние
   * побеждает всегда, а клиент без `state` по-прежнему читается по старым
   * ключам. Оговорка защищала не «старого клиента» — тот `state` не шлёт
   * вовсе, — а гипотетического, который шлёт оба набора и хочет, чтобы
   * победили старые; такого нет, зато под неё попадал ЭТОТ экран.
   *
   * Согласованная тройка отсюда никуда не делась и уходит по-прежнему: старые
   * ключи читают документы, сид и пробы, и слать рассогласованное тело значило
   * бы полагаться на то, что сервер их перевыведет. Вывод тот же, что у
   * сервера и у мока, и записан рядом, чтобы три копии одного правила
   * читались как одно.
   */
  function setCheckState(id: string, state: ReconCheckState): void {
    patchItem(id, {
      state,
      done: state !== "UNCHECKED",
      result:
        state === "NORMAL"
          ? "MATCHES"
          : state === "REMARK"
            ? "NEEDS_CHANGES"
            : null,
    });
  }

  function patchRow(id: string, patch: Partial<ReconSectorPost>): void {
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  }

  function blankRow(sector: string, patch: Partial<ReconSectorPost> = {}): ReconSectorPost {
    return {
      id: nextLocalId(),
      sector,
      post: "",
      task: "",
      need: 1,
      requirements: "",
      result: null,
      comment: "",
      sourceSectorId: null,
      sourcePostId: null,
      minRating: null,
      postType: "",
      weapon: "",
      uniform: "",
      parentPostId: "",
      // Новый пост заводится У ПОКАЗАННОГО объекта: человек видит расчёт
      // одного объекта и добавляет строку в него, а не «в мероприятие».
      visitObjectId: scope.shown === UNASSIGNED_VISIT ? null : scope.shown,
      ...patch,
    };
  }

  function addSector(): void {
    // Имя обязано быть уникальным: группы строятся ПО ИМЕНИ, и второй «Новый
    // сектор» слился бы с первым в одну группу.
    const taken = new Set(groups.map((group) => group.name));
    let index = taken.size + 1;
    let name = `Сектор ${index}`;
    while (taken.has(name)) name = `Сектор ${++index}`;
    setEmptySectors((prev) => [...prev, name]);
  }

  function renameSector(from: string, to: string): void {
    setRows((prev) =>
      prev.map((row) => (row.sector === from ? { ...row, sector: to } : row))
    );
    setEmptySectors((prev) => prev.map((name) => (name === from ? to : name)));
    setCollapsed((prev) => prev.map((name) => (name === from ? to : name)));
  }

  function removeSector(name: string): void {
    setRows((prev) => prev.filter((row) => row.sector !== name));
    setEmptySectors((prev) => prev.filter((item) => item !== name));
    setCollapsed((prev) => prev.filter((item) => item !== name));
  }

  /** Пост встаёт в КОНЕЦ СВОЕЙ группы, а не в конец таблицы: расчёт читают по
   * секторам, и строка, уехавшая в хвост, потеряла бы сектор из виду. */
  function addPost(sector: string): void {
    setRows((prev) => {
      const lastInSector = prev.reduce(
        (found, row, index) => (row.sector === sector ? index : found),
        -1
      );
      const row = blankRow(sector);
      if (lastInSector === -1) return [...prev, row];
      return [
        ...prev.slice(0, lastInSector + 1),
        row,
        ...prev.slice(lastInSector + 1),
      ];
    });
    setEmptySectors((prev) => prev.filter((name) => name !== sector));
  }

  /** Подпост из прототипа: строка, привязанная к посту-родителю. */
  function addSubPost(parent: ReconSectorPost): void {
    setRows((prev) => {
      const index = prev.findIndex((row) => row.id === parent.id);
      const sub = blankRow(parent.sector, {
        post: `${parent.post} / Подпост`,
        requirements: parent.requirements,
        minRating: parent.minRating,
        postType: parent.postType ?? "",
        weapon: parent.weapon ?? "",
        uniform: parent.uniform ?? "",
        parentPostId: parent.id,
      });
      // Подпост встаёт СРАЗУ за родителем: расчёт читают сверху вниз, и
      // строка в конце таблицы потеряла бы связь с постом.
      return [...prev.slice(0, index + 1), sub, ...prev.slice(index + 1)];
    });
  }

  function removeRow(row: ReconSectorPost): void {
    // Вместе с постом уходят его подпосты: осиротевший подпост ссылался бы на
    // несуществующий `parentPostId` и рисовался бы отдельной строкой без
    // родителя.
    setRows((prev) =>
      prev.filter((item) => item.id !== row.id && item.parentPostId !== row.id)
    );
  }

  function save(): void {
    setFieldErrors(null);
    update.mutate({ checklist, sectorPosts: rows });
  }

  /**
   * Объект БЕЗ СТАРШЕГО среди тех, что идут этапом «Рекогносцировка».
   *
   * 🔴 СТАРШЕГО СЧИТАЕМ ПО МЕРОПРИЯТИЮ, А НЕ ПО ПОКАЗАННОМУ ОБЪЕКТУ
   * (Plane №635). `complete_recon` требует старшего у КАЖДОГО объекта на этом
   * этапе, а кнопка смотрела только на активный: человек стоял на объекте со
   * старшим, кнопка была включена, сервер отвечал 422. И это не редкий
   * случай, а состояние двухобъектного ОМ ПО УМОЛЧАНИЮ: второй объект,
   * добавленный кнопкой «+», старшего не наследует.
   *
   * Тот же довод, что у пустого расчёта строкой ниже (№710): показанный
   * объект — то, что человек СЕЙЧАС правит, а не то, что проверяет сервер.
   * Первым берётся активный, если он и есть виноватый, — тогда причина
   * читается без имени, как раньше; иначе объект называется, иначе человек
   * не поймёт, куда идти.
   */
  const chieflessVisits = event.visitObjects.filter(
    (visit) => visit.stage === "RECON" && visit.chiefEmployeeId === null
  );
  const chiefless =
    chieflessVisits.find((visit) => visit.id === activeVisitObject?.id) ??
    chieflessVisits[0] ??
    null;

  // `[РЕК-07]`: почему «Завершить» недоступна — одна причина, первая по порядку.
  const completeBlocked: string | null = !access.can(EVENT_MANAGE)
    ? access.reason(EVENT_MANAGE) || "Нет права вести мероприятие."
    : dirty
      ? "Сохраните расчёт перед завершением этапа."
      : chiefless !== null
        ? chiefless.id === activeVisitObject?.id
          ? "Не назначен старший объекта."
          : `Не назначен старший объекта «${chiefless.objectName}».`
        : /* 🔴 ПУСТОТУ СЧИТАЕМ ПО МЕРОПРИЯТИЮ, А НЕ ПО ПОКАЗАННОМУ ОБЪЕКТУ
             (Plane №710). Сервер требует непустой расчёт ЦЕЛИКОМ, и человек,
             стоящий на объекте без постов, видел выключенную кнопку с
             неверной причиной — завершение прошло бы. Показанный объект —
             это то, что человек СЕЙЧАС правит, а не то, что проверяет
             сервер. */
          rows.length === 0
          ? "Нет постов расчёта."
          : checklist.some((item) => (item.required ?? true) && item.state === "UNCHECKED")
            ? "Обязательные пункты чек-листа остались в «Не проверено»."
            : null;

  // `[РЕК-02]` (Plane №424): без старшего объекта рекогносцировка закрыта —
  // сервер отвечает 422 `VISIT_CHIEF_REQUIRED` на импорт, сохранение и
  // завершение, а экран не рисует форму, которую нельзя отправить. Хуки
  // выше уже отработали, ранний return их порядок не ломает.
  if (activeVisitObject !== null && activeVisitObject.chiefEmployeeId === null) {
    return (
      <Card role="region" aria-label="Рекогносцировка объекта">
        <CardContent className="space-y-5">
          <ObjectFacts event={event} />
          <VisitObjectPicker event={event} scope={scope} allRows={rows} />
          <div
            className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center"
            data-slot="recon-chief-empty"
          >
            <p className="text-sm font-semibold">
              Назначьте старшего объекта, чтобы начать рекогносцировку
            </p>
            <p className="max-w-md text-xs text-muted-foreground">
              Чек-лист, посты и завершение этапа откроются старшему объекта
              «{activeVisitObject.objectName}».
            </p>
            {access.can(EVENT_MANAGE) ? (
              <Button type="button" size="sm" onClick={() => setChiefDialogOpen(true)}>
                + Назначить
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                {access.reason(EVENT_MANAGE)}
              </p>
            )}
          </div>
          <AssignChiefDialog
            event={event}
            visit={activeVisitObject}
            open={chiefDialogOpen}
            onClose={() => setChiefDialogOpen(false)}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    // Карточка этапа — ОБЛАСТЬ с именем: видимого заголовка внутри больше
    // нет (Plane №70), а имя у блока быть обязано — им пользуются и чтение с
    // экрана, и пробы, которым нужно указать на этап, а не на «первую
    // карточку страницы».
    <Card role="region" aria-label="Рекогносцировка объекта">
      {/* Имени этапа здесь НЕТ намеренно (Plane №70): оно стоит НАД
          карточкой, в шапке страницы («Этап N из 5 · …»). Второй заголовок
          читался бы как вложенный раздел, которого нет, и отнимал строку у
          содержимого. Подзаголовки внутри карточки остаются — они называют
          блоки, а не этап. */}
      <CardContent className="space-y-5">
        <ObjectFacts event={event} />

        <section data-slot="recon-checklist">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Чек-лист рекогносцировки</h3>
            {/* `[РЕК-04]` (Plane №443): «Проверено X из Y» — проверенным считается
                и «Норма», и «Замечание»; «Не проверено» не засчитывается. */}
            <span className="text-xs text-muted-foreground" data-slot="recon-checked-counter">
              Проверено: {checklist.filter((item) => item.state !== "UNCHECKED").length} из{" "}
              {checklist.length}
            </span>
          </div>
          <div className="space-y-2">
            {checklist.map((item) => {
              const needsComment = item.state === "REMARK" && item.comment.trim() === "";
              return (
                <div
                  key={item.id}
                  className="grid gap-2 rounded-md border px-3 py-2 md:grid-cols-[1fr_auto_1fr] md:items-center"
                  data-slot="recon-check-item"
                  data-state={item.state}
                >
                  <span className="text-sm">
                    {item.label}
                    {(item.required ?? true) && <span aria-hidden="true"> *</span>}
                  </span>
                  {/* Один переключатель вместо чекбокса и select: три кнопки,
                      выбранная — aria-pressed. */}
                  <div className="flex gap-1" role="group" aria-label={`Состояние: ${item.label}`}>
                    {(
                      [
                        ["NORMAL", "Норма"],
                        ["REMARK", "Замечание"],
                        ["UNCHECKED", "Не проверено"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={item.state === value}
                        className={
                          "h-8 rounded-md border px-2.5 text-xs transition-colors " +
                          (item.state === value
                            ? value === "REMARK"
                              ? "border-amber-600 bg-amber-100 font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
                              : value === "NORMAL"
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-foreground/40 bg-muted font-semibold"
                            : "bg-background hover:bg-muted")
                        }
                        onClick={() => setCheckState(item.id, value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="space-y-1">
                    <Input
                      className="h-8 text-xs"
                      placeholder={item.state === "REMARK" ? "Комментарий (обязателен)" : "Комментарий"}
                      aria-label={`Комментарий: ${item.label}`}
                      aria-invalid={needsComment || undefined}
                      value={item.comment}
                      onChange={(e) => patchItem(item.id, { comment: e.target.value })}
                    />
                    {needsComment && (
                      <p className="text-xs text-destructive">Укажите комментарий</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">Посты и секторы</h3>
              <p className="text-xs text-muted-foreground">
                {activeVisitObject === null
                  ? "Расчёт для текущего ОМ"
                  : `Расчёт объекта «${activeVisitObject.objectName}»`}{" "}
                · {dirty ? "есть несохранённые изменения" : "изменения сохранены"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  importPosts.isPending ||
                  activeVisitObject === null ||
                  importPassport === null
                }
                title={
                  activeVisitObject === null
                    ? "Выберите объект посещения — посты импортируются в него."
                    : importPassport === null
                      ? "У объекта нет привязанной версии паспорта."
                      : undefined
                }
                onClick={() =>
                  importPosts.mutate({ visitObjectId: scope.shown })
                }
              >
                {importPosts.isPending ? "Импорт…" : "Импорт из паспорта"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addSector}
              >
                + Добавить сектор
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!dirty || update.isPending}
                onClick={save}
              >
                {update.isPending ? "Сохранение…" : "Сохранить расчёт"}
              </Button>
            </div>
          </div>
          <VisitObjectPicker event={event} scope={scope} allRows={rows}>
            {scope.shown === UNASSIGNED_VISIT && event.visitObjects.length > 0 && (
              /* Строки, заведённые до Plane №408: объект в них не записан, и
                 приписать его мог только человек — сервер честно оставил их
                 без владельца, а не разделил поровну. */
              <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>Эти посты заведены до разметки. Отнести все к:</span>
                {event.visitObjects.map((visit) => (
                  <Button
                    key={visit.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7"
                    onClick={() => {
                      assignToVisit(visit.id);
                      scope.setShown(visit.id);
                    }}
                  >
                    {visit.objectName}
                  </Button>
                ))}
                <span>— затем «Сохранить расчёт».</span>
              </span>
            )}
          </VisitObjectPicker>
          {groups.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {scope.shown === UNASSIGNED_VISIT
                ? "Нераспределённых постов нет."
                : "Постов пока нет — добавьте сектор или импортируйте из паспорта."}
            </p>
          ) : (
            /* Компактная строка поста (`[РЕК-05]`, Plane №424): № · задача ·
               сотрудников · смена · требования · [+ Подпост] [✎] [✕]. Тип,
               вооружение, форма одежды, примечание и мин. рейтинг — в
               раскрытии ✎: десять колонок с горизонтальным скроллом
               спецификация запрещает (`[РЕК-09]`). */
            <div className="overflow-x-auto">
              <table className="w-full min-w-[840px] table-fixed border-collapse text-left">
                <thead>
                  <tr className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="w-8 pb-1">
                      <span className="sr-only">Свернуть сектор</span>
                    </th>
                    <th scope="col" className="w-[200px] pb-1">Сектор / Пост</th>
                    <th scope="col" className="pb-1 pl-2">Задача поста</th>
                    <th scope="col" className="w-[92px] pb-1 pl-2">Сотрудников</th>
                    <th scope="col" className="w-[116px] pb-1 pl-2">Смена</th>
                    <th scope="col" className="pb-1 pl-2">Требования</th>
                    <th scope="col" className="w-[210px] pb-1 pl-2">
                      <span className="sr-only">Действия</span>
                    </th>
                  </tr>
                </thead>
                {groups.map((group) => {
                  const isCollapsed = collapsed.includes(group.name);
                  return (
                    <tbody key={group.name} className="border-t">
                      <tr className="bg-muted/40">
                        <td className="py-1">
                          <button
                            type="button"
                            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"
                            aria-expanded={!isCollapsed}
                            aria-label={`Сектор ${group.name}`}
                            onClick={() =>
                              setCollapsed((prev) =>
                                isCollapsed
                                  ? prev.filter((name) => name !== group.name)
                                  : [...prev, group.name]
                              )
                            }
                          >
                            {isCollapsed ? (
                              <ChevronRight className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <ChevronDown className="h-4 w-4" aria-hidden="true" />
                            )}
                          </button>
                        </td>
                        <td className="py-1">
                          <Input
                            className="h-8 text-xs font-semibold"
                            aria-label={`Название сектора: ${group.name}`}
                            value={group.name}
                            onChange={(e) =>
                              renameSector(group.name, e.target.value)
                            }
                          />
                        </td>
                        <td className="py-1 pl-2 text-xs text-muted-foreground" colSpan={4}>
                          {group.rows.length === 0
                            ? "постов в секторе нет"
                            : `постов: ${group.rows.length} · сотрудников: ${group.rows.reduce(
                                (sum, row) => sum + (row.need || 0),
                                0
                              )}`}
                        </td>
                        <td className="py-1 pl-2">
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => addPost(group.name)}
                            >
                              + Пост
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              aria-label={`Удалить сектор ${group.name}`}
                              onClick={() => removeSector(group.name)}
                            >
                              Удалить
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {!isCollapsed &&
                        group.rows.map((row) => {
                          const isSub = (row.parentPostId ?? "") !== "";
                          const isOpen = expanded.includes(row.id);
                          const name = row.post || "новый";
                          return (
                            <Fragment key={row.id}>
                              <tr className="align-top">
                                <td />
                                <td className="py-1">
                                  <Input
                                    className="h-8 text-xs"
                                    style={isSub ? { marginLeft: 24 } : undefined}
                                    placeholder={isSub ? "Подпост" : "Пост"}
                                    aria-label={isSub ? "Подпост" : "Пост"}
                                    value={row.post}
                                    onChange={(e) =>
                                      patchRow(row.id, { post: e.target.value })
                                    }
                                  />
                                </td>
                                <td className="py-1 pl-2">
                                  <Input
                                    className="h-8 text-xs"
                                    placeholder="Задача"
                                    aria-label="Задача"
                                    value={row.task}
                                    onChange={(e) =>
                                      patchRow(row.id, { task: e.target.value })
                                    }
                                  />
                                </td>
                                <td className="py-1 pl-2">
                                  <Input
                                    className="h-8 text-xs"
                                    type="number"
                                    min={1}
                                    aria-label="Потребность"
                                    value={row.need}
                                    onChange={(e) =>
                                      patchRow(row.id, {
                                        need: Number(e.target.value) || 0,
                                      })
                                    }
                                  />
                                </td>
                                <td className="py-1 pl-2">
                                  <Input
                                    className="h-8 text-xs"
                                    placeholder="07:00–15:00"
                                    aria-label={`Смена поста: ${name}`}
                                    value={row.shift ?? ""}
                                    onChange={(e) =>
                                      patchRow(row.id, { shift: e.target.value })
                                    }
                                  />
                                </td>
                                <td className="py-1 pl-2">
                                  <Input
                                    className="h-8 text-xs"
                                    placeholder="Требования"
                                    aria-label="Требования"
                                    value={row.requirements}
                                    onChange={(e) =>
                                      patchRow(row.id, { requirements: e.target.value })
                                    }
                                  />
                                </td>
                                <td className="py-1 pl-2">
                                  <div className="flex gap-1">
                                    {!isSub && (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        aria-label={`Добавить подпост: ${name}`}
                                        onClick={() => addSubPost(row)}
                                      >
                                        + Подпост
                                      </Button>
                                    )}
                                    <Button
                                      type="button"
                                      variant={isOpen ? "secondary" : "outline"}
                                      size="sm"
                                      aria-label={`Подробнее: ${name}`}
                                      aria-expanded={isOpen}
                                      aria-controls={`recon-post-details-${row.id}`}
                                      onClick={() =>
                                        setExpanded((prev) =>
                                          isOpen
                                            ? prev.filter((id) => id !== row.id)
                                            : [...prev, row.id]
                                        )
                                      }
                                    >
                                      <Pencil className="h-4 w-4" aria-hidden="true" />
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      aria-label={
                                        isSub ? "Удалить подпост" : "Удалить пост"
                                      }
                                      onClick={() => removeRow(row)}
                                    >
                                      <X className="h-4 w-4" aria-hidden="true" />
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                              {isOpen && (
                                <tr id={`recon-post-details-${row.id}`} className="bg-muted/20">
                                  <td />
                                  <td className="py-2 pr-2" colSpan={6}>
                                    <div className="grid gap-2 md:grid-cols-5">
                                      <label className="space-y-1 text-[11px] text-muted-foreground">
                                        <span>Тип</span>
                                        <select
                                          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
                                          aria-label={`Тип поста: ${name}`}
                                          value={row.postType ?? ""}
                                          onChange={(e) =>
                                            patchRow(row.id, { postType: e.target.value })
                                          }
                                        >
                                          <option value="">—</option>
                                          {POST_TYPES.map((type) => (
                                            <option key={type} value={type}>
                                              {type}
                                            </option>
                                          ))}
                                          {(row.postType ?? "") !== "" &&
                                            !POST_TYPES.includes(
                                              row.postType as (typeof POST_TYPES)[number]
                                            ) && (
                                              <option value={row.postType}>
                                                {row.postType}
                                              </option>
                                            )}
                                        </select>
                                      </label>
                                      <label className="space-y-1 text-[11px] text-muted-foreground">
                                        <span>Вооружение</span>
                                        <Input
                                          className="h-8 text-xs"
                                          placeholder="—"
                                          aria-label={`Вооружение: ${name}`}
                                          value={row.weapon ?? ""}
                                          onChange={(e) =>
                                            patchRow(row.id, { weapon: e.target.value })
                                          }
                                        />
                                      </label>
                                      <label className="space-y-1 text-[11px] text-muted-foreground">
                                        <span>Форма одежды</span>
                                        <Input
                                          className="h-8 text-xs"
                                          placeholder="—"
                                          aria-label={`Форма одежды: ${name}`}
                                          value={row.uniform ?? ""}
                                          onChange={(e) =>
                                            patchRow(row.id, { uniform: e.target.value })
                                          }
                                        />
                                      </label>
                                      <label className="space-y-1 text-[11px] text-muted-foreground">
                                        <span>Примечание</span>
                                        <Input
                                          className="h-8 text-xs"
                                          placeholder="—"
                                          aria-label={`Примечание к посту: ${name}`}
                                          value={row.comment}
                                          onChange={(e) =>
                                            patchRow(row.id, { comment: e.target.value })
                                          }
                                        />
                                      </label>
                                      <label className="space-y-1 text-[11px] text-muted-foreground">
                                        <span>Мин. рейтинг</span>
                                        <Input
                                          className="h-8 text-xs"
                                          type="number"
                                          aria-label="Минимальный рейтинг"
                                          value={row.minRating ?? ""}
                                          onChange={(e) =>
                                            patchRow(row.id, {
                                              minRating:
                                                e.target.value === ""
                                                  ? null
                                                  : Number(e.target.value),
                                            })
                                          }
                                        />
                                      </label>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                    </tbody>
                  );
                })}
              </table>
              {/* Итог под таблицей — словами (`[РЕК-05]`). */}
              <p className="mt-2 text-xs text-muted-foreground" data-slot="recon-totals">
                Итого: секторов {groups.length} · постов{" "}
                {groups.reduce((sum, group) => sum + group.rows.length, 0)} · потребность{" "}
                {groups.reduce(
                  (sum, group) =>
                    sum + group.rows.reduce((inner, row) => inner + (row.need || 0), 0),
                  0
                )}{" "}
                сотрудников
              </p>
            </div>
          )}
        </section>

        <FieldErrors errors={fieldErrors} />
        <StageError error={update.error} />
        <StageError error={importPosts.error} />
        <StageError error={complete.error} />

        {/* Подвал `[РЕК-07]` (Plane №443): липкая панель «Потребность по объекту:
            N → уйдёт в „Сбор сил на ОМ“ [Сохранить] [Завершить рекогносцировку →]».
            «Завершить» недоступна, пока нет постов, обязательные пункты в
            «Не проверено», не назначен старший или есть несохранённое;
            причина — в подсказке. Подтверждение — диалог с числом. */}
        <div
          className="sticky bottom-0 -mx-6 -mb-6 flex flex-wrap items-center justify-between gap-2 border-t bg-background/95 px-6 py-3 backdrop-blur"
          data-slot="recon-footer"
        >
          {/* 🔴 ЧИСЛО ОБЪЕКТА И ЧИСЛО, КОТОРОЕ УЙДЁТ ШТАБУ, — РАЗНЫЕ (Plane
              №708). Подвал печатал потребность ПОКАЗАННОГО объекта, а
              `complete_recon` отправляет штабу сумму по ВСЕМ постам
              мероприятия: на ОМ с двумя объектами человек подтверждал «5
              сотрудников», а уходило 12. Оба числа названы, и второе — только
              когда оно отличается: лишняя цифра там, где объект один,
              заставляла бы искать разницу, которой нет. */}
          <p className="text-sm">
            Потребность по объекту{activeVisitObject !== null ? ` «${activeVisitObject.objectName}»` : ""}:{" "}
            <b className="tabular-nums" data-slot="recon-need">{activeVisitObject !== null ? needOfVisit : needFromPosts}</b>{" "}
            <span className="text-muted-foreground">
              →{" "}
              {needOfVisit !== needFromPosts && activeVisitObject !== null && (
                <>
                  штабу уйдёт по мероприятию{" "}
                  <b className="tabular-nums text-foreground" data-slot="recon-need-event">
                    {needFromPosts}
                  </b>{" "}
                  в{" "}
                </>
              )}
              {needOfVisit === needFromPosts || activeVisitObject === null
                ? "уйдёт в "
                : ""}
              <Link href="/employees?view=forces" className="font-semibold text-primary-ink">
                «Сбор сил на ОМ»
              </Link>
            </span>
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!dirty || update.isPending}
              onClick={save}
            >
              {update.isPending ? "Сохранение…" : "Сохранить"}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={completeBlocked !== null || complete.isPending}
              title={completeBlocked ?? undefined}
              onClick={() => setConfirmOpen(true)}
            >
              {complete.isPending ? "Завершение…" : "Завершить рекогносцировку →"}
            </Button>
          </div>
        </div>
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              {/* В заголовке — ЧИСЛО, КОТОРОЕ ДЕЙСТВИТЕЛЬНО УЙДЁТ (Plane
                  №708): подтверждают отправку, а отправляется сумма по
                  мероприятию. Потребность показанного объекта названа ниже,
                  когда она отличается, — чтобы разница не выглядела опечаткой. */}
              <DialogTitle>
                Отправить потребность {needFromPosts} сотрудников штабу 2-го департамента?
              </DialogTitle>
              <DialogDescription>
                Потребность зафиксируется, объект перейдёт к расстановке, штаб получит заявку.
                {activeVisitObject !== null && needOfVisit !== needFromPosts && (
                  <>
                    {" "}
                    По объекту «{activeVisitObject.objectName}» рассчитано{" "}
                    {needOfVisit}; штабу уходит сумма по всем объектам
                    мероприятия.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
                Отмена
              </Button>
              <Button
                type="button"
                disabled={complete.isPending}
                onClick={() => {
                  complete.mutate({});
                  setConfirmOpen(false);
                }}
              >
                Отправить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

/**
 * Сведения об объекте из реестра и привязанной версии паспорта. Read-only:
 * рекогносцировка правит расчёт, паспорт — нет.
 *
 * Запрос уходит только с правом `object.view`: без него реестр объектов
 * отвечает 403, и блок просто не рисуется — этап от этого не ломается.
 */
function ObjectFacts({ event }: { event: SecurityEvent }) {
  const { hasPermission } = useOpsPermissions();
  const objectId = event.objectId;
  const canView = hasPermission("object.view") && objectId !== null;
  const query = useSecurityObject(canView ? objectId : "");

  if (!canView) return null;

  const object = query.data;
  const binding = event.passportBinding;
  const boundVersion =
    binding === null || object === undefined
      ? undefined
      : object.passportVersions.find((version) => version.id === binding.versionId);
  const postsInVersion =
    boundVersion === undefined
      ? null
      : boundVersion.sectors.reduce((sum, sector) => sum + sector.posts.length, 0);

  return (
    <section className="rounded-md border bg-muted/30 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Сведения об объекте</h3>
        {/* Реестр ОМ ищет и по объекту (плейсхолдер поиска называет его явно),
            поэтому «история по объекту» — это тот же реестр с запросом. */}
        <Link
          href={`/security-ops/events?search=${encodeURIComponent(event.objectName)}`}
          className="text-xs font-semibold text-primary-ink"
        >
          История прошлых ОМ по объекту →
        </Link>
      </div>
      {query.isLoading ? (
        <p className="text-xs text-muted-foreground">Загрузка карточки объекта…</p>
      ) : query.isError || object === undefined ? (
        <p className="text-xs text-muted-foreground">
          Карточка объекта недоступна — сведения ниже не показаны.
        </p>
      ) : (
        <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Объект" value={`${object.code} · ${object.name}`} />
          <Fact label="Тип" value={object.type} />
          <Fact label="Регион" value={object.region} />
          <Fact label="Адрес" value={object.address} />
          {binding === null ? (
            <Fact label="Паспорт" value="версия не привязана" />
          ) : (
            <Fact
              label="Версия паспорта"
              value={`№ ${binding.versionNumber} (действует с ${formatIsoDate(binding.effectiveFrom)})`}
            />
          )}
          {postsInVersion !== null && boundVersion !== undefined && (
            <Fact
              label="В версии паспорта"
              value={`секторов ${boundVersion.sectors.length}, постов ${postsInVersion}`}
            />
          )}
        </dl>
      )}
    </section>
  );
}
