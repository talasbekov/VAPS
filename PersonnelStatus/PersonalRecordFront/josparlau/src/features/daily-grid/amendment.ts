// Story 10.6 — контракт amendment-флоу (POST /{id}/amend/) на фронте.
//
// РУКОПИСНОЕ ЗЕРКАЛО `DailySubmissionAmendSerializer`.
// Схема этого пути типов НЕ несёт: `operations_daily_submissions_amend_create`
// (`schema.d.ts:2560-2579`) объявлен с `requestBody?: never` и единственным
// ответом 200 c `content?: never`, тогда как живой view отдаёт **201** с
// 9-полевой проекцией (`views.py:216-219`). Индексировать нечего ⇒ ARCH-FE-011
// («рукописные типы при наличии схемы = MUST NOT») здесь не нарушен: схемы нет.
// Прецедент формы — `daySubmission.ts:1-20` (10.3).
// Замещается схемными типами в стори **10.1c** (`@extend_schema` + regen).
//
// Источник истины (сверено с raise-сайтами, НЕ со словарём error-codes.yaml —
// урок 10.1: словарь несёт донор-фантомы):
//   Backend/VAPS/apps/operations/submissions/api/serializers.py:24-38
//   Backend/VAPS/apps/operations/submissions/api/views.py:186-219
//   Backend/VAPS/apps/operations/submissions/services/scope_gate.py:41-43
//
// Чистые функции: ни React, ни apiClient (тестируются в env node).
import type { ApiFailure } from '../../shared/api/errors'

/**
 * Тело `DailySubmissionAmendSerializer` — РОВНО два поля.
 *
 * `triggered_by_status_id` бэк НЕ принимает намеренно (ЛОВУШКА №4 5.8b: это
 * provenance-ref системного хука 5.4b, и приём его от клиента дал бы подделку
 * происхождения). `submitted_by`/`division_id`/`business_date` игнорируются
 * (ARCH-SEC-030: actor и цель — из auth-контракта и из pk) — не отправляем,
 * иначе UI обещал бы влияние, которого нет.
 *
 * ⚠️ `type`, а НЕ `interface` (ловушка 10.3/10.5): `useApiMutation<TData,
 * TVariables extends Record<string, unknown>>` требует присваиваемости к
 * индекс-сигнатуре, а `interface` неявной индекс-сигнатуры не получает — `tsc`
 * покраснел бы «Index signature for type 'string' is missing», и ошибка
 * выглядела бы как проблема хука, а не объявления.
 */
export type DayAmendBody = {
  reason: string
  sanction: string
}

/** Зеркало `sanction = serializers.CharField(max_length=255)` (модель — CharField(255)). */
export const SANCTION_MAX = 255

/**
 * Форма заполнена настолько, что отправка законна.
 *
 * ⚠️ Длину меряем ПОСЛЕ `trim()`, и это не косметика: DRF-овский
 * `trim_whitespace=True` отрабатывает в `to_internal_value` ДО
 * `MaxLengthValidator`, поэтому 255 значимых символов с хвостовыми пробелами
 * бэк принимает. Наивная проверка сырой длины заблокировала бы законное
 * значение — интерфейс запрещал бы то, что сервер разрешает.
 *
 * Нижнего предела у причины НЕТ (Решение №5): правило «10–500 символов» —
 * собственность `ConflictDialog`/override-пути, а `_require_text`
 * (`amendment_service.py:51-53`) проверяет только непустоту. Придуманный на
 * фронте минимум отбивал бы законные короткие причины.
 */
export function isAmendmentComplete(reason: string, sanction: string): boolean {
  const trimmedSanction = sanction.trim()
  return (
    reason.trim().length > 0 &&
    trimmedSanction.length > 0 &&
    trimmedSanction.length <= SANCTION_MAX
  )
}

/**
 * 403 на исправлении: текст ФИКСИРОВАННЫЙ, не из конверта. `scope_gate.py:41-43`
 * бросает `DomainError` БЕЗ kwarg `message`, а `DomainError.message = message
 * or code` подставляет сам `error_code`; DRF-путь (`core/api/permissions.py:15,
 * 18,60`) бросает `PermissionDenied("PERMISSION_DENIED")`. Рендер
 * `error.message` показал бы оператору «PERMISSION_DENIED».
 */
export const AMEND_PERMISSION_MESSAGE =
  'Недостаточно прав на исправление сдачи. Требуется право daily_report.correct.'

/** 404: `views.py:194-199` шлёт message, но текст экрана свой — конверт может смениться. */
export const AMEND_NOT_FOUND_MESSAGE = 'Сдача не найдена.'

/**
 * 409 `DAY_ALREADY_SUBMITTED` — гонка ДВУХ amendment на один день
 * (`CONSTRAINT_ERROR_MAP`, `exception_handler.py:32,37`): партнёр записал свою
 * версию, пока форма была открыта. Единственный честный выход — перечитать.
 */
export const AMEND_CONFLICT_MESSAGE =
  'День успел измениться: появилась новая версия. Состояние перечитано — откройте исправление заново.'

/** Канал отображения отказа исправления (AC-6). */
export type AmendFailureKind =
  | 'permission'
  | 'not-found'
  | 'validation'
  | 'conflict'
  | 'other'
  | 'silent'

export interface AmendFailureDescription {
  kind: AmendFailureKind
  /** Текст для инлайна; для `silent` — пустой (панель ничего не рисует). */
  message: string
}

/**
 * ⚠️ Порядок ветвления — ДОСЛОВНО как в `describeSubmitFailure`
 * (`daySubmission.ts:237-263`), а НЕ «по `kind`». `ApiError.kind` различает
 * только validation(400)/business_rule(422)/conflict(409)/server(5xx), а
 * **401, 403 и 404 схлопнуты в один `'api'`** — по `kind` их не развести.
 * Поэтому: сначала `kind === 'network'` (единственная ветка, где `status` не
 * существует вовсе — `NetworkError` живёт ВНЕ иерархии `ApiError`), дальше по
 * `status`, и внутри 409 — по `errorCode`.
 *
 * Функция ТОТАЛЬНА: 405/406/415/429 приходят без конверта §36 ⇒
 * `errorCode === null`, и они попадают в `other` с текстом конверта, а не в
 * молчаливую дыру «отказ был, экран пуст».
 *
 * `NO_SUBMISSION_TO_AMEND` (422) отдельной ветки НЕ получает намеренно: по
 * этому роуту он НЕДОСТИЖИМ — существующий pk гарантирует цепочку (ЛОВУШКА №3
 * 5.8b; сам бэк-тест это фиксирует комментарием). Ветка под него была бы
 * вакуумной (урок 5.7c).
 */
export function describeAmendFailure(error: ApiFailure): AmendFailureDescription {
  if (error.kind === 'network') return { kind: 'silent', message: '' }
  // 5xx и 401 уже обслужены: тост useApiMutation и цепь logout providers.tsx.
  // Экран своего сообщения не добавляет — дублирование хуже молчания.
  if (error.status >= 500) return { kind: 'silent', message: '' }
  if (error.status === 401) return { kind: 'silent', message: '' }
  if (error.status === 403) {
    return { kind: 'permission', message: AMEND_PERMISSION_MESSAGE }
  }
  if (error.status === 404) {
    return { kind: 'not-found', message: AMEND_NOT_FOUND_MESSAGE }
  }
  if (error.status === 400) return { kind: 'validation', message: error.message }
  if (error.status === 409 && error.errorCode === 'DAY_ALREADY_SUBMITTED') {
    return { kind: 'conflict', message: AMEND_CONFLICT_MESSAGE }
  }
  return { kind: 'other', message: error.message }
}
