import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import compat from 'eslint-plugin-compat'
import boundaries from 'eslint-plugin-boundaries'
import reactHooks from 'eslint-plugin-react-hooks'
import prettierConfig from 'eslint-config-prettier'
import { BANNED_IMPORT_PATTERNS } from './scripts/banned-packages.mjs'

const BAN_MESSAGE =
  'Запрещено каноном ARCH-FE (architecture.md §Канон фронтенд-стека); список — scripts/banned-packages.mjs'

// Стори 8.1: типы + браузерная совместимость (FF100 из .browserslistrc).
// Стори 8.2: канон-набор ARCH-FE — boundaries (010/013), no-restricted-imports
// (010/011/012/014 + чёрный список UI), react-hooks: error, prettier-совместимость.
// Краснота канона доказывается scripts/lint-canon.test.mjs (в гейте).
export default tseslint.config(
  // __canon_* — временные фикстуры lint-canon: невидимы для `eslint .` (и IDE),
  // сам самотест линтит их принудительно через ignore:false; сироты не валят гейт
  { ignores: ['dist', 'src/**/__canon_*/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ...compat.configs['flat/recommended'],
  },
  {
    // ARCH-FE-013: матрица слоёв. app → всё; features → shared + та же фича;
    // shared → только shared. Кросс-фичевые импорты и shared→features/app — бан.
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      // без .ts/.tsx резолвер не находит цель импорта → зависимость unknown → правило молчит;
      // .d.ts — для импорта типов из генерённого schema.d.ts (8.4)
      'import/resolver': {
        node: { extensions: ['.js', '.mjs', '.ts', '.tsx', '.d.ts'] },
      },
      'boundaries/include': ['src/**/*'],
      'boundaries/elements': [
        { type: 'app', pattern: 'src/app/**' },
        { type: 'features', pattern: 'src/features/*', capture: ['feature'] },
        { type: 'shared', pattern: 'src/shared/**' },
      ],
    },
    rules: {
      // файл вне app/features/shared — не «вне матрицы», а нарушение:
      // без этих правил размещение кода в src/lib и т.п. обходит всю матрицу молча
      'boundaries/no-unknown-files': 'error',
      'boundaries/no-unknown-dependencies': 'error',
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          // v7 handlebars-контекст: from/to (file/dependency — легаси ${...}-ключи, рендерились пусто)
          message:
            'Нарушение матрицы слоёв ARCH-FE-013 ({{from.type}} → {{to.type}})',
          policies: [
            {
              from: { element: { types: 'app' } },
              allow: {
                to: {
                  element: { types: { anyOf: ['app', 'features', 'shared'] } },
                },
              },
            },
            {
              from: { element: { types: 'features' } },
              allow: {
                to: {
                  element: [
                    { types: 'shared' },
                    // та же фича: capture из settings-паттерна src/features/*
                    {
                      types: 'features',
                      captured: { feature: '{{from.feature}}' },
                    },
                  ],
                },
              },
            },
            {
              from: { element: { types: 'shared' } },
              allow: { to: { element: { types: 'shared' } } },
            },
          ],
        },
      ],
    },
  },
  {
    // Канон-баны пакетов (@typescript-eslint-вариант ловит и `import type`).
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [{ group: BANNED_IMPORT_PATTERNS, message: BAN_MESSAGE }] },
      ],
    },
  },
  {
    // ARCH-FE-015 впрок: мутации в фичах только через useApiMutation (shared/api, стори 8.5);
    // правило спит до установки @tanstack/react-query (8.4). Переопределение целиком —
    // конфиг правила не мержится, поэтому баны пакетов продублированы.
    files: ['src/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tanstack/react-query',
              importNames: ['useMutation'],
              message:
                'В features — только useApiMutation из shared/api (ARCH-FE-015)',
            },
          ],
          patterns: [{ group: BANNED_IMPORT_PATTERNS, message: BAN_MESSAGE }],
        },
      ],
    },
  },
  {
    // ARCH-FE-015 (стори 8.4): HTTP — только через apiClient из shared/api.
    // Глобалы fetch/XMLHttpRequest и window/globalThis.{fetch,XMLHttpRequest} вне
    // src/shared/api забанены (property-каналы XHR — ревью 8.4: бан глобала обходился
    // через window.XMLHttpRequest); block-scoped ignores живут и под ignore:false
    // самотеста (Ловушка 8), краснота по каждому каналу + негативный контроль
    // (fetch ВНУТРИ shared/api зелёный) — lint-canon.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/shared/api/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message:
            'HTTP только через apiClient из shared/api (ARCH-FE-015: парсинг статусов и конверта ошибок — в одной точке)',
        },
        {
          name: 'XMLHttpRequest',
          message: 'HTTP только через apiClient из shared/api (ARCH-FE-015)',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'fetch',
          message: 'HTTP только через apiClient из shared/api (ARCH-FE-015)',
        },
        {
          object: 'globalThis',
          property: 'fetch',
          message: 'HTTP только через apiClient из shared/api (ARCH-FE-015)',
        },
        {
          object: 'window',
          property: 'XMLHttpRequest',
          message: 'HTTP только через apiClient из shared/api (ARCH-FE-015)',
        },
        {
          object: 'globalThis',
          property: 'XMLHttpRequest',
          message: 'HTTP только через apiClient из shared/api (ARCH-FE-015)',
        },
      ],
    },
  },
  {
    // react-hooks: error (architecture L244, блок «анти-смерть на 4 ГБ») — оба правила error.
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    // node-скрипты вне src (size-gate, deps-gate, lint-canon, сам конфиг)
    files: ['**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
  // eslint-config-prettier ПОСЛЕДНИМ: гасит стилистические правила, конфликтующие с prettier
  prettierConfig,
)
