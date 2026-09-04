"use client";

// Единый режим правки сводных данных ГВО (`[ГВО-05]`, Plane №441): одна
// кнопка «Редактировать» на страницу → все поля инпутами → «Сохранить /
// Отмена». Отдельных окон и кнопок «Изменить» по блокам больше нет.
//
// Разделы остаются разделами КОНТРАКТА: сервер принимает патч по одному
// разделу за раз, поэтому «Сохранить» отправляет по патчу на каждый раздел,
// в котором что-то изменилось, по очереди, и флаги «уточняется» — с
// последним. Разбор текста в патч — тот же `gvoPatchFromForm`, что и у
// прежних окон: формат «Фамилия | позывной | роль» не менялся.
//
// Списки лиц и групп правятся ПОЭЛЕМЕНТНО (ФИО / должность / данные у
// каждого лица; название и состав у каждой группы) — так их правили окна
// «person:N» / «group:N», и проба разделов идёт по тем же подписям.
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/shared/hooks/use-toast";
import {
  gvoFormFromSummary,
  gvoPatchFromForm,
  gvoSectionSpec,
} from "@/entities/gvo-summary";
import type {
  GvoFieldSpec,
  GvoSection,
  GvoSectionForm,
  GvoSummary,
  GvoSummaryPatch,
} from "@/entities/gvo-summary";
import { useResetGvoSection, useSaveGvoSection } from "@/hooks/use-gvo-summaries";

/** Разделы, которые правятся целиком — в порядке печатного документа. */
const WHOLE_SECTIONS: GvoSection[] = [
  "head",
  "arrival",
  "departure",
  "org",
  "resp",
  "transport",
];

/** Разделы «Вернуть исходные» — все, у которых есть свой патч. */
const RESET_SECTIONS: GvoSection[] = [
  "head",
  "persons",
  "arrival",
  "departure",
  "org",
  "groups",
  "transport",
];

interface Draft {
  whole: Record<string, GvoSectionForm>;
  persons: GvoSectionForm[];
  groups: GvoSectionForm[];
  flags: string[];
}

function draftOf(summary: GvoSummary, unspecified: string[]): Draft {
  return {
    whole: Object.fromEntries(
      WHOLE_SECTIONS.map((section) => [section, gvoFormFromSummary(section, summary)])
    ),
    persons: summary.persons.map((_, index) =>
      gvoFormFromSummary(`person:${index}` as GvoSection, summary)
    ),
    groups: summary.groups.map((_, index) =>
      gvoFormFromSummary(`group:${index}` as GvoSection, summary)
    ),
    flags: [...unspecified].sort(),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface GvoEditFormProps {
  omCode: string;
  summary: GvoSummary;
  unspecified: string[];
  onDone: () => void;
}

export function GvoEditForm({ omCode, summary, unspecified, onDone }: GvoEditFormProps) {
  const { toast } = useToast();
  const [initial] = useState(() => draftOf(summary, unspecified));
  const [draft, setDraft] = useState<Draft>(initial);
  const save = useSaveGvoSection();
  const reset = useResetGvoSection();
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const pending = busy !== null;

  const setWhole = (section: string, key: string, value: string) =>
    setDraft((prev) => ({
      ...prev,
      whole: { ...prev.whole, [section]: { ...prev.whole[section], [key]: value } },
    }));
  const setListItem = (list: "persons" | "groups", index: number, key: string, value: string) =>
    setDraft((prev) => ({
      ...prev,
      [list]: prev[list].map((item, i) => (i === index ? { ...item, [key]: value } : item)),
    }));
  const addListItem = (list: "persons" | "groups") =>
    setDraft((prev) => ({
      ...prev,
      [list]: [
        ...prev[list],
        gvoFormFromSummary(list === "persons" ? "person:new" : "group:new", summary),
      ],
    }));
  const removeListItem = (list: "persons" | "groups", index: number) =>
    setDraft((prev) => ({ ...prev, [list]: prev[list].filter((_, i) => i !== index) }));
  const setFlag = (key: string, on: boolean) =>
    setDraft((prev) => ({
      ...prev,
      flags: on
        ? [...new Set([...prev.flags, key])].sort()
        : prev.flags.filter((flag) => flag !== key),
    }));

  /** Патчи по изменённым разделам. Списки собираются ЦЕЛИКОМ из форм
   * элементов — патч перекрывает базу, и частичный список потерял бы
   * остальных. */
  function changedPatches(): { section: GvoSection; values: GvoSummaryPatch }[] {
    const calls: { section: GvoSection; values: GvoSummaryPatch }[] = [];
    for (const section of WHOLE_SECTIONS) {
      if (same(draft.whole[section], initial.whole[section])) continue;
      calls.push({ section, values: gvoPatchFromForm(section, draft.whole[section], summary) });
    }
    if (!same(draft.persons, initial.persons)) {
      const empty = { ...summary, persons: [] };
      calls.push({
        section: "persons",
        values: {
          persons: draft.persons.map(
            (form) => gvoPatchFromForm("person:new", form, empty).persons?.[0]
          ).filter((person) => person !== undefined),
        },
      });
    }
    if (!same(draft.groups, initial.groups)) {
      const empty = { ...summary, groups: [] };
      calls.push({
        section: "groups",
        values: {
          groups: draft.groups.map(
            (form) => gvoPatchFromForm("group:new", form, empty).groups?.[0]
          ).filter((group) => group !== undefined),
        },
      });
    }
    return calls;
  }

  async function submit(): Promise<void> {
    const calls = changedPatches();
    const flagsChanged = !same(draft.flags, initial.flags);
    if (calls.length === 0 && !flagsChanged) {
      onDone();
      return;
    }
    // Изменились только флаги — везём их с патчем «шапки» без изменений.
    if (calls.length === 0) {
      calls.push({ section: "head", values: gvoPatchFromForm("head", draft.whole.head, summary) });
    }
    setBusy("save");
    setFailure(null);
    try {
      for (const [index, call] of calls.entries()) {
        await save.mutateAsync({
          omCode,
          section: call.section,
          values: call.values,
          ...(index === calls.length - 1 ? { unspecified: draft.flags } : {}),
        });
      }
      toast({ description: "Сводные данные обновлены" });
      onDone();
    } catch {
      setFailure("Не удалось сохранить сводные данные. Попробуйте ещё раз.");
    } finally {
      setBusy(null);
    }
  }

  async function resetAll(): Promise<void> {
    setBusy("reset");
    setFailure(null);
    try {
      for (const section of RESET_SECTIONS) {
        await reset.mutateAsync({ omCode, section });
      }
      toast({ description: "Сводка возвращена к исходным данным" });
      onDone();
    } catch {
      setFailure("Не удалось вернуть исходные данные. Попробуйте ещё раз.");
    } finally {
      setBusy(null);
    }
  }

  const spec = (section: GvoSection) => gvoSectionSpec(section);

  return (
    <form
      className="space-y-3"
      noValidate
      data-slot="gvo-edit-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {/* Панель действий — сверху и липкая: сводка длинная, и кнопки внизу
          пришлось бы искать за сгибом. */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-[12px] border bg-card p-3 shadow-sm">
        <p className="text-sm font-semibold">Правка сводных данных</p>
        <p className="text-xs text-muted-foreground">
          пустое поле остаётся пустым; «уточняется» — флаг, документ печатает его словом
        </p>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => void resetAll()}
          >
            {busy === "reset" ? "Возврат…" : "Вернуть исходные"}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onDone}>
            Отмена
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {busy === "save" ? "Сохранение…" : "Сохранить"}
          </Button>
        </div>
        {failure !== null && (
          <p className="w-full text-sm text-destructive-ink" role="alert">
            {failure}
          </p>
        )}
      </div>

      <Block title={spec("head").title}>
        <Fields
          fields={spec("head").fields}
          values={draft.whole.head}
          onChange={(key, value) => setWhole("head", key, value)}
          flags={draft.flags}
          onFlag={setFlag}
        />
      </Block>

      <Block
        title="Охраняемые лица"
        action={
          <Button type="button" variant="outline" size="sm" className="h-[30px]" onClick={() => addListItem("persons")}>
            ＋ Добавить лицо
          </Button>
        }
      >
        {draft.persons.length === 0 ? (
          <p className="text-xs text-muted-foreground">Лиц нет — добавьте первое.</p>
        ) : (
          <div className="space-y-3">
            {draft.persons.map((person, index) => (
              <fieldset key={index} className="space-y-2 rounded-[12px] border p-3">
                <legend className="px-1 text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  Лицо {index + 1}
                </legend>
                <Fields
                  fields={spec("person:new").fields}
                  values={person}
                  onChange={(key, value) => setListItem("persons", index, key, value)}
                  flags={draft.flags}
                  onFlag={setFlag}
                  noFlags
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-red-200 text-red-700 hover:bg-red-50"
                  aria-label={`Удалить лицо ${index + 1}`}
                  onClick={() => removeListItem("persons", index)}
                >
                  Удалить лицо
                </Button>
              </fieldset>
            ))}
          </div>
        )}
      </Block>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
        {(["arrival", "departure"] as GvoSection[]).map((section) => (
          <Block key={section} title={spec(section).title}>
            <Fields
              fields={spec(section).fields}
              values={draft.whole[section]}
              onChange={(key, value) => setWhole(section, key, value)}
              flags={draft.flags}
              onFlag={setFlag}
            />
          </Block>
        ))}
      </div>

      <Block title={spec("org").title}>
        <Fields
          fields={spec("org").fields}
          values={draft.whole.org}
          onChange={(key, value) => setWhole("org", key, value)}
          flags={draft.flags}
          onFlag={setFlag}
          grid
        />
      </Block>

      <Block
        title="Состав ГВО СГО РК"
        action={
          <Button type="button" variant="outline" size="sm" className="h-[30px]" onClick={() => addListItem("groups")}>
            ＋ Группа
          </Button>
        }
      >
        <Fields
          fields={spec("resp").fields}
          values={draft.whole.resp}
          onChange={(key, value) => setWhole("resp", key, value)}
          flags={draft.flags}
          onFlag={setFlag}
          noFlags
        />
        {draft.groups.length > 0 && (
          <div className="mt-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(330px,1fr))]">
            {draft.groups.map((group, index) => (
              <fieldset key={index} className="space-y-2 rounded-[12px] border p-3">
                <legend className="px-1 text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  Группа {index + 1}
                </legend>
                <Fields
                  fields={spec("group:new").fields}
                  values={group}
                  onChange={(key, value) => setListItem("groups", index, key, value)}
                  flags={draft.flags}
                  onFlag={setFlag}
                  noFlags
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-red-200 text-red-700 hover:bg-red-50"
                  aria-label={`Удалить группу ${index + 1}`}
                  onClick={() => removeListItem("groups", index)}
                >
                  Удалить группу
                </Button>
              </fieldset>
            ))}
          </div>
        )}
      </Block>

      <Block title={spec("transport").title}>
        <Fields
          fields={spec("transport").fields}
          values={draft.whole.transport}
          onChange={(key, value) => setWhole("transport", key, value)}
          flags={draft.flags}
          onFlag={setFlag}
        />
      </Block>
    </form>
  );
}

function Block({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[12px] border bg-card p-[17px]" aria-label={title}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13.5px] font-bold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Fields({
  fields,
  values,
  onChange,
  flags,
  onFlag,
  noFlags = false,
  grid = false,
}: {
  fields: GvoFieldSpec[];
  values: GvoSectionForm;
  onChange: (key: string, value: string) => void;
  flags: string[];
  onFlag: (key: string, on: boolean) => void;
  /** Списки лиц и групп флагов не несут: флаг хранится по ключу поля, а у
   * элементов списка ключи повторяются. */
  noFlags?: boolean;
  grid?: boolean;
}) {
  return (
    <div className={grid ? "grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]" : "space-y-3"}>
      {fields.map((field) => (
        <FieldRow
          key={field.key}
          field={field}
          value={values[field.key] ?? ""}
          onChange={(value) => onChange(field.key, value)}
          flagged={noFlags ? null : flags.includes(field.key)}
          onFlag={(on) => onFlag(field.key, on)}
        />
      ))}
    </div>
  );
}

function FieldRow({
  field,
  value,
  onChange,
  flagged,
  onFlag,
}: {
  field: GvoFieldSpec;
  value: string;
  onChange: (value: string) => void;
  flagged: boolean | null;
  onFlag: (on: boolean) => void;
}) {
  const id = useId();
  return (
    <div className={field.multiline ? "space-y-1 [grid-column:1/-1]" : "space-y-1"}>
      <label
        htmlFor={id}
        className="block text-[11.5px] font-bold text-[hsl(215.4_16.3%_36.9%)]"
      >
        {field.label}
      </label>
      {field.multiline ? (
        <Textarea
          id={id}
          rows={Math.min(field.rows, 8)}
          className="resize-y text-[12.5px] leading-relaxed"
          placeholder={field.hint}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div className="flex items-center gap-2">
          <Input
            id={id}
            className="h-[38px] text-[13px]"
            placeholder={field.placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          {flagged !== null && (
            <label className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={flagged}
                onChange={(e) => onFlag(e.target.checked)}
                aria-label={`Уточняется: ${field.label}`}
              />
              уточняется
            </label>
          )}
        </div>
      )}
      {field.multiline && field.hint !== "" && (
        <p className="text-[11px] text-muted-foreground">{field.hint}</p>
      )}
    </div>
  );
}
