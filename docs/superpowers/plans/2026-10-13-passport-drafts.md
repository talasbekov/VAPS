# Черновики паспорта при сверке и сохранении

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Оператор сверяет посты и историю без потери даты/примечания публикации; во время сохранения не набирает правки, которые отправленный снимок не содержит.

**Architecture:** Оставить publication panel смонтированной с ключом объекта, аналогично существующей форме постов. Фоновая updatedAt не определяет идентичность черновика. Сброс публикации происходит по собственному успешному ответу; отказ сохраняет поля. Оба fieldset блокируют ввод на время соответствующей мутации. Политика доступа, REST payload, неизменяемость версии и общий query lifecycle сохраняются.

**Tech Stack:** Next.js, TanStack Query, Playwright.

**Spec:** Статический обзор выявил открытый ввод после снимка PATCH и условный history/updatedAt-key, стирающий publication draft. Автономная работа UX авторизована до10:00; основные записи не разрешены.

- [x] Browser RED: held PATCH, переход history→posts→history, подтверждённый background GET с updatedAt.
- [x] Минимально исправить mount/собственный reset и pending fieldsets.
- [x] Проверить отказ/повтор, успех/сброс, права, обычный posts draft, desktop/mobile без записей.
- [x] Независимый обзор, gate и production target; настоящий readonly проход паспорта.
- [x] Документы/локальный commit, продолжать работу до10:00.

Мутации тестов перехватываются. Настоящее чтение — с блокировкой всех бизнес-записей. Frozen memory controls, основные данные, backend и договорённые роли не меняются.
