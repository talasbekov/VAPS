// Канонические ошибки feature-repository (§8.5/§36) — ЕДИНСТВЕННЫЙ владелец
// таксономии «403 / 404 / 400-поля / 422-правило / 409-конфликт с
// details.conflicts[]». До ревью Этапа 73 определения были скопированы в
// каждой фиче (4-я копия RepositoryConflictError и стала находкой): разъехавшаяся
// форма details молча ломала бы общий протокол ConflictDialog/OVERRIDABLE_CODES.
// Специализированные наследники (напр. dictionaries с полем usage) расширяют
// эти классы, а не копируют их.

export class RepositoryPermissionError extends Error {}
export class RepositoryNotFoundError extends Error {}

/** 400: ошибки полей формы (DRF-подобные details по полям). */
export class RepositoryValidationError extends Error {
  readonly fieldErrors: Record<string, string[]>
  constructor(fieldErrors: Record<string, string[]>) {
    super('validation')
    this.fieldErrors = fieldErrors
  }
}

/** 422: бизнес-правило нарушено — отказ, который нечем обойти. */
export class RepositoryBusinessRuleError extends Error {
  readonly errorCode: string
  constructor(errorCode: string, message: string) {
    super(message)
    this.errorCode = errorCode
  }
}

/** 409: конфликт состояния; overridable-путь включает конверт §36 c
 * `details.conflicts[]` — их перечисляет общий ConflictDialog. */
export class RepositoryConflictError extends Error {
  readonly errorCode: string
  readonly details: Record<string, unknown>
  constructor(errorCode: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.errorCode = errorCode
    this.details = details
  }
}
