# Загрузка и восстановление кадровой формы из ссылки

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Кадровая ссылка явно показывает загрузку/отказ и повторяет чтение без потери фильтров; недоступный или неверный сотрудник не открывает чужую форму.

**Architecture:** Проверить ID и соответствие ответа, различать отказ доступности и временный сбой. Подтверждённый403/404 скрывает прежнюю форму. Временный503 при уже открытом редакторе сохраняет черновик и показывает доступный повтор внутри диалога. Существующие authority keys, staffing/payload/rights и pending guards остаются.

**Tech Stack:** Next.js, TanStack Query, Playwright.

**Spec:** Продолжение `2026-10-12-overnight-ux-design.md`, этап15; исходный URL editor failure показывает только строку без retry и продолжает использовать cached data.

- [x] Браузером воспроизвести pending/initial failure и cached access denial на текущей production.
- [x] Добавить явные состояния/повтор/валидность ID и безопасное соответствие ответа.
- [x] Проверить сохранность черновика при503, отказ403/404, invalid/mismatch, context URL, прежние кадровые guards.
- [x] Обзор, typecheck/gate, production target и настоящий readonly проход.
- [x] Документы/локальный commit; продолжать до10:00.

Все бизнес-запросы новых проверок блокируются или перехватываются. Основная база и payload не меняются.
