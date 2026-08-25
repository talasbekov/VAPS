// Разделы правки сводки: описание полей, текст формы из сводки и обратный
// разбор текста в патч.
//
// Списки правятся текстом со разделителем «|», а не построчными формами —
// это осознанная часть UX прототипа: сводку переносят из готового рабочего
// документа целыми блоками, и таблица с кнопкой «добавить строку» превращает
// одну вставку в полсотни кликов. Валидации нет: пустое поле сохраняется как
// «уточняется», а не блокирует сохранение.
import { UNSPECIFIED } from "./types";
import type {
  GvoFact,
  GvoGroup,
  GvoMember,
  GvoPerson,
  GvoSection,
  GvoSummary,
  GvoSummaryPatch,
  GvoTransportRow,
} from "./types";

export interface GvoFieldSpec {
  key: string;
  label: string;
  placeholder: string;
  /** Подсказка формата под полем; пустая — подсказки нет. */
  hint: string;
  multiline: boolean;
  rows: number;
}

export interface GvoSectionSpec {
  title: string;
  fields: GvoFieldSpec[];
}

export type GvoSectionForm = Record<string, string>;

function text(key: string, label: string, placeholder = ""): GvoFieldSpec {
  return { key, label, placeholder, hint: "", multiline: false, rows: 1 };
}

function area(
  key: string,
  label: string,
  hint: string,
  rows: number
): GvoFieldSpec {
  return { key, label, placeholder: "", hint, multiline: true, rows };
}

export function isPersonSection(section: GvoSection): boolean {
  return section.startsWith("person:");
}

export function isGroupSection(section: GvoSection): boolean {
  return section.startsWith("group:");
}

/** Индекс правимого элемента списка; null — раздел добавления. */
export function sectionIndex(section: GvoSection): number | null {
  const raw = section.split(":")[1];
  if (raw === undefined || raw === "new") return null;
  const index = Number(raw);
  return Number.isInteger(index) ? index : null;
}

const WHOLE_SECTION_SPECS: Record<string, GvoSectionSpec> = {
  head: { title: "Общие сведения", fields: [text("country", "Страна", "Черногория")] },
  persons: {
    title: "Охраняемые лица",
    fields: [
      area(
        "persons",
        "Список охраняемых лиц",
        "Блок на каждое лицо: первая строка «ФИО | должность», далее строки «параметр = значение». Блоки разделяйте пустой строкой.",
        14
      ),
    ],
  },
  arrival: {
    title: "Прибытие / тип борта",
    fields: [
      text("date", "Дата", "18.06.2026"),
      text("time", "Время", "19:55 ч."),
      text("route", "Маршрут", "гг. Подгорица — Астана"),
      text("flight", "Рейс", "а/к «Air Astana» KC 638"),
      text("dur", "Время в полёте", "время в полёте 5:40 часа"),
      area("meet", "Встречают", "Один человек — одна строка", 6),
    ],
  },
  departure: {
    title: "Убытие / тип борта",
    fields: [
      text("date", "Дата", "21.06.2026"),
      text("time", "Время", "06:00 ч."),
      text("route", "Маршрут", "гг. Астана — Подгорица"),
      text("flight", "Рейс", "а/к «Air Astana» KC 637"),
      text("dur", "Время в полёте", "время в полёте 6:30 часа"),
      area("farewell", "Провожают", "Один человек — одна строка", 6),
    ],
  },
  org: {
    title: "Организация",
    fields: [
      text("place", "Место проживания", "отель Hilton Astana, объект «Мейрам»"),
      text("room", "Номер проживания", "№ 1827"),
      text("sbChief", "Руководитель СБ"),
      text("weapons", "Вооружение"),
      text("obVariant", "Вариант ОБ", "трасса № 2, объекты № 1"),
      text("radio", "Канал р/связи", "В-1 / В-12 / С-12"),
      text("wishes", "Пожелания"),
      area("delegation", "Состав делегации", "Одна строка — одна группа прибытия", 5),
    ],
  },
  groups: {
    title: "Состав ГВО СГО РК",
    fields: [
      text("resp", "Ответственный", "Шитов | 2-9 | ответственный"),
      area(
        "groups",
        "Группы ГВО",
        "Блок на группу: первая строка — название группы, далее «Фамилия | позывной | роль». Блоки разделяйте пустой строкой.",
        14
      ),
    ],
  },
  resp: {
    title: "Ответственный за ГВО",
    fields: [text("resp", "Ответственный", "Шитов | 2-9 | ответственный")],
  },
  transport: {
    title: "Выделяемый транспорт",
    fields: [
      area(
        "transport",
        "Транспорт",
        "Одна строка — одна машина: «VIP | Mercedes-Benz Pullman S600 W222, 2019 г.в. | бронь, гостевой парк»",
        7
      ),
    ],
  },
};

// Раздела «Объекты посещения» здесь НЕТ («Реестр ОМ-35.1»): объекты живут
// таблицей мероприятия, а не свободным текстом патча, и правит их своё окно
// (features/gvo-section-edit/ui/GvoVisitsDialog) — по строке на объект, с
// днём и примечанием. Свободный текст вернул бы второй список объектов.

export function gvoSectionSpec(section: GvoSection): GvoSectionSpec {
  if (isGroupSection(section)) {
    return {
      title: section === "group:new" ? "Новая группа ГВО" : "Группа ГВО",
      fields: [
        text("name", "Название группы", "ГВО «Черногория»"),
        area(
          "members",
          "Состав группы",
          "Одна строка — один сотрудник: «Фамилия | позывной | роль»",
          12
        ),
      ],
    };
  }
  if (isPersonSection(section)) {
    return {
      title: section === "person:new" ? "Новое охраняемое лицо" : "Охраняемое лицо",
      fields: [
        text("name", "ФИО", "Яков Милатович"),
        text("role", "Должность", "Президент Черногории"),
        area(
          "facts",
          "Данные",
          "Одна строка — «параметр = значение», например «Группа крови = А (II) Rh +»",
          9
        ),
      ],
    };
  }
  return WHOLE_SECTION_SPECS[section];
}

// ── Сводка → текст формы ────────────────────────────────────────────────

/** «уточняется» в форму не подставляется: иначе литерал пришлось бы стирать руками. */
function clean(value: string): string {
  return value === UNSPECIFIED ? "" : value;
}

function memberLine(member: GvoMember): string {
  return `${clean(member.name)} | ${clean(member.callsign)} | ${clean(member.role)}`;
}

function factLines(facts: GvoFact[]): string[] {
  return facts
    .filter((fact) => clean(fact.value) !== "")
    .map((fact) => `${fact.key} = ${fact.value}`);
}

function personBlock(person: GvoPerson): string {
  return [`${clean(person.name)} | ${clean(person.role)}`, ...factLines(person.facts)].join(
    "\n"
  );
}

function groupBlock(group: GvoGroup): string {
  return [group.name, ...group.members.map(memberLine)].join("\n");
}

function respLine(member: GvoMember | null): string {
  return member === null ? "" : memberLine(member);
}

export function gvoFormFromSummary(
  section: GvoSection,
  summary: GvoSummary
): GvoSectionForm {
  if (isGroupSection(section)) {
    const index = sectionIndex(section);
    const group = index === null ? undefined : summary.groups[index];
    return {
      name: group?.name ?? "",
      members: (group?.members ?? []).map(memberLine).join("\n"),
    };
  }
  if (isPersonSection(section)) {
    const index = sectionIndex(section);
    const person = index === null ? undefined : summary.persons[index];
    return {
      name: clean(person?.name ?? ""),
      role: clean(person?.role ?? ""),
      facts: factLines(person?.facts ?? []).join("\n"),
    };
  }
  switch (section) {
    case "head":
      return { country: clean(summary.country) };
    case "persons":
      return { persons: summary.persons.map(personBlock).join("\n\n") };
    case "arrival":
      return {
        date: clean(summary.arrival.date),
        time: clean(summary.arrival.time),
        route: clean(summary.arrival.route),
        flight: clean(summary.arrival.flight),
        dur: clean(summary.arrival.dur),
        meet: summary.meet.join("\n"),
      };
    case "departure":
      return {
        date: clean(summary.departure.date),
        time: clean(summary.departure.time),
        route: clean(summary.departure.route),
        flight: clean(summary.departure.flight),
        dur: clean(summary.departure.dur),
        farewell: summary.farewell.join("\n"),
      };
    case "org":
      return {
        place: clean(summary.stay.place),
        room: clean(summary.stay.room),
        sbChief: clean(summary.sbChief),
        weapons: clean(summary.weapons),
        obVariant: clean(summary.obVariant),
        radio: clean(summary.radio),
        wishes: clean(summary.wishes),
        delegation: summary.delegation.join("\n"),
      };
    case "groups":
      return {
        resp: respLine(summary.responsible),
        groups: summary.groups.map(groupBlock).join("\n\n"),
      };
    case "resp":
      return { resp: respLine(summary.responsible) };
    case "transport":
      return {
        transport: summary.transport
          .map((row) => `${row.code} | ${row.car} | ${row.note}`)
          .join("\n"),
      };
    default:
      return {};
  }
}

// ── Текст формы → патч ──────────────────────────────────────────────────

/** Пустое поле — не «пусто», а «уточняется»: в сводке нет незаполненных мест. */
function filled(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? UNSPECIFIED : trimmed;
}

function lines(value: string | undefined): string[] {
  return (value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function blocks(value: string | undefined): string[][] {
  return (value ?? "")
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
    )
    .filter((block) => block.length > 0);
}

function parts(line: string): string[] {
  return line.split("|").map((part) => part.trim());
}

function parseMember(line: string): GvoMember {
  const [name, callsign, role] = parts(line);
  return {
    name: name ?? UNSPECIFIED,
    callsign: callsign === undefined || callsign === "" ? UNSPECIFIED : callsign,
    role: role === undefined || role === "" ? UNSPECIFIED : role,
  };
}

function parseResponsible(value: string | undefined): GvoMember | null {
  if ((value ?? "").trim() === "") return null;
  const [name, callsign, role] = parts(value ?? "");
  return {
    name: name ?? UNSPECIFIED,
    callsign: callsign === undefined || callsign === "" ? UNSPECIFIED : callsign,
    role: role === undefined || role === "" ? "ответственный" : role,
  };
}

function parseFacts(value: string | undefined): GvoFact[] {
  return lines(value).map((line) => {
    const at = line.indexOf("=");
    if (at < 0) return { key: line, value: UNSPECIFIED };
    return {
      key: line.slice(0, at).trim(),
      value: filled(line.slice(at + 1)),
    };
  });
}

function parseTransport(value: string | undefined): GvoTransportRow[] {
  return lines(value).map((line) => {
    const [code, car, note] = parts(line);
    return {
      code: code ?? UNSPECIFIED,
      car: car === undefined || car === "" ? UNSPECIFIED : car,
      note: note ?? "",
    };
  });
}

/**
 * Патч раздела. Для `person:<i>` / `group:<i>` возвращается ВЕСЬ список с
 * заменённым элементом: патч перекрывает базу целиком, и частичный список
 * молча потерял бы остальные элементы.
 */
export function gvoPatchFromForm(
  section: GvoSection,
  form: GvoSectionForm,
  summary: GvoSummary
): GvoSummaryPatch {
  if (isGroupSection(section)) {
    const group: GvoGroup = {
      name: (form.name ?? "").trim() === "" ? "ГВО (без названия)" : form.name.trim(),
      members: lines(form.members).map(parseMember),
    };
    const next = summary.groups.slice();
    const index = sectionIndex(section);
    if (index === null) next.push(group);
    else next[index] = group;
    return { groups: next };
  }
  if (isPersonSection(section)) {
    const facts = parseFacts(form.facts);
    const person: GvoPerson = {
      name: filled(form.name),
      role: filled(form.role),
      facts:
        facts.length > 0
          ? facts
          : [{ key: "Антропометрические данные", value: UNSPECIFIED }],
    };
    const next = summary.persons.slice();
    const index = sectionIndex(section);
    if (index === null) next.push(person);
    else next[index] = person;
    return { persons: next };
  }
  switch (section) {
    case "head":
      return { country: filled(form.country) };
    case "persons":
      return {
        persons: blocks(form.persons).map((block) => {
          const [name, role] = parts(block[0]);
          return {
            name: name ?? UNSPECIFIED,
            role: role === undefined || role === "" ? UNSPECIFIED : role,
            facts: parseFacts(block.slice(1).join("\n")),
          };
        }),
      };
    case "arrival":
      return {
        arrival: {
          date: filled(form.date),
          time: filled(form.time),
          route: filled(form.route),
          flight: filled(form.flight),
          dur: filled(form.dur),
        },
        meet: lines(form.meet),
      };
    case "departure":
      return {
        departure: {
          date: filled(form.date),
          time: filled(form.time),
          route: filled(form.route),
          flight: filled(form.flight),
          dur: filled(form.dur),
        },
        farewell: lines(form.farewell),
      };
    case "org":
      return {
        stay: { place: filled(form.place), room: filled(form.room) },
        sbChief: filled(form.sbChief),
        weapons: filled(form.weapons),
        obVariant: filled(form.obVariant),
        radio: filled(form.radio),
        wishes: filled(form.wishes),
        delegation: lines(form.delegation),
      };
    case "groups":
      return {
        responsible: parseResponsible(form.resp),
        groups: blocks(form.groups).map((block) => ({
          name: block[0],
          members: block.slice(1).map(parseMember),
        })),
      };
    case "resp":
      return { responsible: parseResponsible(form.resp) };
    case "transport":
      return { transport: parseTransport(form.transport) };
    default:
      return {};
  }
}

/**
 * Ключи патча, которые снимает «Вернуть исходные». Совпадают с ключами,
 * которые кладёт gvoPatchFromForm того же раздела.
 */
export function gvoSectionPatchKeys(
  section: GvoSection
): (keyof GvoSummaryPatch)[] {
  if (isGroupSection(section)) return ["groups"];
  if (isPersonSection(section)) return ["persons"];
  switch (section) {
    case "head":
      return ["country"];
    case "persons":
      return ["persons"];
    case "arrival":
      return ["arrival", "meet"];
    case "departure":
      return ["departure", "farewell"];
    case "org":
      return ["stay", "sbChief", "weapons", "obVariant", "radio", "wishes", "delegation"];
    case "groups":
      return ["responsible", "groups"];
    case "resp":
      return ["responsible"];
    case "transport":
      return ["transport"];
    default:
      return [];
  }
}
