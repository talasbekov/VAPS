// Примитивы УЗКОЙ проекции чужого слайса (ARCH-FE-013: фичи не импортируют
// чужие mocks, поэтому читают снимок defensive-коэрцией). До ревью Этапа 73
// эти два хелпера были скопированы в шести проекциях — при дрейфе формы
// чужого поля каждая копия деградировала бы по-своему.
export function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}
