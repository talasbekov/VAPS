/**
 * Учётка стенда для проб. ОДНО место правды вместо литерала в каждом спеке.
 *
 * Пароль приходит из `SMOKE_PASSWORD` — его кладёт `playwright.smoke.config.ts`,
 * читая файл `~/.config/vaps/stand-admin-password` (права 600, вне репозитория).
 * Пустая строка означает «файла нет и переменная не задана» — проба тогда
 * упадёт на входе с внятным «пароль стенда не задан», а не будет молча
 * стучаться общеизвестным паролем.
 */
export const STAND_USERNAME = process.env.SMOKE_USERNAME ?? 'admin'
export const STAND_PASSWORD = process.env.SMOKE_PASSWORD ?? ''

if (STAND_PASSWORD === '') {
  throw new Error(
    'Пароль стенда не задан: положите его в ~/.config/vaps/stand-admin-password ' +
      'или передайте SMOKE_PASSWORD.',
  )
}
