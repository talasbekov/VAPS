# Паспорт после задержки доступа и отказа чтения

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Паспорт ждёт готовую проверку доступа, повторяет чтение на месте и сохраняет оба черновика при временном отказе; недоступный или неверный объект не показывает прежние поля.

**Architecture:** Добавить optional enabled к конкретному hook и использовать готовность auth/permissions существующего guard в странице. Последние данные при временном отказе остаются с формами и LoadFailure/retry.401/403/404 и несовпадающий ID скрывают поля. Context token фактически показанной формы защищает callback и применение поздних результатов; собственные успехи активной формы продолжают работать. Hooks остальных страниц, роль/область сервера и REST payload сохраняются.

**Tech Stack:** Next.js, TanStack Query, Playwright.

**Spec:** Этап18 сохраняет draft при успешных GET, но ранний error return размонтирует формы. Два объектных GET стартуют до object.view. Поздний callback старой формы потенциально сбрасывает вновь открытую; сначала подтвердить браузером.

- [x] Browser RED: held/denied permissions, initial503, cached503 с обоими черновиками, cached401/403/404, initial/cached mismatch ID и late save after denial.
- [x] Минимально исправить ready/enabled, состояния чтения/повтор и context guard; predicate фиксируется на каждое отправленное тело, включая смену object.manage при pending PATCH/POST.
- [x] Target18 PASS, прежние паспорт/кадровые guards, review/typecheck/gate0 и полный production155 PASS/1 SKIP (156 total).
- [x] Настоящий readonly объект2×1440/390/320 с6 browser503 и GET200; итоговые документы и локальный commit.

Записи только перехваченные; основная база, backend и frozen memory controls не меняются. Контроль доступа на сервере остаётся окончательным. Работа до10:00 продолжается.
