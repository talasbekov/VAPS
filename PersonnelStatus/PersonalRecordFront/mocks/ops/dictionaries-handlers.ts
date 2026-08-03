// MSW-handlers «Справочники»: generic-реестр значений. Связи значений
// считает СЕРВЕР при чтении, поимённо по источникам: JOURNAL_ENTRY_TYPES —
// по журналам ОМ (хранят код типа), POST_REQUIREMENT_GROUPS — по groupCode
// записей POST_REQUIREMENTS. Неотслеживаемые справочники несут причину, а не
// ноль («удалять безопасно» было бы ложью). Удаление требует ДОКАЗАННОГО
// отсутствия связей: у NOT_TRACKED/UNKNOWN оно запрещено.
import { http, HttpResponse } from "msw";
import {
  dictionaryEntriesPath,
  dictionaryEntryPath,
  dictionaryEntrySetActivePath,
  DICTIONARIES_PATH,
} from "@/entities/dictionary";
import type {
  CreateDictionaryEntryRequest,
  DictionaryCode,
  DictionaryDefinition,
  DictionaryEntry,
  DictionaryEntryView,
  DictionaryUsage,
  SetDictionaryEntryActiveRequest,
} from "@/entities/dictionary";
import { JOURNAL_TYPE_LABEL } from "@/entities/security-event";
import type { JournalEntryType } from "@/entities/security-event";
import { readSecurityEventsStore } from "./security-events-handlers";
import { appendAudit } from "./audit-store";

const STORE_KEY = "ops-mock-dictionaries";

const DEFINITIONS: DictionaryDefinition[] = [
  {
    code: "JOURNAL_ENTRY_TYPES",
    label: "Типы записей журнала штаба",
    description: "Категории записей журнала стадии «Проведение» ОМ.",
  },
  {
    code: "RETURN_REASONS",
    label: "Причины возврата",
    description: "Типовые причины возврата расстановки на доработку.",
  },
  {
    code: "POST_REQUIREMENTS",
    label: "Требования к постам",
    description: "Типовые требования к назначению на пост.",
  },
  {
    code: "POST_REQUIREMENT_GROUPS",
    label: "Группы требований",
    description: "Категории, к которым относятся требования к постам.",
  },
  {
    code: "SEASONAL_CORRECTIONS",
    label: "Сезонные поправки",
    description: "Поправки к нормативам по сезону.",
  },
];

function nowIso(): string {
  return new Date().toISOString();
}

let seq = 0;
function entry(
  dictionaryCode: DictionaryCode,
  code: string,
  label: string,
  description = "",
  groupCode: string | null = null
): DictionaryEntry {
  seq += 1;
  return {
    id: `dict-${dictionaryCode}-${seq}`,
    dictionaryCode,
    code,
    label,
    description,
    isActive: true,
    groupCode,
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

function buildSeed(): DictionaryEntry[] {
  return [
    // коды журнала совпадают с моделью ОМ — по ним считаются связи
    entry("JOURNAL_ENTRY_TYPES", "INSTRUCTION", "Инструктаж"),
    entry("JOURNAL_ENTRY_TYPES", "ORDER", "Распоряжение"),
    entry("JOURNAL_ENTRY_TYPES", "INCIDENT", "Инцидент"),
    entry("JOURNAL_ENTRY_TYPES", "REPLACEMENT", "Замена"),
    entry("RETURN_REASONS", "UNDERSTAFFED", "Посты недоукомплектованы"),
    entry("RETURN_REASONS", "WRONG_REQUIREMENTS", "Не выдержаны требования"),
    entry("POST_REQUIREMENT_GROUPS", "ACCESS", "Допуски"),
    entry("POST_REQUIREMENT_GROUPS", "PHYSICAL", "Физические требования"),
    entry("POST_REQUIREMENTS", "ACCESS_A", "Допуск «Объект A»", "", "ACCESS"),
    entry("POST_REQUIREMENTS", "HEIGHT_175", "Рост от 175 см", "", "PHYSICAL"),
    entry("SEASONAL_CORRECTIONS", "WINTER", "Зимняя поправка"),
  ];
}

let entries: DictionaryEntry[] | null = null;

function getEntries(): DictionaryEntry[] {
  if (entries === null) {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      entries = raw === null ? buildSeed() : (JSON.parse(raw) as DictionaryEntry[]);
    } catch {
      entries = buildSeed();
    }
  }
  return entries;
}

function persist(): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(entries));
  } catch {
    // квота/приватный режим
  }
}

// ── Связи ────────────────────────────────────────────────────────────────

const NOT_TRACKED_REASON: Partial<Record<DictionaryCode, string>> = {
  RETURN_REASONS:
    "Возврат расстановки хранит свободный комментарий, а не код причины — связи отследить нельзя.",
  POST_REQUIREMENTS:
    "Паспорт объекта и расчёт ОМ хранят требования строкой, а не кодом — связи отследить нельзя.",
  SEASONAL_CORRECTIONS:
    "Поправки пока не читает ни один расчёт — потребителя кода в модели нет.",
};

function usageOf(item: DictionaryEntry): DictionaryUsage {
  if (item.dictionaryCode === "JOURNAL_ENTRY_TYPES") {
    const carriers: string[] = [];
    for (const event of readSecurityEventsStore()) {
      for (const journal of event.journalEntries) {
        if (journal.type === (item.code as JournalEntryType)) {
          carriers.push(`${event.code}: ${journal.title}`);
        }
      }
    }
    return {
      status: "TRACKED",
      reason: null,
      references:
        carriers.length === 0
          ? []
          : [
              {
                sourceLabel: `Журналы ОМ (${JOURNAL_TYPE_LABEL[item.code as JournalEntryType] ?? item.code})`,
                count: carriers.length,
                samples: carriers.slice(0, 3),
              },
            ],
      totalCount: carriers.length,
    };
  }
  if (item.dictionaryCode === "POST_REQUIREMENT_GROUPS") {
    const carriers = getEntries()
      .filter(
        (candidate) =>
          candidate.dictionaryCode === "POST_REQUIREMENTS" &&
          candidate.groupCode === item.code
      )
      .map((candidate) => candidate.label);
    return {
      status: "TRACKED",
      reason: null,
      references:
        carriers.length === 0
          ? []
          : [
              {
                sourceLabel: "Требования к постам",
                count: carriers.length,
                samples: carriers.slice(0, 3),
              },
            ],
      totalCount: carriers.length,
    };
  }
  return {
    status: "NOT_TRACKED",
    reason: NOT_TRACKED_REASON[item.dictionaryCode] ?? "Связи не отслеживаются.",
    references: [],
    totalCount: 0,
  };
}

function view(item: DictionaryEntry): DictionaryEntryView {
  return { ...item, usage: usageOf(item) };
}

function errorEnvelope(
  errorCode: string,
  message: string,
  details: Record<string, unknown>,
  status: number
) {
  return HttpResponse.json(
    {
      error_code: errorCode,
      message,
      details,
      request_id: null,
      timestamp: nowIso(),
    },
    { status }
  );
}

export const dictionariesHandlers = [
  http.get(`*${DICTIONARIES_PATH}`, () => {
    const all = getEntries();
    return HttpResponse.json({
      results: DEFINITIONS.map((definition) => {
        const own = all.filter((item) => item.dictionaryCode === definition.code);
        return {
          ...definition,
          totalCount: own.length,
          activeCount: own.filter((item) => item.isActive).length,
        };
      }),
    });
  }),

  http.get(`*${dictionaryEntriesPath(":code")}`, ({ params }) => {
    const code = params.code as DictionaryCode;
    if (!DEFINITIONS.some((definition) => definition.code === code)) {
      return errorEnvelope(
        "ENTITY_NOT_FOUND",
        "Справочник не найден.",
        { code },
        404
      );
    }
    return HttpResponse.json({
      results: getEntries()
        .filter((item) => item.dictionaryCode === code)
        .map(view),
    });
  }),

  http.post(`*${dictionaryEntriesPath(":code")}`, async ({ params, request }) => {
    const dictionaryCode = params.code as DictionaryCode;
    if (!DEFINITIONS.some((definition) => definition.code === dictionaryCode)) {
      return errorEnvelope(
        "ENTITY_NOT_FOUND",
        "Справочник не найден.",
        { code: dictionaryCode },
        404
      );
    }
    const body = (await request.json()) as CreateDictionaryEntryRequest;
    const fieldErrors: Record<string, string[]> = {};
    const code = body.code.trim().toUpperCase();
    if (code === "") fieldErrors.code = ["Обязательное поле."];
    if (body.label.trim() === "") fieldErrors.label = ["Обязательное поле."];
    if (
      getEntries().some(
        (item) => item.dictionaryCode === dictionaryCode && item.code === code
      )
    ) {
      fieldErrors.code = ["Код уже используется в этом справочнике."];
    }
    if (
      dictionaryCode === "POST_REQUIREMENTS" &&
      body.groupCode != null &&
      body.groupCode !== "" &&
      !getEntries().some(
        (item) =>
          item.dictionaryCode === "POST_REQUIREMENT_GROUPS" &&
          item.code === body.groupCode &&
          item.isActive
      )
    ) {
      fieldErrors.groupCode = ["Группа не найдена или неактивна."];
    }
    if (Object.keys(fieldErrors).length > 0) {
      return errorEnvelope(
        "VALIDATION_ERROR",
        "Проверьте заполнение формы.",
        fieldErrors,
        400
      );
    }
    seq += 1;
    const created: DictionaryEntry = {
      id: `dict-${dictionaryCode}-new-${Date.now()}-${seq}`,
      dictionaryCode,
      code,
      label: body.label.trim(),
      description: body.description.trim(),
      isActive: true,
      groupCode:
        dictionaryCode === "POST_REQUIREMENTS"
          ? (body.groupCode ?? null) || null
          : null,
      updatedAt: nowIso(),
    };
    entries = [...getEntries(), created];
    persist();
    appendAudit({
      action: "dictionary.entry.create",
      entityType: "DictionaryEntry",
      entityId: `${dictionaryCode}/${code}`,
      newValue: { label: created.label },
    });
    return HttpResponse.json(view(created), { status: 201 });
  }),

  http.post(
    `*${dictionaryEntrySetActivePath(":id")}`,
    async ({ params, request }) => {
      const id = params.id as string;
      const existing = getEntries().find((item) => item.id === id);
      if (existing === undefined) {
        return errorEnvelope(
          "ENTITY_NOT_FOUND",
          "Запись не найдена.",
          { id },
          404
        );
      }
      const body = (await request.json()) as SetDictionaryEntryActiveRequest;
      const updated: DictionaryEntry = {
        ...existing,
        isActive: body.isActive === true,
        updatedAt: nowIso(),
      };
      entries = getEntries().map((item) => (item.id === id ? updated : item));
      persist();
      appendAudit({
        action: updated.isActive
          ? "dictionary.entry.activate"
          : "dictionary.entry.deactivate",
        entityType: "DictionaryEntry",
        entityId: `${existing.dictionaryCode}/${existing.code}`,
        oldValue: { isActive: existing.isActive },
        newValue: { isActive: updated.isActive },
      });
      return HttpResponse.json(view(updated));
    }
  ),

  http.delete(`*${dictionaryEntryPath(":id")}`, ({ params }) => {
    const id = params.id as string;
    const existing = getEntries().find((item) => item.id === id);
    if (existing === undefined) {
      return errorEnvelope("ENTITY_NOT_FOUND", "Запись не найдена.", { id }, 404);
    }
    const usage = usageOf(existing);
    // удаление необратимо — требует ДОКАЗАННОГО отсутствия связей
    if (usage.status !== "TRACKED") {
      return errorEnvelope(
        "DICTIONARY_USAGE_UNKNOWN",
        usage.reason ??
          "Связи значения не отслеживаются — удаление запрещено, используйте деактивацию.",
        {},
        422
      );
    }
    if (usage.totalCount > 0) {
      return errorEnvelope(
        "DICTIONARY_ENTRY_IN_USE",
        `Значение используется (${usage.totalCount}): ${usage.references
          .map((ref) => `${ref.sourceLabel} — ${ref.samples.join(", ")}`)
          .join("; ")}.`,
        { usage: usage as unknown as Record<string, unknown> },
        409
      );
    }
    entries = getEntries().filter((item) => item.id !== id);
    persist();
    appendAudit({
      action: "dictionary.entry.delete",
      entityType: "DictionaryEntry",
      entityId: `${existing.dictionaryCode}/${existing.code}`,
      oldValue: { label: existing.label },
    });
    return new HttpResponse(null, { status: 204 });
  }),
];
