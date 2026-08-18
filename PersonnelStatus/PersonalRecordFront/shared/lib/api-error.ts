// Отказ запроса вместе с РАЗОБРАННЫМ телом ответа.
//
// Зачем. Слои api схлопывали 400-ответ в одну строку прямо на месте: тело
// превращалось в «iin: Ensure this value…; division: …» и до формы доезжало
// уже склеенным. Разложить такое по полям невозможно — форма показывала имена
// полей API там, где у неё есть свои подписи.
//
// Здесь тело сохраняется как есть, а раскладкой по полям занимается форма
// (`applyServerErrors` в `shared/lib/form`): она одна знает, какое поле API
// какому полю формы соответствует.

export class ApiRequestError extends Error {
  readonly status: number;
  /** Тело ответа как его вернул сервер: объект, список или строка. */
  readonly payload: unknown;

  constructor(status: number, payload: unknown, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.payload = payload;
  }
}

/**
 * Прочитать неуспешный ответ: JSON, если это JSON, иначе текст.
 *
 * Тело читается ОДИН раз строкой и разбирается уже из неё: `response.json()`
 * поток расходует, и следующий за ним `response.text()` падает на «body
 * already used» — прежний код так и делал, и на не-JSON ответе (страница 502
 * от прокси) терял его целиком.
 */
export async function readApiError(
  response: Response
): Promise<ApiRequestError> {
  const fallback = `Ошибка ${response.status}`;
  let text = "";
  try {
    text = await response.text();
  } catch {
    return new ApiRequestError(response.status, null, fallback);
  }
  if (text === "") return new ApiRequestError(response.status, null, fallback);
  try {
    return new ApiRequestError(response.status, JSON.parse(text), fallback);
  } catch {
    return new ApiRequestError(response.status, text, fallback);
  }
}
