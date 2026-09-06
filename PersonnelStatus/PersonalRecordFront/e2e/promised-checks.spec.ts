/**
 * Проект не обещает проверок, которых у него нет (Plane №915).
 *
 * 🔴 ЧТО БЫЛО. `.eslintrc.json` перечислял правила (`next/core-web-vitals`,
 * `@typescript-eslint/recommended`, `no-unused-vars`, `prefer-const`), а
 * `package.json` объявлял скрипт `lint: next lint` — при том, что ни `eslint`,
 * ни плагинов нет в зависимостях и `node_modules/.bin/eslint` отсутствует.
 * Файл описывал линтер, которого в проекте нет.
 *
 * ЧЕМ ЭТО ПЛОХО НЕ ПО ФОРМЕ, А ПО ДЕЛУ. Правило проекта — «код, который врёт
 * про себя, — дефект»; здесь враньё стоило работы: класс «элемент списка без
 * ключа» пришлось закрывать РУЧНЫМ сторожем на разборе исходников
 * (`react-list-keys.spec.ts`), тогда как правило `react/jsx-key` закрывает
 * его на уровне AST целиком. Читающий `.eslintrc.json` был вправе считать,
 * что этот класс уже стережётся.
 *
 * 🔴 ЭТА ПРОБА НЕ ЗАПРЕЩАЕТ ЛИНТЕР. Она запрещает РАСХОЖДЕНИЕ: конфиг и
 * скрипт допустимы ровно тогда, когда пакет действительно объявлен в
 * зависимостях. Внесут `eslint` — проба зеленеет и на конфиге, и на скрипте;
 * появится конфиг без пакета — краснеет.
 *
 * Читает файлы, а не запускает сборку: без `SMOKE_LIVE` даёт «passed», а не
 * «skipped» — тот же приём, что у `right-hint-pattern` и `date-format-contract`.
 */
import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')

function declaresEslint(): boolean {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  return Object.keys(all).includes('eslint')
}

test.describe('обещанные проверки', () => {
  test('конфиг линтера есть только вместе с самим линтером', () => {
    const configs = readdirSync(ROOT).filter((name) => name.startsWith('.eslintrc'))
    const flat = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.ts'].filter((name) =>
      existsSync(join(ROOT, name)),
    )
    const present = [...configs, ...flat]

    if (declaresEslint()) {
      expect(
        present.length,
        'eslint объявлен в зависимостях, но конфига нет — он не применится',
      ).toBeGreaterThan(0)
      return
    }
    expect(
      present,
      'конфиг линтера есть, а самого линтера в зависимостях нет: файл ' +
        'обещает проверку, которой не существует (Plane №915)',
    ).toEqual([])
  })

  test('скрипт lint объявлен только вместе с линтером', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    const hasScript = Object.keys(pkg.scripts ?? {}).includes('lint')

    expect(
      hasScript && !declaresEslint(),
      'в package.json объявлен скрипт lint, а eslint не установлен: ' +
        'команда не работает и обещает проверку, которой нет (Plane №915)',
    ).toBe(false)
  })
})
