import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import compat from 'eslint-plugin-compat'

// Минимальный линт стори 8.1: типы + браузерная совместимость (FF100 из .browserslistrc).
// Полный канон-набор (boundaries, no-restricted-imports, react-hooks и пр.) — стори 8.2.
export default tseslint.config(
  { ignores: ['dist'] },
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
)
