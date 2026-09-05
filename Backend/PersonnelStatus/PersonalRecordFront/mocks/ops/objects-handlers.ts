// MSW-handlers «Объекты и паспорта»: серверная логика мок-слоя — валидация,
// свежесть и KPI считаются ЗДЕСЬ (на «сервере»), страница получает готовое.
// Стор — in-memory на время жизни документа (сброс перезагрузкой страницы).
import { http, HttpResponse } from "msw";
import {
  buildObjectsKpi,
  resolveFreshness,
  OPS_OBJECTS_PATH,
  objectDetailPath,
  objectPassportPath,
  objectPassportVersionsPath,
} from "@/entities/security-object";
import { readEventsStore } from "./security-events-handlers";
import type {
  ListObjectsResponse,
  PassportVersion,
  PublishPassportVersionRequest,
  SecurityObject,
  UpdatePassportRequest,
} from "@/entities/security-object";
import {
  buildObjectsFixtures,
  UNAVAILABLE_OBJECT_KPI,
} from "./fixtures/objects";
// политика свежести живёт в «Настройках» — здесь только читается
import { readFreshnessPolicy } from "./settings-store";
import { appendAudit } from "./audit-store";

function nowIso(): string {
  return new Date().toISOString();
}

function businessDate(): string {
  return nowIso().slice(0, 10);
}

// Стор персистится в sessionStorage: sidebar ходит по <a> (полная
// перезагрузка), и без персиста каждая навигация теряла бы мутации демо
// (свежеопубликованная версия исчезала бы из deep link).
const STORE_KEY = "ops-mock-objects";

let objects: SecurityObject[] | null = null;

function loadPersisted(): SecurityObject[] | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw === null ? null : (JSON.parse(raw) as SecurityObject[]);
  } catch {
    return null;
  }
}

function persist(next: SecurityObject[]): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    // квота/приватный режим — демо продолжает жить в памяти документа
  }
}

function getObjects(): SecurityObject[] {
  if (objects === null) {
    objects = loadPersisted() ?? buildObjectsFixtures(nowIso(), businessDate());
  }
  return objects;
}

function replaceObject(updated: SecurityObject): void {
  objects = getObjects().map((o) => (o.id === updated.id ? updated : o));
  persist(objects);
}

/** Read-доступ для соседних слайсов мока (ОМ привязывается к объектам). */
export function readObjectsStore(): SecurityObject[] {
  return getObjects();
}

// Конверт ошибок — форма ответа реального бэка ОМ (lib/ops-errors.ts)
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

function notFound(id: string) {
  return errorEnvelope("ENTITY_NOT_FOUND", "Объект не найден.", { id }, 404);
}

function validationError(fieldErrors: Record<string, string[]>) {
  return errorEnvelope(
    "VALIDATION_ERROR",
    "Проверьте заполнение паспорта.",
    fieldErrors,
    400
  );
}

export const objectsHandlers = [
  http.get(`*${OPS_OBJECTS_PATH}`, () => {
    const sorted = [...getObjects()].sort((a, b) => a.code.localeCompare(b.code));
    const date = businessDate();
    const freshness = sorted.map((object) =>
      resolveFreshness(object, readFreshnessPolicy(), date)
    );
    const response: ListObjectsResponse = {
      results: sorted,
      freshness,
      kpi: buildObjectsKpi(sorted, freshness),
      freshnessPolicy: readFreshnessPolicy(),
      unavailableKpi: UNAVAILABLE_OBJECT_KPI,
    };
    return HttpResponse.json(response);
  }),

  // История ОМ на объекте (Plane №38): закрытые мероприятия и лица, посещавшие
  // ИМЕННО его. Стоит ПЕРЕД деталью объекта — иначе `/{id}/history/` съел бы
  // более ранний путь детали.
  // 🔴 ШАБЛОН НАПИСАН РУКАМИ, А НЕ СОБРАН ПОМОЩНИКОМ (Plane №795). У
  // `objectHistoryPath` внутри `encodeURIComponent`, и `objectHistoryPath(":id")`
  // даёт `…/objects/%3Aid/history/` — ЛИТЕРАЛ вместо параметра MSW.
  // Обработчик после этого не совпадает ни с одним запросом и ведёт себя как
  // отсутствующий: история объекта в мок-режиме уходила в живой бэкенд.
  // Найдено сторожем `mock-route-templates.spec.ts` в первом же прогоне.
  http.get(`*${OPS_OBJECTS_PATH}:id/history/`, ({ params }) => {
    const id = params.id as string;
    const rows = readEventsStore()
      .filter((event) => event.stage === "CLOSED")
      .map((event) => ({
        event,
        visits: event.visitObjects.filter((visit) => visit.objectId === id),
      }))
      .filter(({ visits }) => visits.length > 0)
      .map(({ event, visits }) => ({
        eventId: event.id,
        code: event.code,
        title: event.title,
        kind: event.kind,
        businessDate: event.businessDate,
        businessDateEnd: event.businessDateEnd,
        closedAt: event.closedAt,
        chiefName: event.chiefName,
        persons: visits
          .filter((visit) => visit.protectedPersonName.trim() !== "")
          .map((visit) => ({
            personId: visit.protectedPersonId,
            name: visit.protectedPersonName,
            visitDay: visit.visitDay,
          })),
      }))
      .sort((a, b) =>
        a.businessDate === b.businessDate
          ? b.code.localeCompare(a.code)
          : b.businessDate.localeCompare(a.businessDate)
      );
    return HttpResponse.json({ results: rows });
  }),

  http.get(`*${objectDetailPath(":id")}`, ({ params }) => {
    const id = params.id as string;
    const found = getObjects().find((o) => o.id === id);
    if (found === undefined) return notFound(id);
    return HttpResponse.json(found);
  }),

  http.patch(`*${objectPassportPath(":id")}`, async ({ params, request }) => {
    const id = params.id as string;
    const body = (await request.json()) as UpdatePassportRequest;
    const existing = getObjects().find((o) => o.id === id);
    if (existing === undefined) return notFound(id);

    const fieldErrors: Record<string, string[]> = {};
    body.sectors.forEach((sector, sectorIndex) => {
      if (sector.name.trim() === "") {
        fieldErrors[`sectors.${sectorIndex}.name`] = ["Укажите название сектора."];
      }
      sector.posts.forEach((post, postIndex) => {
        if (post.name.trim() === "") {
          fieldErrors[`sectors.${sectorIndex}.posts.${postIndex}.name`] = [
            "Укажите название поста.",
          ];
        }
      });
    });
    if (Object.keys(fieldErrors).length > 0) {
      return validationError(fieldErrors);
    }

    const updated: SecurityObject = {
      ...existing,
      sectors: body.sectors,
      updatedAt: nowIso(),
    };
    replaceObject(updated);
    return HttpResponse.json(updated);
  }),

  http.post(
    `*${objectPassportVersionsPath(":id")}`,
    async ({ params, request }) => {
      const id = params.id as string;
      const body = (await request.json()) as PublishPassportVersionRequest;
      const existing = getObjects().find((o) => o.id === id);
      if (existing === undefined) return notFound(id);

      const fieldErrors: Record<string, string[]> = {};
      const effectiveFrom = body.effectiveFrom.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
        fieldErrors.effectiveFrom = ["Укажите дату вступления в силу."];
      } else if (
        existing.passportVersions.some((v) => v.effectiveFrom === effectiveFrom)
      ) {
        // на одну дату — не более одной опубликованной версии
        fieldErrors.effectiveFrom = [
          "На эту дату версия паспорта уже опубликована.",
        ];
      }
      // пустой паспорт как «версия» — документ ни о чём
      if (!existing.sectors.some((sector) => sector.posts.length > 0)) {
        fieldErrors.sectors = [
          "В паспорте нет ни одного поста — публиковать нечего.",
        ];
      }
      if (Object.keys(fieldErrors).length > 0) {
        return validationError(fieldErrors);
      }

      const versionNumber = existing.passportVersions.length + 1;
      const version: PassportVersion = {
        id: `${existing.id}-passport-v${versionNumber}`,
        versionNumber,
        effectiveFrom,
        publishedAt: nowIso(),
        publishedBy: "demo-admin",
        note: body.note.trim(),
        // снимок — глубокая копия: версия неизменяема после публикации
        sectors: existing.sectors.map((sector) => ({
          ...sector,
          posts: sector.posts.map((post) => ({ ...post })),
        })),
      };
      const updated: SecurityObject = {
        ...existing,
        passportVersions: [...existing.passportVersions, version],
        updatedAt: nowIso(),
      };
      replaceObject(updated);
      appendAudit({
        action: "object.passport.publish",
        entityType: "SecurityObject",
        entityId: updated.code,
        newValue: { versionNumber },
      });
      return HttpResponse.json(updated, { status: 201 });
    }
  ),
];
