/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Каталог сборки — переопределяемый. `next build` в том же каталоге, где
  // работает `next dev`, перетирает общий `.next`: живой стенд начинает
  // отдавать 500 и HTML вместо JSON, а идущий по нему e2e-обход падает с
  // «Unexpected token '<'». Проверочная сборка запускается так:
  //   NEXT_DIST_DIR=.next-build npx next build
  distDir: process.env.NEXT_DIST_DIR || ".next",
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Официальная мера против раздувания webpack в dev (Next 15+). ЗАМЕРЕНО на
    // этом проекте 25.08.2026: старт 1802 → 781 МБ, после трёх проходов по 15
    // маршрутам и HMR-правки 2904 → 2241 МБ. Цена — чуть более долгая
    // компиляция.
    //
    // Здесь НЕТ `preloadEntriesOnStart: false` и `onDemandEntries` с урезанным
    // буфером, хотя документация называет их среди мер: на этом проекте замер
    // выигрыша не показал (старт тот же 781 МБ, под нагрузкой даже хуже —
    // 2697 против 2241 МБ), а буфер в две страницы заставлял бы пересобирать
    // маршруты посреди e2e. Настройка, которая не подтвердилась замером, в
    // конфиге не остаётся.
    webpackMemoryOptimizations: true,
  },
  // Django требует trailing slash в конце URL
  trailingSlash: true,
  async rewrites() {
    // URL бэкенда из переменных окружения
    // - В продакшене: BACKEND_URL=http://10.15.3.187:8100 (из docker-compose)
    // - В dev: BACKEND_URL из .env.local
    const backendUrl =
      process.env.BACKEND_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:8100";

    console.log(
      "🔧 [Next.js Rewrites] Настройка прокси для бэкенда:",
      backendUrl,
      "(NODE_ENV:",
      process.env.NODE_ENV,
      ")"
    );

    return [
      // Проксируем все /api/* запросы на бэкенд, КРОМЕ /api/auth/* (NextAuth роуты)
      // FIX: rewrites срезали завершающий слэш (`:path*` не несёт пустой
      // сегмент) — Django с APPEND_SLASH=False отвечал 404 на каждый прокси-
      // запрос. Слэш возвращён в destination (все пути API — Django-стиля).
      {
        source: "/api/staff_unit/:path*",
        destination: `${backendUrl}/api/staff_unit/:path*/`,
      },
      {
        source: "/api/dictionaries/:path*",
        destination: `${backendUrl}/api/dictionaries/:path*/`,
      },
      {
        source: "/api/statuses/:path*",
        destination: `${backendUrl}/api/statuses/:path*/`,
      },
      {
        source: "/api/employees/:path*",
        destination: `${backendUrl}/api/employees/:path*/`,
      },
      {
        source: "/api/departments/:path*",
        destination: `${backendUrl}/api/departments/:path*/`,
      },
      {
        source: "/api/divisions/:path*",
        destination: `${backendUrl}/api/divisions/:path*/`,
      },
      {
        source: "/api/secondments/:path*",
        destination: `${backendUrl}/api/secondments/:path*/`,
      },
      {
        source: "/api/org-chart/:path*",
        destination: `${backendUrl}/api/org-chart/:path*/`,
      },
      {
        source: "/api/user/:path*",
        destination: `${backendUrl}/api/user/:path*/`,
      },
      {
        source: "/api/notifications/:path*",
        destination: `${backendUrl}/api/notifications/:path*/`,
      },
      {
        source: "/api/dashboard/:path*",
        destination: `${backendUrl}/api/dashboard/:path*/`,
      },
      {
        source: "/api/reports/:path*",
        destination: `${backendUrl}/api/reports/:path*/`,
      },
      {
        source: "/api/feedback/:path*",
        destination: `${backendUrl}/api/feedback/:path*/`,
      },
      // Раздел «Охранные мероприятия» в api-режиме
      // (NEXT_PUBLIC_OPS_DATA_SOURCE=api): в мок-режиме эти же пути
      // перехватывает host-MSW ДО сети, rewrite не мешает.
      {
        source: "/api/operations/:path*",
        destination: `${backendUrl}/api/operations/:path*/`,
      },
      {
        source: "/api/ops/:path*",
        destination: `${backendUrl}/api/ops/:path*/`,
      },
      {
        source: "/api/token",
        destination: `${backendUrl}/api/token/`,
      },
      {
        source: "/api/token/",
        destination: `${backendUrl}/api/token/`,
      },
      {
        source: "/api/token/:path*",
        destination: `${backendUrl}/api/token/:path*/`,
      },
    ];
  },
};

module.exports = nextConfig;
