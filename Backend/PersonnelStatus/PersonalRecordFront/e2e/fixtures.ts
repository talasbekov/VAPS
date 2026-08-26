/**
 * Требование фикстуры стенда (Plane №75).
 *
 * ЗАЧЕМ. Пробы искали на стенде ОМ нужной стадии и, не найдя, уходили в
 * `test.skip`. В отчёте это «-», в сумме прогона — «3 skipped», и читается оно
 * как зелень: шесть проб месяцами НИЧЕГО не проверяли, потому что фикстур для
 * них никто не заводил. Скип — законный ответ на «этой среды нет вовсе»
 * (нет мок-сервера, нет SMOKE_LIVE), но не на «данные должны быть, а их нет».
 *
 * Теперь фикстуры заводит `manage.py seed_smoke_fixtures`, и отсутствие данных
 * — это НЕ повод молчать: проба падает и говорит, чего не хватает и чем это
 * чинится.
 */
export const SEED_COMMAND =
  '.venv/bin/python manage.py seed_smoke_fixtures ' +
  '--settings=organization_management.config.settings.local_postgres'

/** Возвращает значение или падает с внятной причиной. */
export function requireFixture<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) {
    throw new Error(
      `на стенде нет фикстуры: ${what}. Это не повод для скипа — фикстуры ` +
        `заводятся из корня бэкенда:\n  ${SEED_COMMAND}`,
    )
  }
  return value
}
