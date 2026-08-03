// MSW-handlers «План дежурств»: серверная логика — конфликты, action policy
// шапки, KPI считаются здесь; страница получает готовое. Персист —
// sessionStorage (полные перезагрузки sidebar-навигации).
import { http, HttpResponse } from "msw";
import {
  buildPlanActions,
  buildValidation,
  detectDutyConflicts,
  dutyPlanApprovePath,
  dutyPlanCheckPath,
  dutyPlanDraftPath,
  dutyPlanReopenPath,
  dutyShiftAcknowledgePath,
  dutyShiftCancelPath,
  dutyShiftClockInPath,
  dutyShiftClockOutPath,
  dutyShiftDetailPath,
  isValidationCurrent,
  monthOf,
  planFingerprint,
  DUTY_CANDIDATES_PATH,
  DUTY_MONTHLY_PLAN_PATH,
  DUTY_PLAN_OBJECTS_PATH,
  DUTY_SHIFTS_PATH,
  DUTY_TYPES_PATH,
} from "@/entities/duty-shift";
import type {
  CancelDutyShiftRequest,
  CreateDutyShiftRequest,
  DutyCandidateOption,
  DutyPassportStatus,
  DutyPlanObjectOption,
  DutyShift,
  DutyShiftDetail,
  DutyTypeDefinition,
  ListDutyPlanObjectsResponse,
  MonthlyDutyPlanResponse,
  MonthlyPlanActionRequest,
  MonthlyPlanRecord,
} from "@/entities/duty-shift";
import { resolveApplicableVersion } from "@/entities/security-event";
import { readObjectsStore } from "./objects-handlers";
import { PERSONNEL_ROSTER, findPersonnel } from "./fixtures/personnel";
import { readConflictPolicy } from "./settings-store";
import { appendAudit } from "./audit-store";

const SHIFTS_KEY = "ops-mock-duty-shifts";
const PLANS_KEY = "ops-mock-duty-plans";

/** Реестр видов — данные «с сервера», не хардкод страницы. */
const DUTY_TYPES: DutyTypeDefinition[] = [
  {
    dutyTypeCode: "DAY_OBJECT",
    safeLabel: "Суточное дежурство на объекте",
    targetType: "PROTECTED_OBJECT",
    defaultDurationMinutes: 1440,
    requiresSenior: true,
    restAfterMinutes: 1440,
    requiresCurrentPassport: true,
  },
  {
    dutyTypeCode: "DAY_OWN",
    safeLabel: "Дежурство по управлению",
    targetType: "OWN_OBJECT",
    defaultDurationMinutes: 1440,
    requiresSenior: false,
    restAfterMinutes: 720,
    requiresCurrentPassport: false,
  },
];

// политика конфликтов живёт в «Настройках» — здесь только читается:
// правка режима отдыха там меняет исход создания смены здесь

function nowIso(): string {
  return new Date().toISOString();
}
function businessDate(): string {
  return nowIso().slice(0, 10);
}

// ── Сторы ────────────────────────────────────────────────────────────────

let shifts: DutyShift[] | null = null;
let plans: Record<string, MonthlyPlanRecord> | null = null;

function load<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function persist(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // квота/приватный режим — живём в памяти документа
  }
}

let seedSeq = 0;
function nextId(): string {
  seedSeq += 1;
  return `duty-${seedSeq}-${Math.floor(Math.random() * 1000)}`;
}

/** Сид: три смены текущего месяца на объектах реестра. */
function buildSeed(): DutyShift[] {
  const now = nowIso();
  const today = businessDate();
  const objects = readObjectsStore();
  const withPassport = objects.find((o) => o.passportVersions.length > 0);
  const seeded: DutyShift[] = [];

  if (withPassport !== undefined) {
    const version = resolveApplicableVersion(withPassport, today);
    const sector = version?.sectors[0];
    const post = sector?.posts[0];
    seeded.push({
      id: nextId(),
      businessDate: today,
      dutyTypeCode: "DAY_OBJECT",
      target: {
        targetType: "PROTECTED_OBJECT",
        objectId: withPassport.id,
        safeLabel: withPassport.name,
      },
      employeeName: "Жаксылыков Д.",
      employeeId: "emp-2",
      stateCode: "ACTIVE",
      acknowledgedAt: now,
      actualStart: now,
      actualEnd: null,
      updatedAt: now,
      passportBinding:
        version && sector && post
          ? {
              objectId: withPassport.id,
              objectName: withPassport.name,
              versionId: version.id,
              versionNumber: version.versionNumber,
              effectiveFrom: version.effectiveFrom,
              sectorId: sector.id,
              sectorName: sector.name,
              postId: post.id,
              postName: post.name,
              boundAt: now,
            }
          : null,
      note: null,
      cancellation: null,
      overrideReason: null,
    });
  }

  const second = readObjectsStore()[1];
  if (second !== undefined) {
    seeded.push({
      id: nextId(),
      businessDate: today,
      dutyTypeCode: "DAY_OWN",
      target: {
        targetType: "OWN_OBJECT",
        objectId: second.id,
        safeLabel: second.name,
      },
      employeeName: "Есимов Б.",
      employeeId: "emp-10",
      stateCode: "PLANNED",
      acknowledgedAt: null,
      actualStart: null,
      actualEnd: null,
      updatedAt: now,
      passportBinding: null,
      note: "Усиление на время совещания",
      cancellation: null,
      overrideReason: null,
    });
  }
  return seeded;
}

function getShifts(): DutyShift[] {
  if (shifts === null) {
    shifts = load<DutyShift[]>(SHIFTS_KEY) ?? buildSeed();
    persist(SHIFTS_KEY, shifts);
  }
  return shifts;
}

/** Узкая проекция для аналитики службы (§22.3): ТОЛЬКО чтение — аналитика
 * потребитель смен, а их владелец — план дежурств. */
export function readDutyShiftsStore(): DutyShift[] {
  return getShifts();
}

export function readDutyTypesRegistry(): DutyTypeDefinition[] {
  return DUTY_TYPES.map((type) => ({ ...type }));
}

function saveShift(updated: DutyShift): DutyShift {
  shifts = getShifts().map((s) => (s.id === updated.id ? updated : s));
  persist(SHIFTS_KEY, shifts);
  return updated;
}

function addShift(created: DutyShift): void {
  shifts = [...getShifts(), created];
  persist(SHIFTS_KEY, shifts);
}

function getPlans(): Record<string, MonthlyPlanRecord> {
  if (plans === null) {
    plans = load<Record<string, MonthlyPlanRecord>>(PLANS_KEY) ?? {};
  }
  return plans;
}

function savePlan(record: MonthlyPlanRecord): MonthlyPlanRecord {
  plans = { ...getPlans(), [record.month]: record };
  persist(PLANS_KEY, plans);
  return record;
}

// ── Ответы-ошибки (конверт ops-errors) ───────────────────────────────────

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

const validationError = (fieldErrors: Record<string, unknown>) =>
  errorEnvelope("VALIDATION_ERROR", "Проверьте заполнение формы.", fieldErrors, 400);
const businessRuleError = (code: string, message: string) =>
  errorEnvelope(code, message, {}, 422);

// ── Производные ──────────────────────────────────────────────────────────

function passportStatusOf(shift: DutyShift): DutyPassportStatus {
  const object = readObjectsStore().find((o) => o.id === shift.target.objectId);
  const applicable =
    object === undefined
      ? null
      : resolveApplicableVersion(object, shift.businessDate);
  return {
    shiftId: shift.id,
    objectKnown: object !== undefined,
    applicableVersionId: applicable?.id ?? null,
    applicableVersionNumber: applicable?.versionNumber ?? null,
    stale:
      shift.passportBinding !== null &&
      applicable !== null &&
      applicable.versionNumber > shift.passportBinding.versionNumber,
  };
}

function monthShifts(month: string): DutyShift[] {
  return getShifts().filter((s) => monthOf(s.businessDate) === month);
}

function planLocked(date: string): boolean {
  const record = getPlans()[monthOf(date)];
  return record !== undefined && record.stateCode === "APPROVED";
}

export const dutiesHandlers = [
  http.get(`*${DUTY_TYPES_PATH}`, () =>
    HttpResponse.json({ results: DUTY_TYPES, conflictPolicy: readConflictPolicy() })
  ),

  // месячный план одним ответом: шапка + смены + конфликты + KPI
  http.get(`*${DUTY_MONTHLY_PLAN_PATH}`, ({ request }) => {
    const url = new URL(request.url);
    const month = url.searchParams.get("month") ?? businessDate().slice(0, 7);
    const record = getPlans()[month] ?? null;
    const shiftsOfMonth = monthShifts(month);
    const conflicts = detectDutyConflicts(shiftsOfMonth, DUTY_TYPES, readConflictPolicy());
    const fingerprint = planFingerprint(month, shiftsOfMonth);
    const active = shiftsOfMonth.filter((s) => s.stateCode !== "CANCELLED");
    const response: MonthlyDutyPlanResponse = {
      month,
      record,
      actions: buildPlanActions(
        record,
        { canManage: true, canApprove: true },
        isValidationCurrent(record?.lastValidation ?? null, fingerprint)
      ),
      shifts: [...shiftsOfMonth].sort(
        (a, b) =>
          a.businessDate.localeCompare(b.businessDate) || a.id.localeCompare(b.id)
      ),
      passportStatuses: shiftsOfMonth.map(passportStatusOf),
      conflicts,
      conflictPolicy: readConflictPolicy(),
      kpi: {
        totalShifts: shiftsOfMonth.length,
        activeShifts: active.length,
        cancelledShifts: shiftsOfMonth.length - active.length,
        hardConflicts: conflicts.filter((c) => c.severity === "HARD").length,
        softConflicts: conflicts.filter((c) => c.severity === "SOFT").length,
      },
    };
    return HttpResponse.json(response);
  }),

  http.post(`*${dutyPlanDraftPath()}`, async ({ request }) => {
    const body = (await request.json()) as MonthlyPlanActionRequest;
    if (getPlans()[body.month] !== undefined) {
      return businessRuleError(
        "PLAN_ALREADY_EXISTS",
        "План на этот месяц уже создан."
      );
    }
    const now = nowIso();
    return HttpResponse.json(
      savePlan({
        month: body.month,
        stateCode: "DRAFT",
        revision: 1,
        createdAt: now,
        lastValidation: null,
        approvedAt: null,
        approvedBy: null,
        history: [
          { at: now, revision: 1, event: "DRAFT_CREATED", note: "Черновик сформирован." },
        ],
      }),
      { status: 201 }
    );
  }),

  http.post(`*${dutyPlanCheckPath()}`, async ({ request }) => {
    const body = (await request.json()) as MonthlyPlanActionRequest;
    const record = getPlans()[body.month];
    if (record === undefined) {
      return businessRuleError("PLAN_NOT_FOUND", "Плана на этот месяц нет.");
    }
    if (record.stateCode === "APPROVED") {
      return businessRuleError(
        "INVALID_STAGE_TRANSITION",
        "План утверждён — проверять нечего до открытия новой редакции."
      );
    }
    const now = nowIso();
    const shiftsOfMonth = monthShifts(body.month);
    const conflicts = detectDutyConflicts(shiftsOfMonth, DUTY_TYPES, readConflictPolicy());
    const validation = buildValidation(
      now,
      conflicts,
      planFingerprint(body.month, shiftsOfMonth)
    );
    return HttpResponse.json(
      savePlan({
        ...record,
        lastValidation: validation,
        history: [
          ...record.history,
          {
            at: now,
            revision: record.revision,
            event: "VALIDATED",
            note: validation.passed
              ? `Проверка пройдена: жёстких 0, мягких ${validation.softConflicts}.`
              : `Жёстких конфликтов: ${validation.hardConflicts}.`,
          },
        ],
      })
    );
  }),

  http.post(`*${dutyPlanApprovePath()}`, async ({ request }) => {
    const body = (await request.json()) as MonthlyPlanActionRequest;
    const record = getPlans()[body.month];
    if (record === undefined) {
      return businessRuleError("PLAN_NOT_FOUND", "Плана на этот месяц нет.");
    }
    const shiftsOfMonth = monthShifts(body.month);
    const fingerprint = planFingerprint(body.month, shiftsOfMonth);
    if (
      record.stateCode === "APPROVED" ||
      record.lastValidation === null ||
      !isValidationCurrent(record.lastValidation, fingerprint) ||
      !record.lastValidation.passed
    ) {
      return businessRuleError(
        "PLAN_NOT_APPROVABLE",
        "Утверждение недоступно: проверьте состояние плана и актуальность проверки конфликтов."
      );
    }
    const now = nowIso();
    return HttpResponse.json(
      savePlan({
        ...record,
        stateCode: "APPROVED",
        approvedAt: now,
        approvedBy: "demo-admin",
        history: [
          ...record.history,
          {
            at: now,
            revision: record.revision,
            event: "APPROVED",
            note: `Редакция ${record.revision} утверждена.`,
          },
        ],
      })
    );
  }),

  http.post(`*${dutyPlanReopenPath()}`, async ({ request }) => {
    const body = (await request.json()) as MonthlyPlanActionRequest;
    const record = getPlans()[body.month];
    if (record === undefined || record.stateCode !== "APPROVED") {
      return businessRuleError(
        "INVALID_STAGE_TRANSITION",
        "Новая редакция открывается только для утверждённого плана."
      );
    }
    const now = nowIso();
    return HttpResponse.json(
      savePlan({
        ...record,
        stateCode: "DRAFT",
        revision: record.revision + 1,
        lastValidation: null,
        approvedAt: null,
        approvedBy: null,
        history: [
          ...record.history,
          {
            at: now,
            revision: record.revision + 1,
            event: "REOPENED",
            note: `Открыта редакция ${record.revision + 1}.`,
          },
        ],
      })
    );
  }),

  // объекты формы создания — уже разрешённые на дату
  http.get(`*${DUTY_PLAN_OBJECTS_PATH}`, ({ request }) => {
    const url = new URL(request.url);
    const date = url.searchParams.get("date") ?? businessDate();
    const results: DutyPlanObjectOption[] = readObjectsStore().map((object) => {
      const applicable = resolveApplicableVersion(object, date);
      return {
        objectId: object.id,
        objectName: object.name,
        objectCode: object.code,
        passportState: object.passportState,
        applicableVersionId: applicable?.id ?? null,
        applicableVersionNumber: applicable?.versionNumber ?? null,
        applicableVersionEffectiveFrom: applicable?.effectiveFrom ?? null,
        sectors:
          applicable?.sectors.map((sector) => ({
            sectorId: sector.id,
            sectorName: sector.name,
            posts: sector.posts.map((post) => ({
              postId: post.id,
              postName: post.name,
              task: post.task,
              requirements: post.requirements,
            })),
          })) ?? [],
        blockReason:
          applicable === null
            ? "На эту дату нет опубликованной версии паспорта — посты взять неоткуда."
            : null,
      };
    });
    const response: ListDutyPlanObjectsResponse = { businessDate: date, results };
    return HttpResponse.json(response);
  }),

  http.get(`*${DUTY_CANDIDATES_PATH}`, ({ request }) => {
    const url = new URL(request.url);
    const date = url.searchParams.get("date") ?? businessDate();
    const active = getShifts().filter((s) => s.stateCode !== "CANCELLED");
    const results: DutyCandidateOption[] = PERSONNEL_ROSTER.map((person) => {
      const personShifts = active.filter((s) => s.employeeId === person.id);
      const future = personShifts
        .map((s) => s.businessDate)
        .filter((d) => d >= date)
        .sort();
      return {
        employeeId: person.id,
        employeeName: person.name,
        unitName: person.unit,
        positionName: person.rankLabel,
        nearestDutyDate: future[0] ?? null,
        busyOnRequestedDate: personShifts.some((s) => s.businessDate === date),
      };
    });
    return HttpResponse.json({ businessDate: date, results });
  }),

  http.get(`*${DUTY_SHIFTS_PATH}`, () => {
    const all = getShifts();
    return HttpResponse.json({
      results: all,
      passportStatuses: all.map(passportStatusOf),
    });
  }),

  http.get(`*${dutyShiftDetailPath(":id")}`, ({ params }) => {
    const id = params.id as string;
    const shift = getShifts().find((s) => s.id === id);
    if (shift === undefined) {
      return errorEnvelope("ENTITY_NOT_FOUND", "Смена не найдена.", { id }, 404);
    }
    const dayConflicts = detectDutyConflicts(
      getShifts().filter((s) => s.employeeName === shift.employeeName),
      DUTY_TYPES,
      readConflictPolicy()
    ).filter((c) => c.businessDate === shift.businessDate);
    const detail: DutyShiftDetail = {
      shift,
      passportStatus: passportStatusOf(shift),
      dutyType: DUTY_TYPES.find((t) => t.dutyTypeCode === shift.dutyTypeCode) ?? null,
      conflicts: dayConflicts,
      conflictPolicy: readConflictPolicy(),
    };
    return HttpResponse.json(detail);
  }),

  http.post(`*${DUTY_SHIFTS_PATH}`, async ({ request }) => {
    const body = (await request.json()) as CreateDutyShiftRequest;
    const fieldErrors: Record<string, string[]> = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.businessDate)) {
      fieldErrors.businessDate = ["Укажите дату в формате ГГГГ-ММ-ДД."];
    }
    if (body.dutyTypeCode.trim() === "") fieldErrors.dutyTypeCode = ["Выберите вид."];
    if (body.objectId.trim() === "") fieldErrors.objectId = ["Выберите объект."];
    if (body.employeeId.trim() === "") fieldErrors.employeeId = ["Выберите сотрудника."];
    if (Object.keys(fieldErrors).length > 0) return validationError(fieldErrors);

    if (planLocked(body.businessDate)) {
      return businessRuleError(
        "PLAN_APPROVED_LOCKED",
        "План месяца утверждён — изменения только в новой редакции."
      );
    }
    const dutyType = DUTY_TYPES.find((t) => t.dutyTypeCode === body.dutyTypeCode);
    if (dutyType === undefined) {
      return validationError({ dutyTypeCode: ["Вид дежурства не найден."] });
    }
    const person = findPersonnel(body.employeeId);
    if (person === undefined) {
      return validationError({ employeeId: ["Сотрудник не найден."] });
    }
    const object = readObjectsStore().find((o) => o.id === body.objectId);
    if (object === undefined) {
      return validationError({ objectId: ["Объект не найден в реестре."] });
    }
    const applicable = resolveApplicableVersion(object, body.businessDate);
    const sector = applicable?.sectors.find((s) => s.id === body.sectorId) ?? null;
    const post = sector?.posts.find((p) => p.id === body.postId) ?? null;
    if (dutyType.requiresCurrentPassport && (applicable === null || post === null)) {
      return businessRuleError(
        "PASSPORT_REQUIRED",
        "Вид дежурства требует действующей версии паспорта и поста из неё."
      );
    }

    // жёсткое правило: пересечение с другим дежурством в тот же день
    const active = getShifts().filter((s) => s.stateCode !== "CANCELLED");
    const overlap = active.some(
      (s) => s.employeeId === person.id && s.businessDate === body.businessDate
    );
    if (overlap) {
      return businessRuleError(
        "DUTY_OVERLAP",
        `${person.name} уже назначен(а) на дежурство ${body.businessDate} — пересечение недопустимо.`
      );
    }

    // мягкое правило: отдых после дежурства (режим — из политики)
    const overrideReason =
      body.override === true ? (body.override_reason ?? "").trim() : "";
    const probe: DutyShift = {
      id: "probe",
      businessDate: body.businessDate,
      dutyTypeCode: body.dutyTypeCode,
      target: {
        targetType: dutyType.targetType,
        objectId: object.id,
        safeLabel: object.name,
      },
      employeeName: person.name,
      employeeId: person.id,
      stateCode: "PLANNED",
      acknowledgedAt: null,
      actualStart: null,
      actualEnd: null,
      updatedAt: nowIso(),
      passportBinding: null,
      note: null,
      cancellation: null,
      overrideReason: null,
    };
    const restConflicts = detectDutyConflicts(
      [...active.filter((s) => s.employeeId === person.id), probe],
      DUTY_TYPES,
      readConflictPolicy()
    ).filter((c) => c.code === "REST_AFTER_DUTY");
    if (restConflicts.length > 0) {
      const hard = restConflicts.some((c) => c.severity === "HARD");
      if (hard) {
        return businessRuleError("REST_AFTER_DUTY", restConflicts[0].message);
      }
      if (overrideReason === "") {
        return errorEnvelope(
          "DUTY_CONFLICT_DETECTED",
          restConflicts[0].message,
          {
            conflicts: restConflicts.map((c) => ({
              conflict_code: c.code,
              severity: c.severity,
              employee_id: person.id,
              message: c.message,
            })),
          },
          409
        );
      }
    }

    const now = nowIso();
    const created: DutyShift = {
      ...probe,
      id: nextId(),
      passportBinding:
        applicable !== null && sector !== null && post !== null
          ? {
              objectId: object.id,
              objectName: object.name,
              versionId: applicable.id,
              versionNumber: applicable.versionNumber,
              effectiveFrom: applicable.effectiveFrom,
              sectorId: sector.id,
              sectorName: sector.name,
              postId: post.id,
              postName: post.name,
              boundAt: now,
            }
          : null,
      note: body.note === null || body.note.trim() === "" ? null : body.note.trim(),
      // обоснование хранится только при реально возникшем мягком конфликте
      overrideReason:
        restConflicts.length > 0 && overrideReason !== "" ? overrideReason : null,
      updatedAt: now,
    };
    addShift(created);
    appendAudit({
      action: "duty_shift.create",
      entityType: "DutyShift",
      entityId: created.id,
      newValue: {
        businessDate: created.businessDate,
        employeeName: created.employeeName,
      },
      reason: created.overrideReason ?? "",
    });
    return HttpResponse.json(created, { status: 201 });
  }),

  http.post(`*${dutyShiftCancelPath(":id")}`, async ({ params, request }) => {
    const id = params.id as string;
    const shift = getShifts().find((s) => s.id === id);
    if (shift === undefined) {
      return errorEnvelope("ENTITY_NOT_FOUND", "Смена не найдена.", { id }, 404);
    }
    const body = (await request.json()) as CancelDutyShiftRequest;
    if (body.reason.trim() === "") {
      return validationError({ reason: ["Укажите причину отмены."] });
    }
    if (shift.stateCode !== "PLANNED" && shift.stateCode !== "ACKNOWLEDGED") {
      return businessRuleError(
        "INVALID_STAGE_TRANSITION",
        "Отменить можно только ещё не начатую смену."
      );
    }
    if (planLocked(shift.businessDate)) {
      return businessRuleError(
        "PLAN_APPROVED_LOCKED",
        "План месяца утверждён — изменения только в новой редакции."
      );
    }
    const now = nowIso();
    appendAudit({
      action: "duty_shift.cancel",
      entityType: "DutyShift",
      entityId: shift.id,
      oldValue: { stateCode: shift.stateCode },
      newValue: { stateCode: "CANCELLED" },
      reason: body.reason.trim(),
    });
    return HttpResponse.json(
      saveShift({
        ...shift,
        stateCode: "CANCELLED",
        cancellation: { reason: body.reason.trim(), cancelledAt: now },
        updatedAt: now,
      })
    );
  }),

  http.post(`*${dutyShiftAcknowledgePath(":id")}`, ({ params }) => {
    const id = params.id as string;
    const shift = getShifts().find((s) => s.id === id);
    if (shift === undefined) {
      return errorEnvelope("ENTITY_NOT_FOUND", "Смена не найдена.", { id }, 404);
    }
    if (shift.stateCode !== "PLANNED") {
      return businessRuleError(
        "INVALID_STAGE_TRANSITION",
        "Ознакомление отмечается на запланированной смене."
      );
    }
    const now = nowIso();
    return HttpResponse.json(
      saveShift({ ...shift, stateCode: "ACKNOWLEDGED", acknowledgedAt: now, updatedAt: now })
    );
  }),

  http.post(`*${dutyShiftClockInPath(":id")}`, ({ params }) => {
    const id = params.id as string;
    const shift = getShifts().find((s) => s.id === id);
    if (shift === undefined) {
      return errorEnvelope("ENTITY_NOT_FOUND", "Смена не найдена.", { id }, 404);
    }
    if (shift.stateCode !== "ACKNOWLEDGED") {
      return businessRuleError(
        "INVALID_STAGE_TRANSITION",
        "Заступить можно после ознакомления."
      );
    }
    const now = nowIso();
    return HttpResponse.json(
      saveShift({ ...shift, stateCode: "ACTIVE", actualStart: now, updatedAt: now })
    );
  }),

  http.post(`*${dutyShiftClockOutPath(":id")}`, ({ params }) => {
    const id = params.id as string;
    const shift = getShifts().find((s) => s.id === id);
    if (shift === undefined) {
      return errorEnvelope("ENTITY_NOT_FOUND", "Смена не найдена.", { id }, 404);
    }
    if (shift.stateCode !== "ACTIVE") {
      return businessRuleError(
        "INVALID_STAGE_TRANSITION",
        "Завершить можно только смену на дежурстве."
      );
    }
    const now = nowIso();
    return HttpResponse.json(
      saveShift({ ...shift, stateCode: "COMPLETED", actualEnd: now, updatedAt: now })
    );
  }),
];
