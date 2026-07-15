import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import compat from 'eslint-plugin-compat'
import boundaries from 'eslint-plugin-boundaries'
import reactHooks from 'eslint-plugin-react-hooks'
import tailwindcss from 'eslint-plugin-tailwindcss'
import prettierConfig from 'eslint-config-prettier'
import { BANNED_IMPORT_PATTERNS } from './scripts/banned-packages.mjs'

const BAN_MESSAGE =
  'Запрещено каноном ARCH-FE (architecture.md §Канон фронтенд-стека); список — scripts/banned-packages.mjs'

const ROUTE_LITERAL_MESSAGE =
  'Literal-путь запрещён (ARCH-FE-012): используйте константы ROUTES из shared/routes.ts'

// ARCH-FE-012 (8.7): общий набор селекторов literal-путей. Константой — чтобы
// print-forms-блок (8.8), переопределяя no-restricted-syntax (flat config не
// мержит конфиг правила), не потерял канон маршрутов.
const ROUTE_LITERAL_SELECTORS = [
  {
    selector: "JSXAttribute[name.name='to'] > Literal",
    message: ROUTE_LITERAL_MESSAGE,
  },
  {
    selector: "JSXAttribute[name.name='to'] > JSXExpressionContainer > Literal",
    message: ROUTE_LITERAL_MESSAGE,
  },
  {
    selector: "JSXAttribute[name.name='path'] > Literal",
    message: ROUTE_LITERAL_MESSAGE,
  },
  {
    selector:
      "JSXAttribute[name.name='path'] > JSXExpressionContainer > Literal",
    message: ROUTE_LITERAL_MESSAGE,
  },
  {
    selector:
      "CallExpression[callee.name='navigate'][arguments.0.type='Literal']",
    message: ROUTE_LITERAL_MESSAGE,
  },
  {
    selector:
      "JSXAttribute[name.name='to'] > JSXExpressionContainer > TemplateLiteral[expressions.length=0]",
    message: ROUTE_LITERAL_MESSAGE,
  },
  {
    selector:
      "JSXAttribute[name.name='path'] > JSXExpressionContainer > TemplateLiteral[expressions.length=0]",
    message: ROUTE_LITERAL_MESSAGE,
  },
  {
    selector:
      "CallExpression[callee.name='navigate'][arguments.0.type='TemplateLiteral'][arguments.0.expressions.length=0]",
    message: ROUTE_LITERAL_MESSAGE,
  },
]

const PRINT_CANON_MESSAGE =
  'Печатный канон (ARCH-FE-014 / architecture L255): в print-forms className — только строковый литерал из print-*-классов; UI-слой на бумагу не попадает'

const PRINT_IMPORT_MESSAGE =
  'Печатный канон (ARCH-FE-014 / architecture L255): UI-слой (shared/ui, lucide-react) на бумагу не попадает — печатные формы = голый семантический HTML + print.css'

// Печатный канон 8.8: className в print-forms — ТОЛЬКО строковый литерал,
// целиком состоящий из print-*-классов. Динамика (включая шаблонные литералы
// и cn/cva) красная селектором JSXExpressionContainer целиком; литерал с
// не-print-классом (в т.ч. подмешанным: "print-root flex") — regex-селектором
// (\s вместо пробела — esquery-парсер).
const PRINT_CANON_SELECTORS = [
  {
    selector: "JSXAttribute[name.name='className'] > JSXExpressionContainer",
    message: PRINT_CANON_MESSAGE,
  },
  {
    selector:
      "JSXAttribute[name.name='className'] > Literal[value!=/^print-[a-z0-9-]+(\\sprint-[a-z0-9-]+)*$/]",
    message: PRINT_CANON_MESSAGE,
  },
]

// Стори 8.1: типы + браузерная совместимость (FF100 из .browserslistrc).
// Стори 8.2: канон-набор ARCH-FE — boundaries (010/013), no-restricted-imports
// (010/011/012/014 + чёрный список UI), react-hooks: error, prettier-совместимость.
// Краснота канона доказывается scripts/lint-canon.test.mjs (в гейте).
export default tseslint.config(
  // __canon_* — временные фикстуры lint-canon: невидимы для `eslint .` (и IDE),
  // сам самотест линтит их принудительно через ignore:false; сироты не валят гейт
  { ignores: ['dist', 'dist-e2e', 'src/**/__canon_*/**'] },
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
      // css — ассет, не слой: вход Tailwind src/index.css (8.7) импортируется
      // из app/main.tsx и не должен считаться «unknown element»
      'boundaries/ignore': ['**/*.css'],
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
    // ARCH-FE-012 ужесточение (стори 8.7, обещание 8.6 AC-8): строковые
    // literal-пути в <Link to>/<Navigate to>/<Route path>/navigate() запрещены —
    // только константы ROUTES из shared/routes.ts. Сам routes.ts исключён
    // (константы-строки — его содержимое); тесты исключены ОСОЗНАННО: канон
    // правит продукт-код, тестам синтетические маршруты легальны (Ловушка 9,
    // guards.test.tsx path="/secret"). Шаблонный литерал БЕЗ подстановки —
    // тот же literal-канал (обход бана, ревью 8.7) и тоже красный; шаблоны
    // С подстановкой (`${ROUTES.x}?tab=…`) и MSW-строки URL селекторы не задевают.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/shared/routes.ts', 'src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...ROUTE_LITERAL_SELECTORS],
    },
  },
  {
    // ARCH-FE-014 enforcement (стори 8.7): токен-классы донора, никакого
    // не-токенного произвола. Конфиг — абсолютным путём через fileURLToPath
    // (кириллица в пути репо, закреплённый урок 8.1–8.6); callees — cn/cva
    // (склейка и варианты shadcn-компонентов).
    files: ['src/**/*.{ts,tsx}'],
    plugins: { tailwindcss },
    settings: {
      tailwindcss: {
        config: fileURLToPath(new URL('./tailwind.config.js', import.meta.url)),
        callees: ['cn', 'cva', 'clsx'],
        // print.css исключён из скана известных классов (8.8): иначе plugin
        // считал бы .print-root легальным ВЕЗДЕ — print-* классы разрешены
        // только в print-forms (whitelist блоком ниже), утечка на UI красная
        cssFiles: [
          '**/*.css',
          '!**/node_modules',
          '!**/.*',
          '!**/dist',
          '!**/build',
          '!src/features/print-forms/**',
        ],
      },
    },
    rules: {
      'tailwindcss/no-contradicting-classname': 'error',
      'tailwindcss/no-custom-classname': 'error',
    },
  },
  {
    // Печатный канон 8.8 (ARCH-FE-014/L255), продукт-код print-forms:
    // route-селекторы сохранены (переопределение целиком — конфиг правила
    // не мержится) + className-канон. Тесты print-forms — блоком ниже
    // (канон маршрутов правит продукт-код, тестам синтетика легальна — 8.7).
    files: ['src/features/print-forms/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...ROUTE_LITERAL_SELECTORS,
        ...PRINT_CANON_SELECTORS,
      ],
    },
  },
  {
    // className-канон печати действует и в тестах print-forms (печатная
    // разметка не имеет права на UI-классы нигде в слоте).
    files: ['src/features/print-forms/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...PRINT_CANON_SELECTORS],
    },
  },
  {
    // «UI-слой на бумагу не попадает»: импорт shared/ui и lucide-react в
    // print-forms красный. Переопределение целиком — баны пакетов и
    // useMutation-канон (ARCH-FE-015) продублированы из features-блока.
    files: ['src/features/print-forms/**/*.{ts,tsx}'],
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
          patterns: [
            { group: BANNED_IMPORT_PATTERNS, message: BAN_MESSAGE },
            {
              group: ['**/shared/ui/*', 'lucide-react', 'lucide-react/*'],
              message: PRINT_IMPORT_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  {
    // Whitelist print-* ТОЛЬКО для print-forms (глобальный канон
    // no-custom-classname НЕ ослаблен — Ловушка 5); settings.tailwindcss
    // замещается целиком, поэтому config/callees продублированы.
    files: ['src/features/print-forms/**/*.{ts,tsx}'],
    settings: {
      tailwindcss: {
        config: fileURLToPath(new URL('./tailwind.config.js', import.meta.url)),
        callees: ['cn', 'cva', 'clsx'],
        whitelist: ['print\\-.*'],
      },
    },
    rules: {
      'tailwindcss/no-contradicting-classname': 'error',
      'tailwindcss/no-custom-classname': 'error',
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
