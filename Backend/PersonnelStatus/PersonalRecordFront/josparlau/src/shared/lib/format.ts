// Числа с десятичной ЗАПЯТОЙ — единственный владелец записи «8,4» (ревью
// Этапа 73: три byte-идентичные копии `toFixed(1).replace('.', ',')` разошлись
// бы при первом же изменении точности/локали).
export function formatDecimalComma(value: number, digits = 1): string {
  return value.toFixed(digits).replace('.', ',')
}
