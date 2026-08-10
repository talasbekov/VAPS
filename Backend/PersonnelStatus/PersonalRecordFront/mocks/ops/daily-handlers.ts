// Мок-слой «Расхода дня» (Daily Grid): подразделения, состав, bulk-запись
// статусов (атомарная: любая отклонённая строка → 0 записей + details.rows[]),
// сдача дня (окно сегодня/завтра, версии, событие считает сервер) и
// исправление сдачи (новая версия AMENDED).
//
// Источник состава — кадровый снимок PERSONNEL_ROSTER (те же люди, что в
// плане дежурств): подразделение = person.unit.
import { http, HttpResponse } from "msw";
import {
  DAILY_AMEND_PATH_PATTERN,
  DAILY_BULK_PATH,
  DAILY_DIVISIONS_PATH,
  DAILY_EMPLOYEES_PATH,
  DAILY_SUBMISSIONS_PATH,
  STATUS_TYPE_OPTIONS,
  submitWindow,
  todayLocalIso,
} from "@/entities/daily-grid";
import type {
  BulkStatusRequest,
  DayAmendBody,
  DaySubmission,
  DaySubmissionCreateBody,
} from "@/entities/daily-grid";
import { PERSONNEL_ROSTER } from "./fixtures/personnel";

const STORE_KEY = "ops-mock-daily";

/** Актор мок-стенда. */
const ACTOR = "demo-admin";

/** Записанный статус: полуинтервал [date_start, date_end). */
interface StoredStatus {
  employee_id: string;
  status_type_code: string;
  date_start: string;
  date_end: string;
  division_id: string;
  written_at: string;
}

interface DailyState {
  statuses: StoredStatus[];
  submissions: DaySubmission[];
  /** Основания исправлений: pk версии → {reason, sanction}. Наружу в списке
   * не едут (проекция — 9 полей), но сервер их помнит. */
  amendments: Record<string, { reason: string; sanction: string }>;
  seq: number;
}

function buildSeed(): DailyState {
  return { statuses: [], submissions: [], amendments: {}, seq: 0 };
}

let state: DailyState | null = null;

function getState(): DailyState {
  if (state === null) {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      state = raw === null ? buildSeed() : (JSON.parse(raw) as DailyState);
    } catch {
      state = buildSeed();
    }
  }
  return state;
}

function persist(): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // квота/приватный режим
  }
}

function nowIso(): string {
  return new Date().toISOString();
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

/** Подразделения — из кадрового снимка: имя служит и id, и подписью. */
function divisions(): { id: string; name: string }[] {
  const units = [...new Set(PERSONNEL_ROSTER.map((person) => person.unit))];
  return units.map((unit) => ({ id: unit, name: unit }));
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KNOWN_STATUS_CODES = new Set(STATUS_TYPE_OPTIONS.map((o) => o.code));

interface RowErrorOut {
  index: number;
  employee_id: string;
  code: string;
  http_status: number;
  message: string;
}

export const dailyHandlers = [
  // Подразделения.
  http.get(`*${DAILY_DIVISIONS_PATH}`, () =>
    HttpResponse.json({ results: divisions() })
  ),

  // Состав подразделения — конверт с next (дочитку страница умеет; на
  // demo-объёме next всегда null).
  http.get(`*${DAILY_EMPLOYEES_PATH}`, ({ request }) => {
    const params = new URL(request.url).searchParams;
    const divisionId = params.get("division_id") ?? "";
    const results = PERSONNEL_ROSTER.filter(
      (person) => person.unit === divisionId
    ).map((person) => ({
      id: person.id,
      full_name: person.name,
      rank_code: person.rankLabel,
    }));
    return HttpResponse.json({
      count: results.length,
      next: null,
      previous: null,
      results,
    });
  }),

  // Bulk-запись статусов. АТОМАРНАЯ: любая отклонённая строка → в БД 0
  // записей, отказ несёт details.rows[] построчно. Чисто-soft отказ (только
  // пересечения) — 409 STATUS_OVERLAP_WARNING; есть hard-строка — 422.
  http.post(`*${DAILY_BULK_PATH}`, async ({ request }) => {
    const body = (await request.json()) as BulkStatusRequest;
    const s = getState();
    if (!ISO_DATE_RE.test(body.business_date)) {
      return errorEnvelope(
        "VALIDATION_ERROR",
        "Проверьте заполнение запроса.",
        { business_date: ["Дата в формате ГГГГ-ММ-ДД."] },
        400
      );
    }
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return errorEnvelope(
        "VALIDATION_ERROR",
        "Проверьте заполнение запроса.",
        { rows: ["Пустой список строк."] },
        400
      );
    }

    const hardErrors: RowErrorOut[] = [];
    const softErrors: RowErrorOut[] = [];
    const knownIds = new Set(PERSONNEL_ROSTER.map((p) => p.id));
    body.rows.forEach((row, index) => {
      if (!KNOWN_STATUS_CODES.has(row.status_type_code)) {
        hardErrors.push({
          index,
          employee_id: row.employee_id,
          code: "UNKNOWN_STATUS_TYPE",
          http_status: 422,
          message: `Неизвестный код статуса «${row.status_type_code}».`,
        });
        return;
      }
      if (!knownIds.has(row.employee_id)) {
        hardErrors.push({
          index,
          employee_id: row.employee_id,
          code: "UNKNOWN_EMPLOYEE",
          http_status: 422,
          message: "Сотрудник не найден в составе.",
        });
        return;
      }
      if (
        !ISO_DATE_RE.test(row.date_start) ||
        !ISO_DATE_RE.test(row.date_end) ||
        row.date_end <= row.date_start
      ) {
        hardErrors.push({
          index,
          employee_id: row.employee_id,
          code: "INVALID_PERIOD",
          http_status: 422,
          message: "Период статуса пуст или задан наоборот.",
        });
        return;
      }
      // Пересечение с УЖЕ ЗАПИСАННЫМ срочным статусом ДРУГОГО кода,
      // накрывающим этот день, — мягкий конфликт (перекрывается осознанной
      // повторной отправкой тех же строк... в bulk агрегат не оверрайдаем:
      // отказ показывается построчно, оператор правит значения).
      const overlapping = s.statuses.find(
        (stored) =>
          stored.employee_id === row.employee_id &&
          stored.status_type_code !== row.status_type_code &&
          stored.date_start <= body.business_date &&
          stored.date_end > body.business_date &&
          // однодневная запись того же дня перезаписывается молча — конфликт
          // только с длинным периодом, выписанным раньше
          stored.date_end > row.date_end
      );
      if (overlapping !== undefined) {
        softErrors.push({
          index,
          employee_id: row.employee_id,
          code: "STATUS_OVERLAP",
          http_status: 409,
          message: `Пересекается с действующим статусом «${
            STATUS_TYPE_OPTIONS.find(
              (o) => o.code === overlapping.status_type_code
            )?.label ?? overlapping.status_type_code
          }» до ${overlapping.date_end} (исключительно).`,
        });
      }
    });

    if (hardErrors.length > 0) {
      // Сервис атомарен: при любой отклонённой строке — 0 записей.
      return errorEnvelope(
        "BULK_ROWS_REJECTED",
        `Отклонено строк: ${hardErrors.length + softErrors.length} из ${body.rows.length}.`,
        { rows: [...hardErrors, ...softErrors] },
        422
      );
    }
    if (softErrors.length > 0) {
      return errorEnvelope(
        "STATUS_OVERLAP_WARNING",
        `Пересечения по ${softErrors.length} строкам.`,
        { rows: softErrors },
        409
      );
    }

    // Применение: прежняя запись сотрудника, накрывающая день, замещается.
    const now = nowIso();
    const divisionByEmployee = new Map(
      PERSONNEL_ROSTER.map((p) => [p.id, p.unit])
    );
    for (const row of body.rows) {
      s.statuses = s.statuses.filter(
        (stored) =>
          !(
            stored.employee_id === row.employee_id &&
            stored.date_start <= body.business_date &&
            stored.date_end > body.business_date
          )
      );
      s.statuses.push({
        employee_id: row.employee_id,
        status_type_code: row.status_type_code,
        date_start: row.date_start,
        date_end: row.date_end,
        division_id: divisionByEmployee.get(row.employee_id) ?? "",
        written_at: now,
      });
    }
    persist();
    return HttpResponse.json({ created: body.rows.length }, { status: 201 });
  }),

  // Список сдач: фильтры точным равенством, порядок -business_date,-version.
  // Селектор по is_current НЕ фильтрует — приходят ВСЕ версии.
  http.get(`*${DAILY_SUBMISSIONS_PATH}`, ({ request }) => {
    const params = new URL(request.url).searchParams;
    const divisionId = params.get("division_id");
    const businessDate = params.get("business_date");
    const s = getState();
    const results = s.submissions
      .filter((row) => divisionId === null || row.division_id === divisionId)
      .filter((row) => businessDate === null || row.business_date === businessDate)
      .sort(
        (a, b) =>
          b.business_date.localeCompare(a.business_date) ||
          b.version - a.version ||
          a.id - b.id
      );
    return HttpResponse.json({
      count: results.length,
      next: null,
      previous: null,
      results,
    });
  }),

  // Сдача дня. Окно {сегодня, завтра} решает СЕРВЕР (details.allowed из
  // ответа); повторная сдача дня — 409 DAY_ALREADY_SUBMITTED; событие считает
  // сервер: есть записанные статусы дня → CHANGED, иначе при наличии
  // предыдущей сдачи — CONFIRMED_NO_CHANGES (первая сдача всегда CHANGED).
  http.post(`*${DAILY_SUBMISSIONS_PATH}`, async ({ request }) => {
    const body = (await request.json()) as DaySubmissionCreateBody;
    const s = getState();
    if (!ISO_DATE_RE.test(body.business_date) || body.division_id === "") {
      return errorEnvelope(
        "VALIDATION_ERROR",
        "Проверьте заполнение запроса.",
        {},
        400
      );
    }
    if (!divisions().some((d) => d.id === body.division_id)) {
      return errorEnvelope("ENTITY_NOT_FOUND", "Подразделение не найдено.", {}, 404);
    }
    const today = todayLocalIso();
    const allowed = submitWindow(today);
    if (!allowed.includes(body.business_date)) {
      return errorEnvelope(
        "BUSINESS_DATE_OUT_OF_WINDOW",
        "Дата вне окна сдачи.",
        { allowed },
        422
      );
    }
    const existing = s.submissions.find(
      (row) =>
        row.division_id === body.division_id &&
        row.business_date === body.business_date &&
        row.is_current
    );
    if (existing !== undefined) {
      return errorEnvelope("DAY_ALREADY_SUBMITTED", "День уже сдан.", {}, 409);
    }

    const hasChanges = s.statuses.some(
      (row) =>
        row.division_id === body.division_id &&
        row.date_start <= body.business_date &&
        row.date_end > body.business_date
    );
    const previous = s.submissions.find(
      (row) =>
        row.division_id === body.division_id &&
        row.is_current &&
        row.business_date < body.business_date
    );
    s.seq += 1;
    const created: DaySubmission = {
      id: s.seq,
      division_id: body.division_id,
      business_date: body.business_date,
      version: 1,
      is_current: true,
      // При previous === null сервер всегда даёт CHANGED.
      event:
        previous === null || hasChanges ? "CHANGED" : "CONFIRMED_NO_CHANGES",
      submitted_by: ACTOR,
      submitted_at: nowIso(),
      late: false,
    };
    s.submissions = [...s.submissions, created];
    persist();
    return HttpResponse.json(created, { status: 201 });
  }),

  // Исправление сдачи: новая версия AMENDED той же цепочки; pk адресует
  // ЦЕПОЧКУ — сервер сам переразрешает голову дня, поэтому даже устаревший pk
  // амендит тот же день.
  http.post(`*${DAILY_AMEND_PATH_PATTERN}`, async ({ params, request }) => {
    const submissionId = Number(params.submissionId);
    const body = (await request.json()) as DayAmendBody;
    const s = getState();
    const source = s.submissions.find((row) => row.id === submissionId);
    if (source === undefined) {
      return errorEnvelope("ENTITY_NOT_FOUND", "Сдача не найдена.", {}, 404);
    }
    if (body.reason.trim() === "") {
      return errorEnvelope(
        "VALIDATION_ERROR",
        "Проверьте заполнение формы.",
        { reason: ["Причина обязательна."] },
        400
      );
    }
    if (body.sanction.trim() === "" || body.sanction.trim().length > 255) {
      return errorEnvelope(
        "VALIDATION_ERROR",
        "Проверьте заполнение формы.",
        { sanction: ["Санкция обязательна и не длиннее 255 символов."] },
        400
      );
    }
    // Голова цепочки дня.
    const head = s.submissions
      .filter(
        (row) =>
          row.division_id === source.division_id &&
          row.business_date === source.business_date
      )
      .reduce((best, row) => (row.version > best.version ? row : best), source);
    s.seq += 1;
    const created: DaySubmission = {
      id: s.seq,
      division_id: head.division_id,
      business_date: head.business_date,
      version: head.version + 1,
      is_current: true,
      event: "AMENDED",
      submitted_by: ACTOR,
      submitted_at: nowIso(),
      late: false,
    };
    s.submissions = s.submissions.map((row) =>
      row.division_id === head.division_id &&
      row.business_date === head.business_date
        ? { ...row, is_current: false }
        : row
    );
    s.submissions = [...s.submissions, created];
    s.amendments[String(created.id)] = {
      reason: body.reason.trim(),
      sanction: body.sanction.trim(),
    };
    persist();
    return HttpResponse.json(created, { status: 201 });
  }),
];
