"use client";

import { ChevronDown, ChevronRight, X } from "lucide-react";

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
import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  useCompleteRecon,
  useImportReconPosts,
  useUpdateRecon,
} from "@/hooks/use-security-event-stages";
import { useSecurityObject } from "@/hooks/use-security-objects";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import type {
  ReconChecklistItem,
  ReconSectorPost,
  SecurityEvent,
} from "@/entities/security-event";
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

  /* ── Принадлежность расчёта объекту посещения (Plane №409) ──────────────
   *
   * Спецификация `[МД-04]`: у объекта СВОИ этапы, `[РЕК-07]`: подвал считает
   * «потребность ПО ОБЪЕКТУ». Пост принадлежит объекту с №408, но выбрать
   * этот объект было негде: импорт у ОМ с двумя объектами отвечал «выберите,
   * для какого», а выбора на экране не было.
   *
   * Объект показан ПЕРЕКЛЮЧАТЕЛЕМ, а не тринадцатой колонкой таблицы: в ней
   * уже двенадцать, и аудит `[РЕК-09]` жалуется именно на ширину. Заодно это
   * ближе к эталону: там этапы ведут по объекту, а не по мероприятию.
   */
  const UNASSIGNED = "__unassigned__";
  const unassignedCount = rows.filter(
    (row) => (row.visitObjectId ?? null) === null
  ).length;
  const [activeVisit, setActiveVisit] = useState<string>(
    () => event.visitObjects[0]?.id ?? UNASSIGNED
  );
  // Объект мог быть снят с мероприятия в соседней вкладке — тогда показанный
  // выбор указывает в пустоту, и честнее вернуться к первому существующему.
  const activeVisitExists =
    activeVisit === UNASSIGNED ||
    event.visitObjects.some((visit) => visit.id === activeVisit);
  const shownVisit = activeVisitExists
    ? activeVisit
    : (event.visitObjects[0]?.id ?? UNASSIGNED);
  const activeVisitObject =
    event.visitObjects.find((visit) => visit.id === shownVisit) ?? null;
  /** Строки показанного объекта. Остальные не удалены и не забыты — они
   *  сохраняются вместе со всеми, просто сейчас не на экране. */
  const visibleRows = useMemo(
    () =>
      rows.filter((row) =>
        shownVisit === UNASSIGNED
          ? (row.visitObjectId ?? null) === null
          : row.visitObjectId === shownVisit
      ),
    [rows, shownVisit]
  );

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
      visitObjectId: shownVisit === UNASSIGNED ? null : shownVisit,
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

        <section>
          {/* Счётчик выполненного — из эталона («Выполнено: N»). Без него
              длину осмотра приходилось оценивать глазом по галочкам, а
              «сколько осталось» — единственное, что от чек-листа нужно на
              бегу. Считается по ЧЕРНОВИКУ формы, а не по сохранённому ОМ:
              галочка ставится до сохранения, и отставший счётчик читался бы
              как «не засчиталось». Живым регионом НЕ объявлен: счёт меняет
              сам человек своей же галочкой, и объявлять ему его действие —
              шум. */}
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">Чек-лист рекогносцировки</h3>
            <span className="text-xs text-muted-foreground">
              Выполнено: {checklist.filter((item) => item.done).length} из{" "}
              {checklist.length}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {checklist.map((item) => {
              // Та же проверка, что и на сервере, — но названная СРАЗУ, у
              // поля: иначе про обязательный комментарий человек узнаёт
              // отказом сохранения, уже уйдя с пункта.
              const needsComment =
                item.result === "NEEDS_CHANGES" && item.comment.trim() === "";
              return (
                <div
                  key={item.id}
                  className="grid grid-cols-1 items-start gap-2 border-b pb-2 last:border-0 md:grid-cols-[auto_1fr_170px_1fr]"
                >
                  <Checkbox
                    className="mt-1"
                    aria-label={`Выполнено: ${item.label}`}
                    checked={item.done}
                    onCheckedChange={(checked) =>
                      patchItem(item.id, { done: checked === true })
                    }
                  />
                  <span className="text-sm">
                    {item.label} <span aria-hidden="true">*</span>
                  </span>
                  <select
                    aria-label={`Результат: ${item.label}`}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={item.result ?? ""}
                    onChange={(e) =>
                      patchItem(item.id, {
                        result:
                          e.target.value === ""
                            ? null
                            : (e.target.value as "MATCHES" | "NEEDS_CHANGES"),
                      })
                    }
                  >
                    <option value="">— не проверено —</option>
                    <option value="MATCHES">Соответствует</option>
                    <option value="NEEDS_CHANGES">Требует изменений</option>
                  </select>
                  <div className="space-y-1">
                    <Input
                      className="h-8 text-xs"
                      placeholder="Комментарий"
                      aria-label={`Комментарий: ${item.label}`}
                      aria-invalid={needsComment || undefined}
                      value={item.comment}
                      onChange={(e) =>
                        patchItem(item.id, { comment: e.target.value })
                      }
                    />
                    {needsComment && (
                      <p className="text-xs text-destructive">
                        Укажите комментарий
                      </p>
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
                  importPosts.mutate({ visitObjectId: shownVisit })
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
          {/* Переключатель объекта. Показывается, когда выбор ЕСТЬ: у ОМ с
              единственным объектом и без нераспределённых строк выбирать не
              из чего, и элемент управления с одним значением только мешает. */}
          {(event.visitObjects.length > 1 || unassignedCount > 0) && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
              <label
                className="text-xs font-semibold"
                htmlFor="recon-visit-object"
              >
                Объект посещения
              </label>
              <select
                id="recon-visit-object"
                className="h-8 rounded-md border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={shownVisit}
                onChange={(e) => setActiveVisit(e.target.value)}
              >
                {event.visitObjects.map((visit) => (
                  <option key={visit.id} value={visit.id}>
                    {visit.objectName} · постов{" "}
                    {rows.filter((row) => row.visitObjectId === visit.id).length}
                  </option>
                ))}
                {unassignedCount > 0 && (
                  <option value={UNASSIGNED}>
                    Не отнесены к объекту · постов {unassignedCount}
                  </option>
                )}
              </select>
              {shownVisit === UNASSIGNED && event.visitObjects.length > 0 && (
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
                        setActiveVisit(visit.id);
                      }}
                    >
                      {visit.objectName}
                    </Button>
                  ))}
                  <span>— затем «Сохранить расчёт».</span>
                </span>
              )}
            </div>
          )}
          {groups.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {shownVisit === UNASSIGNED
                ? "Нераспределённых постов нет."
                : "Постов пока нет — добавьте сектор или импортируйте из паспорта."}
            </p>
          ) : (
            /* Таблица шире экрана: десять колонок расчёта не сжимаются до
               читаемости. Скроллится ОНА, а не страница. */
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1060px] table-fixed border-collapse text-left">
                <thead>
                  <tr className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="w-8 pb-1">
                      <span className="sr-only">Свернуть сектор</span>
                    </th>
                    <th scope="col" className="w-[180px] pb-1">Сектор / Пост</th>
                    <th scope="col" className="pb-1 pl-2">Задача поста</th>
                    <th scope="col" className="w-[92px] pb-1 pl-2">Сотрудники</th>
                    {/* Смена — свойство ПОСТА, как в эталоне («Сектор A ·
                        смена 07:00–15:00»). Стоит рядом с численностью:
                        «сколько человек» и «когда стоят» читаются вместе, а
                        расстановка показывает их одной строкой (Plane №123). */}
                    <th scope="col" className="w-[116px] pb-1 pl-2">Смена</th>
                    <th scope="col" className="w-[128px] pb-1 pl-2">Тип</th>
                    <th scope="col" className="pb-1 pl-2">Вооружение</th>
                    <th scope="col" className="pb-1 pl-2">Форма одежды</th>
                    <th scope="col" className="pb-1 pl-2">Примечание</th>
                    {/* Колонок эталона тут две лишних — их читает расстановка:
                        по «Требованиям» и «Мин. рейтингу» она считает пригодность
                        кандидата. Убрать поля значило бы сделать эти данные
                        нередактируемыми. */}
                    <th scope="col" className="pb-1 pl-2">Требования</th>
                    <th scope="col" className="w-[72px] pb-1 pl-2">Мин. рейтинг</th>
                    <th scope="col" className="w-[136px] pb-1 pl-2">
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
                        <td className="py-1 pl-2 text-xs text-muted-foreground" colSpan={6}>
                          {group.rows.length === 0
                            ? "постов в секторе нет"
                            : `постов: ${group.rows.length} · сотрудников: ${group.rows.reduce(
                                (sum, row) => sum + (row.need || 0),
                                0
                              )}`}
                        </td>
                        <td className="py-1" colSpan={2} />
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
                          return (
                            <tr key={row.id} className="align-top">
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
                                  aria-label={`Смена поста: ${row.post || "новый"}`}
                                  value={row.shift ?? ""}
                                  onChange={(e) =>
                                    patchRow(row.id, { shift: e.target.value })
                                  }
                                />
                              </td>
                              <td className="py-1 pl-2">
                                <select
                                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                                  aria-label={`Тип поста: ${row.post || "новый"}`}
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
                              </td>
                              <td className="py-1 pl-2">
                                <Input
                                  className="h-8 text-xs"
                                  placeholder="—"
                                  aria-label={`Вооружение: ${row.post || "новый"}`}
                                  value={row.weapon ?? ""}
                                  onChange={(e) =>
                                    patchRow(row.id, { weapon: e.target.value })
                                  }
                                />
                              </td>
                              <td className="py-1 pl-2">
                                <Input
                                  className="h-8 text-xs"
                                  placeholder="—"
                                  aria-label={`Форма одежды: ${row.post || "новый"}`}
                                  value={row.uniform ?? ""}
                                  onChange={(e) =>
                                    patchRow(row.id, { uniform: e.target.value })
                                  }
                                />
                              </td>
                              <td className="py-1 pl-2">
                                <Input
                                  className="h-8 text-xs"
                                  placeholder="—"
                                  aria-label={`Примечание к посту: ${row.post || "новый"}`}
                                  value={row.comment}
                                  onChange={(e) =>
                                    patchRow(row.id, { comment: e.target.value })
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
                              </td>
                              <td className="py-1 pl-2">
                                <div className="flex gap-1">
                                  {!isSub && (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      aria-label={`Добавить подпост: ${row.post || "новый"}`}
                                      onClick={() => addSubPost(row)}
                                    >
                                      + Подпост
                                    </Button>
                                  )}
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
                          );
                        })}
                    </tbody>
                  );
                })}
              </table>
            </div>
          )}
          {/* Названо вслух, а не нарисовано: «Материалы рекогносцировки» из
              эталона класть некуда — файлового хранилища у системы нет. */}
          <p className="mt-2 text-xs text-muted-foreground">
            Материалы рекогносцировки (фотографии, схемы, документы) система не
            хранит — файлового хранилища нет.
          </p>
        </section>

        <FieldErrors errors={fieldErrors} />
        <StageError error={update.error} />
        <StageError error={importPosts.error} />
        <StageError error={complete.error} />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
            {activeVisitObject !== null && (
              <>
                Потребность объекта «{activeVisitObject.objectName}»:{" "}
                <span className="font-semibold text-foreground">
                  {needOfVisit}
                </span>
                {" · "}
              </>
            )}
            Расчёт по постам всего: {needFromPosts}
            {needFromPosts === 0 && " (постов пока нет)"}. Завершение этапа
            направит это число штабу 2-го департамента — он разложит его по
            департаментам в разделе{" "}
            <Link href="/employees" className="font-semibold text-primary-ink">
              «Сбор сил на ОМ»
            </Link>
            .
          </p>
          <Button
            type="button"
            disabled={complete.isPending || dirty}
            title={dirty ? "Сохраните расчёт перед завершением этапа." : undefined}
            onClick={() => complete.mutate({})}
          >
            {complete.isPending
              ? "Завершение…"
              : "Завершить этап и перейти далее"}
          </Button>
        </div>
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
