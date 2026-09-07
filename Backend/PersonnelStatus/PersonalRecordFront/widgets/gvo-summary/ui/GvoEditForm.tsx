"use client";

// Единый режим правки сводных данных ГВО (`[ГВО-05]`, Plane №441): одна
// кнопка «Редактировать» на страницу → все поля инпутами → «Сохранить /
// Отмена». Отдельных окон и кнопок «Изменить» по блокам больше нет.
//
// Разделы остаются разделами КОНТРАКТА: сервер принимает патч по ключам
// разделов, поэтому «Сохранить» собирает по патчу на каждый раздел, в котором
// что-то изменилось, и шлёт их одним запросом (№694). Разбор текста в патч —
// `gvoPatchFromForm`, как и у прежних окон.
//
// СПРАВОЧНИКИ, А НЕ ТЕКСТ (Plane №951, задача заказчика). Состав ГВО
// набирается из кадрового списка (`GvoMemberPickerDialog`): участник несёт
// `employeeId`, фамилию и позывной по нему подставляет сервер. Охраняемое лицо
// — из справочника лиц (`ProtectedPersonPickDialog`, там же заводится новое):
// карточка несёт `personId`, код и снимок. Машины — из реестра ГОН
// (`AllocateVehicleDialog`), как в режиме просмотра. Строки, набранные
// текстом до этой задачи, остаются редактируемыми как были.
import { useEffect, useId, useRef, useState } from "react";
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
  GvoGroup,
  GvoMember,
  GvoPerson,
  GvoSection,
  GvoSectionForm,
  GvoSummary,
  GvoSummaryPatch,
} from "@/entities/gvo-summary";
import type { SecurityEvent } from "@/entities/security-event";
import { useResetGvoSection, useSaveGvoSection } from "@/hooks/use-gvo-summaries";
import { useUploadProtectedPersonPhoto } from "@/hooks/use-protected-persons";
import { GvoMemberPickerDialog, ProtectedPersonPickDialog } from "@/features/gvo-section-edit";
import { AllocateVehicleDialog } from "@/features/event-vehicles";
import { mediaSrc } from "@/shared/lib/media";
import { RegistryVehicles } from "./RegistryVehicles";

// ОТВЕТСТВЕННЫЙ И СТАРШИЙ ГВО — ИЗ КАДРОВ (Plane №952, задача заказчика).
// «Нет возможности назначить старшего ГВО … после ответственного за ГВО
// сделать старший ГВО, и обе должны выбираться со списка сотрудников с
// поиском в боксе Состав ГВО». Оба — `MemberField`: подпись, выбранный
// человек и кнопки «Выбрать из списка / Заменить / Убрать»; окно выбора — то
// же, что у состава группы, с заданной ролью. Текстовое поле «Транспорт» в
// блоке «Выделяемый транспорт» снято по тому же слову заказчика: машины
// выделяются из реестра. Страна подтягивается из карточки выбранного лица.

/** Разделы, которые правятся целиком — в порядке печатного документа.
 * `resp` и `transport` здесь больше нет (Plane №952): люди правятся выбором,
 * транспорт — реестром. */
const WHOLE_SECTIONS: GvoSection[] = ["head", "arrival", "departure", "org"];

/** Лицо в форме: текстовые поля прежнего разбора плюс ссылка на справочник. */
interface PersonDraft {
  form: GvoSectionForm;
  personId: string | null;
  code: string;
  photoUrl: string | null;
}

/** Группа в форме: участники — строками, а не текстом (Plane №951). */
interface GroupDraft {
  name: string;
  members: GvoMember[];
}

interface Draft {
  whole: Record<string, GvoSectionForm>;
  persons: PersonDraft[];
  groups: GroupDraft[];
  /** Ответственный за ГВО и старший ГВО (Plane №952) — людьми, не текстом. */
  responsible: GvoMember | null;
  senior: GvoMember | null;
  flags: string[];
}

function memberDraft(member: GvoMember | null | undefined): GvoMember | null {
  if (member === null || member === undefined) return null;
  const clean = (value: string) => (value === "уточняется" ? "" : value);
  return {
    ...member,
    name: clean(member.name),
    callsign: clean(member.callsign),
    role: clean(member.role),
  };
}

function personDraft(person: GvoPerson, form: GvoSectionForm): PersonDraft {
  return {
    form,
    personId: person.personId ?? null,
    code: person.code ?? "",
    photoUrl: person.photoUrl ?? null,
  };
}

function draftOf(summary: GvoSummary, unspecified: string[]): Draft {
  return {
    whole: Object.fromEntries(
      WHOLE_SECTIONS.map((section) => [section, gvoFormFromSummary(section, summary)])
    ),
    persons: summary.persons.map((person, index) =>
      personDraft(person, gvoFormFromSummary(`person:${index}` as GvoSection, summary))
    ),
    groups: summary.groups.map((group) => ({
      name: group.name,
      members: group.members.map((member) => ({ ...member })),
    })),
    responsible: memberDraft(summary.responsible),
    senior: memberDraft(summary.senior),
    flags: [...unspecified].sort(),
  };
}

function memberPatch(member: GvoMember | null, defaultRole: string): GvoMember | null {
  if (member === null || member.name.trim() === "") return null;
  return {
    name: member.name.trim(),
    callsign: member.callsign.trim(),
    role: member.role.trim() === "" ? defaultRole : member.role.trim(),
    ...(member.employeeId ? { employeeId: member.employeeId } : {}),
  };
}

function groupPatch(group: GroupDraft): GvoGroup {
  return {
    name: group.name.trim() === "" ? "ГВО (без названия)" : group.name.trim(),
    members: group.members.map((member) => ({
      name: member.name.trim(),
      callsign: member.callsign.trim(),
      role: member.role.trim(),
      ...(member.employeeId ? { employeeId: member.employeeId } : {}),
    })),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface GvoEditFormProps {
  omCode: string;
  /** Мероприятие — ради машин реестра (Plane №951): их выделяют и снимают
   * прямо из формы, отдельными запросами, а не патчем сводки. */
  event: SecurityEvent;
  summary: GvoSummary;
  unspecified: string[];
  /** Сообщить наружу, что набранное ещё не сохранено (Plane №693). */
  onDirtyChange?: (dirty: boolean) => void;
  onDone: () => void;
}

export function GvoEditForm({
  omCode,
  event,
  summary,
  unspecified,
  onDirtyChange,
  onDone,
}: GvoEditFormProps) {
  const { toast } = useToast();
  const [initial] = useState(() => draftOf(summary, unspecified));
  const [draft, setDraft] = useState<Draft>(initial);
  const save = useSaveGvoSection();
  const reset = useResetGvoSection();
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  // Несохранённое — ВЫВОД из черновика, а не отдельный флаг: отдельный
  // пришлось бы ставить в каждом из шести обработчиков правки, и первый же
  // забытый врал бы про сохранённость (Plane №693).
  const dirty =
    !same(draft.whole, initial.whole) ||
    !same(draft.persons, initial.persons) ||
    !same(draft.groups, initial.groups) ||
    !same(draft.responsible, initial.responsible) ||
    !same(draft.senior, initial.senior) ||
    !same(draft.flags, initial.flags);
  useEffect(() => {
    onDirtyChange?.(dirty);
    // Форма уходит с экрана — метка обязана погаснуть вместе с ней.
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  const [failure, setFailure] = useState<string | null>(null);
  const pending = busy !== null;

  const setWhole = (section: string, key: string, value: string) =>
    setDraft((prev) => ({
      ...prev,
      whole: { ...prev.whole, [section]: { ...prev.whole[section], [key]: value } },
    }));
  const setPersonField = (index: number, key: string, value: string) =>
    setDraft((prev) => ({
      ...prev,
      persons: prev.persons.map((item, i) =>
        i === index ? { ...item, form: { ...item.form, [key]: value } } : item
      ),
    }));
  const setPersonPhoto = (index: number, photoUrl: string | null) =>
    setDraft((prev) => ({
      ...prev,
      persons: prev.persons.map((item, i) => (i === index ? { ...item, photoUrl } : item)),
    }));
  const addPerson = (person: PersonDraft) =>
    setDraft((prev) => ({ ...prev, persons: [...prev.persons, person] }));
  const removePerson = (index: number) =>
    setDraft((prev) => ({ ...prev, persons: prev.persons.filter((_, i) => i !== index) }));
  const setGroupName = (index: number, name: string) =>
    setDraft((prev) => ({
      ...prev,
      groups: prev.groups.map((group, i) => (i === index ? { ...group, name } : group)),
    }));
  const addGroup = () =>
    setDraft((prev) => ({ ...prev, groups: [...prev.groups, { name: "", members: [] }] }));
  const removeGroup = (index: number) =>
    setDraft((prev) => ({ ...prev, groups: prev.groups.filter((_, i) => i !== index) }));
  const setMember = (groupIndex: number, memberIndex: number, patch: Partial<GvoMember>) =>
    setDraft((prev) => ({
      ...prev,
      groups: prev.groups.map((group, g) =>
        g === groupIndex
          ? {
              ...group,
              members: group.members.map((member, m) =>
                m === memberIndex ? { ...member, ...patch } : member
              ),
            }
          : group
      ),
    }));
  const addMember = (groupIndex: number, member: GvoMember) =>
    setDraft((prev) => ({
      ...prev,
      groups: prev.groups.map((group, g) =>
        g === groupIndex ? { ...group, members: [...group.members, member] } : group
      ),
    }));
  const removeMember = (groupIndex: number, memberIndex: number) =>
    setDraft((prev) => ({
      ...prev,
      groups: prev.groups.map((group, g) =>
        g === groupIndex
          ? { ...group, members: group.members.filter((_, m) => m !== memberIndex) }
          : group
      ),
    }));
  // Окна справочников: какой группе подбирается сотрудник; открыт ли выбор
  // лица; открыт ли реестр машин.
  const [memberPickerFor, setMemberPickerFor] = useState<number | null>(null);
  // Кому подбирается человек из кадров (Plane №952): ответственному или старшему.
  const [rolePickerFor, setRolePickerFor] = useState<"responsible" | "senior" | null>(null);
  const [personPickerOpen, setPersonPickerOpen] = useState(false);
  const [vehiclesOpen, setVehiclesOpen] = useState(false);
  const takenEmployeeIds = new Set(
    draft.groups.flatMap((group) =>
      group.members.map((member) => member.employeeId ?? "").filter((id) => id !== "")
    )
  );
  const takenPersonIds = new Set(
    draft.persons.map((person) => person.personId ?? "").filter((id) => id !== "")
  );
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
          persons: draft.persons
            .map((person) => {
              const parsed = gvoPatchFromForm("person:new", person.form, empty).persons?.[0];
              if (parsed === undefined) return undefined;
              // Ссылка на справочник едет с лицом (Plane №951): по ней сервер
              // подставит код и снимок; снимок сам в патч не пишется.
              return person.personId === null
                ? parsed
                : { ...parsed, personId: person.personId };
            })
            .filter((person): person is GvoPerson => person !== undefined),
        },
      });
    }
    if (!same(draft.groups, initial.groups)) {
      calls.push({
        section: "groups",
        values: { groups: draft.groups.map(groupPatch) },
      });
    }
    // Люди — своим разделом (Plane №952): сервер узнаёт `resp` и знает, что
    // старший с `employeeId` переписывает старшего мероприятия.
    const people: GvoSummaryPatch = {};
    if (!same(draft.responsible, initial.responsible)) {
      people.responsible = memberPatch(draft.responsible, "ответственный");
    }
    if (!same(draft.senior, initial.senior)) {
      people.senior = memberPatch(draft.senior, "старший ГВО");
    }
    if (Object.keys(people).length > 0) calls.push({ section: "resp", values: people });
    return calls;
  }

  /**
   * Сохранить правку ОДНИМ запросом (Plane №694).
   *
   * 🔴 ЗДЕСЬ БЫЛ ЦИКЛ, и он делил сохранение на части. По одному PATCH на
   * изменённый раздел: патч «шапки» прошёл, патч «групп» ответил 422 — и
   * человек видел «Не удалось сохранить, попробуйте ещё раз», хотя смена
   * страны УЖЕ сохранена, а флаги «уточняется», ехавшие с последним вызовом,
   * — нет. Снимок `initial` при этом не обновлялся: то, что на экране,
   * серверу больше не соответствовало, и повтор слал бы «шапку» второй раз.
   *
   * Раздельные вызовы были не нужны изначально: сервер раздел только
   * проверяет, а тело бьёт по списку разрешённых ключей — значит все
   * изменённые ключи уезжают вместе и ложатся одним `save`. «Ещё раз» после
   * отказа теперь значит ровно то, что написано: не сохранилось НИЧЕГО.
   */
  async function submit(): Promise<void> {
    const calls = changedPatches();
    const flagsChanged = !same(draft.flags, initial.flags);
    if (calls.length === 0 && !flagsChanged) {
      onDone();
      return;
    }
    const values: GvoSummaryPatch = {};
    for (const call of calls) Object.assign(values, call.values);
    setBusy("save");
    setFailure(null);
    try {
      await save.mutateAsync({
        omCode,
        // Раздел не называется: их несколько, и сервер об этом знает.
        section: null,
        values,
        unspecified: draft.flags,
      });
      toast({ description: "Сводные данные обновлены" });
      onDone();
    } catch {
      setFailure("Не удалось сохранить сводные данные. Попробуйте ещё раз.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Вернуть исходные ОДНИМ запросом (Plane №765).
   *
   * 🔴 ЗДЕСЬ БЫЛ ЦИКЛ — тот же дефект, что у «Сохранить» (№694), но у другой
   * кнопки. По одному POST на раздел: «шапка» вернулась, «группы» ответили
   * отказом — и человек читал «Не удалось вернуть исходные данные»,
   * стоя над сводкой, половина которой УЖЕ вернулась к исходной. Состояние
   * между двумя нажатиями не описывал никто, и снимок формы ему не отвечал.
   *
   * Раздельные вызовы были не нужны: сервер принимает отсутствие раздела как
   * «вся сводка» и снимает ключи одним `save`. «Ещё раз» после отказа теперь
   * значит ровно то, что написано: не вернулось НИЧЕГО.
   */
  async function resetAll(): Promise<void> {
    setBusy("reset");
    setFailure(null);
    try {
      // Раздел не называется: их несколько, и сервер об этом знает.
      await reset.mutateAsync({ omCode, section: null });
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
          <>
            {/* ФЛАГ НА БЛОК, А НЕ НА ПОЛЕ (Plane №687). «Охраняемые лица» —
                обязательное поле сводки (`REQUIRED_VISIT_FIELDS`), но правится
                оно СПИСКОМ карточек, и своего однострочного поля, к которому
                можно приткнуть галочку, у него нет. */}
            <FlagBox
              label="Охраняемые лица"
              checked={draft.flags.includes("persons")}
              onChange={(on) => setFlag("persons", on)}
            />
            {/* Лицо — ИЗ СПРАВОЧНИКА (Plane №951): окно выбирает запись
                каталога или заводит новую там же. Текстом лицо больше не
                добавляется — иначе снова родилась бы карточка без кода и
                снимка. Набранные раньше остаются редактируемыми. */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-[30px]"
              onClick={() => setPersonPickerOpen(true)}
            >
              ＋ Лицо из справочника
            </Button>
          </>
        }
      >
        {draft.persons.length === 0 ? (
          <p className="text-xs text-muted-foreground">Лиц нет — выберите первое из справочника.</p>
        ) : (
          <div className="space-y-3">
            {draft.persons.map((person, index) => (
              <fieldset key={`${person.personId ?? "text"}-${index}`} className="space-y-2 rounded-[12px] border p-3" data-slot="gvo-person">
                <legend className="px-1 text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  Лицо {index + 1}
                  {person.code !== "" ? ` · ${person.code}` : ""}
                </legend>
                {person.personId !== null && (
                  <PersonHead
                    personId={person.personId}
                    name={person.form.name ?? ""}
                    photoUrl={person.photoUrl}
                    onPhoto={(url) => setPersonPhoto(index, url)}
                  />
                )}
                <Fields
                  // У лица из справочника ФИО — из записи, здесь не правится.
                  fields={spec("person:new").fields.filter(
                    (field) => person.personId === null || field.key !== "name"
                  )}
                  values={person.form}
                  onChange={(key, value) => setPersonField(index, key, value)}
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
                  onClick={() => removePerson(index)}
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
          <Button type="button" variant="outline" size="sm" className="h-[30px]" onClick={addGroup}>
            ＋ Группа
          </Button>
        }
      >
        {/* Ответственный и старший ГВО — ВЫБОРОМ ИЗ КАДРОВ, а не строкой
            «Фамилия | позывной | роль» (Plane №952). Оба обязательны для
            утверждения (`REQUIRED_VISIT_FIELDS`), поэтому у каждого — своя
            галочка «уточняется» по ПУТИ поля (№687). */}
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
          <MemberField
            label="Ответственный за ГВО"
            member={draft.responsible}
            flagged={draft.flags.includes("responsible")}
            onFlag={(on) => setFlag("responsible", on)}
            onPick={() => setRolePickerFor("responsible")}
            onClear={() => setDraft((prev) => ({ ...prev, responsible: null }))}
          />
          <MemberField
            label="Старший ГВО"
            member={draft.senior}
            flagged={draft.flags.includes("senior")}
            onFlag={(on) => setFlag("senior", on)}
            onPick={() => setRolePickerFor("senior")}
            onClear={() => setDraft((prev) => ({ ...prev, senior: null }))}
          />
        </div>
        {draft.groups.length > 0 && (
          <div className="mt-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(330px,1fr))]">
            {draft.groups.map((group, groupIndex) => (
              <fieldset key={groupIndex} className="space-y-2 rounded-[12px] border p-3" data-slot="gvo-group">
                <legend className="px-1 text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  Группа {groupIndex + 1}
                </legend>
                <div className="space-y-1">
                  <label
                    htmlFor={`gvo-group-name-${groupIndex}`}
                    className="block text-[11.5px] font-bold text-[hsl(215.4_16.3%_36.9%)]"
                  >
                    Название группы
                  </label>
                  <Input
                    id={`gvo-group-name-${groupIndex}`}
                    className="h-[38px] text-[13px]"
                    placeholder="ГВО «Черногория»"
                    value={group.name}
                    onChange={(e) => setGroupName(groupIndex, e.target.value)}
                  />
                </div>
                {/* Состав — СТРОКАМИ ИЗ КАДРОВ (Plane №951), а не текстом
                    «Фамилия | позывной | роль»: у участника из списка фамилия
                    и позывной — из записи и здесь не правятся, роль — своя.
                    Строка, набранная текстом раньше, остаётся с тремя полями. */}
                <div className="space-y-1">
                  <p className="text-[11.5px] font-bold text-[hsl(215.4_16.3%_36.9%)]">Состав группы</p>
                  {group.members.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Состав не назначен.</p>
                  ) : (
                    <ul className="space-y-1.5" data-slot="gvo-members">
                      {group.members.map((member, memberIndex) => (
                        <li key={`${member.employeeId ?? "text"}-${memberIndex}`} className="flex flex-wrap items-center gap-1.5">
                          {member.employeeId ? (
                            <span className="min-w-0 flex-1 text-[12.5px]">
                              <span className="font-semibold">{member.name}</span>
                              {member.callsign !== "" && (
                                <span className="tabular-nums text-muted-foreground"> · {member.callsign}</span>
                              )}
                              <span className="text-[11px] text-muted-foreground"> · из кадров</span>
                            </span>
                          ) : (
                            <>
                              <Input
                                className="h-9 w-[9.5rem] text-[12.5px]"
                                aria-label={`Фамилия, участник ${memberIndex + 1} группы ${groupIndex + 1}`}
                                placeholder="Фамилия"
                                value={member.name}
                                onChange={(e) => setMember(groupIndex, memberIndex, { name: e.target.value })}
                              />
                              <Input
                                className="h-9 w-[5.5rem] text-[12.5px]"
                                aria-label={`Позывной, участник ${memberIndex + 1} группы ${groupIndex + 1}`}
                                placeholder="позывной"
                                value={member.callsign}
                                onChange={(e) => setMember(groupIndex, memberIndex, { callsign: e.target.value })}
                              />
                            </>
                          )}
                          <Input
                            className="h-9 w-[10rem] text-[12.5px]"
                            aria-label={`Роль, участник ${memberIndex + 1} группы ${groupIndex + 1}`}
                            placeholder="роль"
                            value={member.role}
                            onChange={(e) => setMember(groupIndex, memberIndex, { role: e.target.value })}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-9 px-2 text-[11.5px] text-red-700"
                            aria-label={`Убрать участника ${memberIndex + 1} из группы ${groupIndex + 1}`}
                            onClick={() => removeMember(groupIndex, memberIndex)}
                          >
                            Убрать
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-[30px]"
                    onClick={() => setMemberPickerFor(groupIndex)}
                  >
                    ＋ Сотрудник из списка
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-red-200 text-red-700 hover:bg-red-50"
                    aria-label={`Удалить группу ${groupIndex + 1}`}
                    onClick={() => removeGroup(groupIndex)}
                  >
                    Удалить группу
                  </Button>
                </div>
              </fieldset>
            ))}
          </div>
        )}
      </Block>

      <Block
        title={spec("transport").title}
        action={
          // Машина ИЗ РЕЕСТРА выделяется и в форме правки (Plane №951): до
          // этого кнопка жила только в просмотре, и в форме человек видел
          // один свободный текст. Выделение — свой запрос, не патч сводки.
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-[30px] text-[12px]"
            onClick={() => setVehiclesOpen(true)}
          >
            + Машина из реестра
          </Button>
        }
      >
        {/* Текстового поля «Транспорт» здесь больше нет (Plane №952): машины
            выделяются из реестра. Строки, набранные текстом до этого,
            показываются как есть — их печатает документ, и молча терять их
            нельзя; правятся они снятием через «Вернуть исходные». */}
        <RegistryVehicles event={event} canEdit />
        {summary.transport.length > 0 && (
          <ul className="mt-3 space-y-1 text-[12.5px]" data-slot="gvo-transport-text">
            {summary.transport.map((row, index) => (
              <li key={`${row.code}-${index}`} className="text-muted-foreground">
                <span className="font-semibold text-foreground">{row.code}</span> · {row.car}
                {row.note !== "" && ` · ${row.note}`}
                <span className="text-[11px]"> · набрано текстом ранее</span>
              </li>
            ))}
          </ul>
        )}
        {event.vehicles.length === 0 && summary.transport.length === 0 && (
          <p className="text-xs text-muted-foreground">Транспорт не выделен — выберите машину из реестра.</p>
        )}
      </Block>

      <GvoMemberPickerDialog
        open={memberPickerFor !== null}
        groupName={memberPickerFor === null ? "" : (draft.groups[memberPickerFor]?.name ?? "")}
        takenIds={takenEmployeeIds}
        onPick={(member) => {
          if (memberPickerFor !== null) addMember(memberPickerFor, member);
        }}
        onClose={() => setMemberPickerFor(null)}
      />
      <GvoMemberPickerDialog
        open={rolePickerFor !== null}
        groupName=""
        title={rolePickerFor === "senior" ? "Старший ГВО из списка сотрудников" : "Ответственный за ГВО из списка сотрудников"}
        fixedRole={rolePickerFor === "senior" ? "старший ГВО" : "ответственный"}
        takenIds={new Set<string>()}
        onPick={(member) => {
          if (rolePickerFor === null) return;
          setDraft((prev) => ({ ...prev, [rolePickerFor]: member }));
        }}
        onClose={() => setRolePickerFor(null)}
      />
      <ProtectedPersonPickDialog
        open={personPickerOpen}
        takenIds={takenPersonIds}
        onPick={(person) => {
          // Должность и данные — из записи справочника (Plane №952): образец
          // заказчика печатает их у лица, и набирать их заново незачем.
          // Остаются правимыми: у ЭТОГО визита должность может звучать иначе.
          addPerson({
            form: {
              name: person.name,
              role: person.position,
              facts: person.facts.map((fact) => `${fact.key} = ${fact.value}`).join("\n"),
            },
            personId: person.id,
            code: person.code,
            photoUrl: person.photoUrl,
          });
          // Страна подтягивается из карточки лица (Plane №952): «если выбрал
          // ОЛ со справочника, тогда страна автоматически должна
          // подтянуться». Только в ПУСТОЕ поле: вписанную руками страну
          // второе лицо (супруга, член делегации) перетирать не должно.
          if (person.country !== "" && (draft.whole.head?.country ?? "").trim() === "") {
            setWhole("head", "country", person.country);
          }
        }}
        onClose={() => setPersonPickerOpen(false)}
      />
      <AllocateVehicleDialog event={event} open={vehiclesOpen} onClose={() => setVehiclesOpen(false)} />
    </form>
  );
}

/** Шапка лица из справочника: снимок и его загрузка (Plane №951). Загрузка
 * идёт СРАЗУ, отдельным запросом: снимок принадлежит записи справочника, а не
 * черновику сводки, и терять его вместе с «Отменой» было бы неправильно. */
function PersonHead({
  personId,
  name,
  photoUrl,
  onPhoto,
}: {
  personId: string;
  name: string;
  photoUrl: string | null;
  onPhoto: (url: string | null) => void;
}) {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useUploadProtectedPersonPhoto();
  const { toast } = useToast();
  const src = mediaSrc(photoUrl);
  return (
    <div className="flex flex-wrap items-center gap-3" data-slot="gvo-person-head">
      {src === null ? (
        <span className="flex h-[72px] w-[56px] items-center justify-center rounded-[8px] bg-muted text-[10px] text-muted-foreground">
          нет фото
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={`Фото: ${name}`} className="h-[72px] w-[56px] rounded-[8px] object-cover" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">{name}</p>
        <p className="text-[11px] text-muted-foreground">из справочника «Охраняемые лица»</p>
      </div>
      <input
        id={id}
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file === undefined) return;
          upload.mutate(
            { id: personId, file },
            {
              onSuccess: (person) => {
                onPhoto(person.photoUrl);
                toast({ description: "Снимок загружен" });
              },
              onError: (error) =>
                toast({
                  title: "Снимок не загружен",
                  description: error.message === "" ? "Попробуйте ещё раз." : error.message,
                  variant: "destructive",
                }),
            }
          );
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-[30px]"
        disabled={upload.isPending}
        onClick={() => fileRef.current?.click()}
      >
        {upload.isPending ? "Загрузка…" : src === null ? "Загрузить фото" : "Заменить фото"}
      </Button>
    </div>
  );
}

/** Человек из кадров у одной подписи (Plane №952): ответственный за ГВО,
 * старший ГВО. Кнопки — с текстом, не иконками; цель ≥ 30px по высоте в
 * плотной форме, подпись поля видима всегда. Человек, набранный текстом до
 * этой задачи, показывается как есть с пометкой — заменить его можно только
 * выбором из списка. */
function MemberField({
  label,
  member,
  flagged,
  onFlag,
  onPick,
  onClear,
}: {
  label: string;
  member: GvoMember | null;
  flagged: boolean;
  onFlag: (on: boolean) => void;
  onPick: () => void;
  onClear: () => void;
}) {
  const empty = member === null || member.name.trim() === "";
  return (
    <div className="space-y-1" data-slot="gvo-member-field" aria-label={label}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11.5px] font-bold text-[hsl(215.4_16.3%_36.9%)]">{label}</p>
        <FlagBox label={label} checked={flagged} onChange={onFlag} />
      </div>
      <div className="flex min-h-[38px] flex-wrap items-center gap-2 rounded-lg border bg-background px-3 py-1.5">
        {empty ? (
          <span className="flex-1 text-[12.5px] text-muted-foreground">Не назначен</span>
        ) : (
          <span className="min-w-0 flex-1 text-[12.5px]">
            <span className="font-semibold">{member.name}</span>
            {member.callsign !== "" && (
              <span className="tabular-nums text-muted-foreground"> · {member.callsign}</span>
            )}
            <span className="text-[11px] text-muted-foreground">
              {member.employeeId ? " · из кадров" : " · набран текстом"}
            </span>
          </span>
        )}
        <Button type="button" variant="outline" size="sm" className="h-[30px]" onClick={onPick}>
          {empty ? "Выбрать из списка" : "Заменить"}
        </Button>
        {!empty && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-[30px] px-2 text-[11.5px] text-red-700"
            aria-label={`Убрать: ${label}`}
            onClick={onClear}
          >
            Убрать
          </Button>
        )}
      </div>
    </div>
  );
}

/** Галочка «уточняется» для того, у чего своего поля нет: список правится
 * карточками, а флаг у него ОДИН на весь блок (Plane №687). Подпись поля идёт
 * в `aria-label` — рядом с галочкой стоит только слово «уточняется», и без
 * привязки читалка объявила бы её безымянной. */
function FlagBox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
      <input
        type="checkbox"
        className="h-3.5 w-3.5"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={`Уточняется: ${label}`}
      />
      уточняется
    </label>
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
  /**
   * Списки лиц и групп флагов не несут: флаг хранится по ПУТИ поля, а у
   * элементов списка своего пути нет — голые `name`/`role` общие у всех лиц
   * и всех групп сразу.
   *
   * Ставится ли галочка, решает теперь и само поле — `field.flaggable`
   * (Plane №518): галочка стоит там, где флаг кто-то читает. `noFlags`
   * остаётся как выключатель на весь блок, но правило поля сильнее.
   */
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
          // ФЛАГ ПО ПУТЮ, А НЕ ПО ИМЕНИ В ФОРМЕ (Plane №686/№687). Имя поля
          // не единственно на весь документ: «Прибытие» и «Убытие» оба зовут
          // своё поле `date`, и по имени галочка ставилась сразу в обоих.
          // Сервер же читает флаги как ПУТИ в сводке — по имени он не узнавал
          // ни одного, кроме `country`.
          flagged={
            noFlags || !field.flaggable ? null : flags.includes(field.path)
          }
          onFlag={(on) => onFlag(field.path, on)}
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
