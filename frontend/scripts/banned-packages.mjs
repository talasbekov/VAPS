// Канон-список запрещённых пакетов — ЕДИНЫЙ ИСТОЧНИК для eslint.config.js
// (no-restricted-imports) и scripts/deps-gate.mjs (скан package-lock).
// Источник норм: architecture.md ARCH-FE-010/011/012/014 + чёрный список UI (L249).

// Точные npm-имена (включая scoped-одиночки, чей scope целиком банить нельзя:
// @tanstack/react-query — канон, банится только react-router).
export const BANNED_PACKAGES = [
  // стейт вне канона (ARCH-FE-010: TanStack Query + URL params + useState/useReducer + 2 Context)
  // ревизия 2026-07-07 (ревью 8.2): категория добита представителями сверх исходного перечня
  'zustand',
  'jotai',
  'redux',
  'react-redux',
  'mobx',
  'mobx-react',
  'mobx-react-lite',
  'valtio',
  'recoil',
  'effector',
  'effector-react',
  'nanostores',
  // кодоген клиентов (ARCH-FE-011: только openapi-typescript + свой apiClient)
  'orval',
  // runtime CSS-in-JS (ARCH-FE-014: клиенты 4 ГБ RAM без GPU)
  'styled-components',
  'goober',
  'styled-jsx',
  // роутер вне канона (ARCH-FE-012: React Router plain)
  '@tanstack/react-router',
  // сторонние HTTP-клиенты (ARCH-FE-015: только свой apiClient из shared/api;
  // исполнение заявленного в каноне enforcement, не новая норма — стори 8.4)
  'axios',
  'ky',
  'superagent',
  // чёрный список UI (architecture.md L249)
  'antd',
  'ag-grid-community',
  'ag-grid-enterprise',
  'handsontable',
  'quasar',
  'vuetify',
]

// Целиком запрещённые scope-семейства (любой пакет внутри).
export const BANNED_SCOPES = [
  '@reduxjs',
  '@emotion',
  '@openapitools',
  '@mui',
  '@stitches',
  '@nanostores',
]

// Глобы для eslint no-restricted-imports (пакет + любые subpath-импорты вида zustand/vanilla).
export const BANNED_IMPORT_PATTERNS = [
  ...BANNED_PACKAGES,
  ...BANNED_PACKAGES.map((p) => `${p}/*`),
  ...BANNED_SCOPES.map((s) => `${s}/*`),
]
