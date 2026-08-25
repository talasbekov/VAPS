"use client";

import { X } from "lucide-react";

// Этап 2 «Рекогносцировка»: чек-лист объекта и event-specific расчёт постов.
// Импорт из привязанной версии паспорта ДОБАВЛЯЕТ строки (ручные не
// затираются), повторный импорт дубли не плодит. «Требует изменений» в
// чек-листе обязывает к комментарию.
//
// Из прототипа Smart Josparlau (экран «Рекогносцировка объекта») добавлены:
// сведения об объекте из паспорта, «результат проверки» и комментарий по
// КАЖДОМУ посту (поля result/comment у поста были в контракте и сохранялись
// сервером, но экран их не показывал — рекогносцировка сводилась к описи
// постов без итога осмотра) и вход в историю ОМ по объекту.
//
// Чего из прототипа НЕТ: фотографии к пунктам чек-листа — вложений у пункта
// не хранит ни бэк, ни контракт, приложить файл некуда.
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export function ReconStage({ event }: { event: SecurityEvent }) {
  const [checklist, setChecklist] = useState<ReconChecklistItem[]>(
    event.reconChecklist
  );
  const [rows, setRows] = useState<ReconSectorPost[]>(event.reconSectorPosts);
  // Запрос личного состава держится СТРОКОЙ, а не числом: пустое поле должно
  // остаться пустым, а `Number("")` даёт 0 — и человек видел бы ноль, которого
  // не вводил, в поле, помеченном звёздочкой.
  const [forceRequest, setForceRequest] = useState(
    event.reconForceRequest === 0 ? "" : String(event.reconForceRequest)
  );
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
      setForceRequest(
        fresh.reconForceRequest === 0 ? "" : String(fresh.reconForceRequest)
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

  const dirty =
    JSON.stringify({ checklist, rows, forceRequest }) !==
    JSON.stringify({
      checklist: event.reconChecklist,
      rows: event.reconSectorPosts,
      forceRequest:
        event.reconForceRequest === 0 ? "" : String(event.reconForceRequest),
    });

  /** Расчёт по постам — ПОДСКАЗКА, а не значение поля. В эталоне число вводит
   * старший наряда: осмотр даёт поправку на местность, которой в расчёте
   * постов нет. Подставлять сумму молча значило бы выдавать расчёт за его
   * оценку. */
  const needFromPosts = rows.reduce((sum, row) => sum + (row.need || 0), 0);

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

  function addRow(): void {
    setRows((prev) => [
      ...prev,
      {
        id: nextLocalId(),
        sector: "",
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
      },
    ]);
  }

  /** Подпост из прототипа: строка, привязанная к посту-родителю. */
  function addSubRow(parent: ReconSectorPost): void {
    setRows((prev) => {
      const index = prev.findIndex((row) => row.id === parent.id);
      const sub: ReconSectorPost = {
        id: nextLocalId(),
        sector: parent.sector,
        post: `${parent.post} / Подпост`,
        task: "",
        need: 1,
        requirements: parent.requirements,
        result: null,
        comment: "",
        sourceSectorId: null,
        sourcePostId: null,
        minRating: parent.minRating,
        postType: parent.postType ?? "",
        weapon: parent.weapon ?? "",
        uniform: parent.uniform ?? "",
        parentPostId: parent.id,
      };
      // Подпост встаёт СРАЗУ за родителем: расчёт читают сверху вниз, и
      // строка в конце таблицы потеряла бы связь с постом.
      return [...prev.slice(0, index + 1), sub, ...prev.slice(index + 1)];
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Рекогносцировка</CardTitle>
      </CardHeader>
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
            <h3 className="text-sm font-semibold">Чек-лист объекта</h3>
            <span className="text-xs text-muted-foreground">
              Выполнено: {checklist.filter((item) => item.done).length} из{" "}
              {checklist.length}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {checklist.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-1 items-center gap-2 border-b pb-2 last:border-0 md:grid-cols-[auto_1fr_170px_1fr]"
              >
                <Checkbox
                  aria-label={`Выполнено: ${item.label}`}
                  checked={item.done}
                  onCheckedChange={(checked) =>
                    patchItem(item.id, { done: checked === true })
                  }
                />
                <span className="text-sm">{item.label}</span>
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
                <Input
                  className="h-8 text-xs"
                  placeholder="Комментарий"
                  aria-label={`Комментарий: ${item.label}`}
                  value={item.comment}
                  onChange={(e) => patchItem(item.id, { comment: e.target.value })}
                />
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Посты и секторы</h3>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={importPosts.isPending || event.passportBinding === null}
                title={
                  event.passportBinding === null
                    ? "Мероприятие не привязано к версии паспорта."
                    : undefined
                }
                onClick={() => importPosts.mutate({})}
              >
                {importPosts.isPending ? "Импорт…" : "Импорт из паспорта"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={addRow}>
                + Пост
              </Button>
            </div>
          </div>
          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Постов пока нет — импортируйте из паспорта или добавьте вручную.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {/* Шапка колонок из прототипа. До неё расчёт был рядом голых
                  полей: подписи жили только в aria-label, и глазом колонку
                  «Мин. рейтинг» от «Требований» отличить было нельзя —
                  плейсхолдер исчезает, как только в поле что-то введено.
                  Скринридеру шапка не нужна (у каждого поля своё имя) —
                  поэтому aria-hidden, чтобы не читать заголовки дважды. */}
              <div
                aria-hidden="true"
                className="text-muted-foreground hidden gap-2 px-1 text-[10px] font-bold uppercase tracking-wider md:grid md:grid-cols-[1fr_1fr_1.4fr_70px_1.1fr_80px_1fr_1fr_1fr_1.2fr_auto_auto]"
              >
                <span>Сектор</span>
                <span>Пост</span>
                <span>Задача поста</span>
                <span>Кол-во</span>
                <span>Требования</span>
                <span>Рейтинг</span>
                <span>Тип</span>
                <span>Вооружение</span>
                <span>Форма одежды</span>
                <span>Примечание</span>
                <span />
                <span />
              </div>
              {rows.map((row) => (
                <div
                  key={row.id}
                  style={
                    (row.parentPostId ?? "") !== ""
                      ? { paddingLeft: 16 }
                      : undefined
                  }
                  className="grid grid-cols-2 gap-2 border-b pb-2 last:border-0 md:grid-cols-[1fr_1fr_1.4fr_70px_1.1fr_80px_1fr_1fr_1fr_1.2fr_auto_auto]"
                >
                  <Input
                    className="h-8 text-xs"
                    placeholder="Сектор"
                    aria-label="Сектор"
                    value={row.sector}
                    onChange={(e) => patchRow(row.id, { sector: e.target.value })}
                  />
                  <Input
                    className="h-8 text-xs"
                    placeholder="Пост"
                    aria-label="Пост"
                    value={row.post}
                    onChange={(e) => patchRow(row.id, { post: e.target.value })}
                  />
                  <Input
                    className="h-8 text-xs"
                    placeholder="Задача"
                    aria-label="Задача"
                    value={row.task}
                    onChange={(e) => patchRow(row.id, { task: e.target.value })}
                  />
                  <Input
                    className="h-8 text-xs"
                    type="number"
                    min={1}
                    aria-label="Потребность"
                    value={row.need}
                    onChange={(e) =>
                      patchRow(row.id, { need: Number(e.target.value) || 0 })
                    }
                  />
                  <Input
                    className="h-8 text-xs"
                    placeholder="Требования"
                    aria-label="Требования"
                    value={row.requirements}
                    onChange={(e) =>
                      patchRow(row.id, { requirements: e.target.value })
                    }
                  />
                  <Input
                    className="h-8 text-xs"
                    type="number"
                    placeholder="Мин. рейтинг"
                    aria-label="Минимальный рейтинг"
                    value={row.minRating ?? ""}
                    onChange={(e) =>
                      patchRow(row.id, {
                        minRating:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                  {/* Колонки таблицы прототипа: тип поста, вооружение, форма
                      одежды, примечание. */}
                  <Input
                    className="h-8 text-xs"
                    placeholder="Тип"
                    aria-label={`Тип поста: ${row.post || "новый"}`}
                    value={row.postType ?? ""}
                    onChange={(e) => patchRow(row.id, { postType: e.target.value })}
                  />
                  <Input
                    className="h-8 text-xs"
                    placeholder="Вооружение"
                    aria-label={`Вооружение: ${row.post || "новый"}`}
                    value={row.weapon ?? ""}
                    onChange={(e) => patchRow(row.id, { weapon: e.target.value })}
                  />
                  <Input
                    className="h-8 text-xs"
                    placeholder="Форма одежды"
                    aria-label={`Форма одежды: ${row.post || "новый"}`}
                    value={row.uniform ?? ""}
                    onChange={(e) => patchRow(row.id, { uniform: e.target.value })}
                  />
                  <Input
                    className="h-8 text-xs"
                    placeholder="Примечание"
                    aria-label={`Примечание к посту: ${row.post || "новый"}`}
                    value={row.comment}
                    onChange={(e) => patchRow(row.id, { comment: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Добавить подпост: ${row.post || "новый"}`}
                    onClick={() => addSubRow(row)}
                  >
                    + Подпост
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label="Удалить пост"
                    onClick={() =>
                      setRows((prev) => prev.filter((r) => r.id !== row.id))
                    }
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* «Итог рекогносцировки» из эталона (Plane «Реестр ОМ-23»): запрос
            личного состава — то, ради чего этап и завершают. Число уходит
            штабу 2-го департамента, который раскладывает его по департаментам
            в «Сборе сил на ОМ»; до завершения этапа это черновик старшего
            наряда, и штаб его не видит. */}
        <section className="rounded-md border p-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">Итог рекогносцировки</h3>
            <span className="text-xs text-muted-foreground">
              {event.reconForceRequestedAt === null
                ? "запрос ещё не направлен"
                : `запрос направлен ${formatIsoDate(event.reconForceRequestedAt)}`}
            </span>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <label
                htmlFor="recon-force-request"
                className="text-xs font-semibold"
              >
                Требуемое число сотрудников *
              </label>
              <Input
                id="recon-force-request"
                className="h-9 w-36 tabular-nums"
                type="number"
                min={1}
                value={forceRequest}
                onChange={(e) => setForceRequest(e.target.value)}
              />
            </div>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              {/* Подсказка называет расчёт, но НЕ подставляет его: оценка
                  старшего наряда и сумма по постам — разные числа, и на их
                  разнице работает штаб. */}
              Расчёт по постам даёт {needFromPosts}
              {needFromPosts === 0 && " (постов пока нет)"}. Штаб 2-го
              департамента получит указанное число и разложит его по
              департаментам в разделе{" "}
              <Link
                href="/employees"
                className="font-semibold text-primary-ink"
              >
                «Сбор сил на ОМ»
              </Link>
              .
            </p>
          </div>
        </section>

        <FieldErrors errors={fieldErrors} />
        <StageError error={update.error} />
        <StageError error={importPosts.error} />
        <StageError error={complete.error} />

        <div className="flex justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={!dirty || update.isPending}
            onClick={() => {
              setFieldErrors(null);
              update.mutate({
                checklist,
                sectorPosts: rows,
                // Пустое поле — это НОЛЬ («запрос снят»), а не «не трогать»:
                // человек стёр число намеренно, и молча оставить прежнее
                // значило бы отправить штабу то, что он только что убрал.
                forceRequest: forceRequest.trim() === "" ? 0 : Number(forceRequest),
              });
            }}
          >
            {update.isPending ? "Сохранение…" : "Сохранить рекогносцировку"}
          </Button>
          <Button
            type="button"
            disabled={complete.isPending || dirty}
            title={dirty ? "Сначала сохраните изменения." : undefined}
            onClick={() => complete.mutate({})}
          >
            {complete.isPending
              ? "Завершение…"
              : "Завершить рекогносцировку → запрос штабу"}
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
          История ОМ по объекту →
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
