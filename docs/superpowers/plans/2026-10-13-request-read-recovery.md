# Повтор чтения заявок без ухода с экрана

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** После отказа сети оператор повторяет загрузку списка/карточки заявки на силы в том же рабочем контексте.

**Architecture:** Использовать существующий LoadFailure с refetch/isFetching в обеих error-ветках. Сохранить request/view/tab/день и фильтры, не менять источники/квоты/решения/права/публикации. Повтор pending заблокирован; подтверждённый пустой список отделён от ошибки.

**Tech Stack:** Next.js, TanStack Query, Playwright.

**Spec:** Read-only UX review выявил error-only список и error+Back карточку без refetch; window focus в provider не перечитывает данные. Автономная работа авторизована до10:00.

- [x] Browser RED отсутствия повтора списка и карточки после фактического отказа GET.
- [x] Минимально добавить LoadFailure/refetch/isFetching.
- [x] Проверить held повтор, восстановление в том же URL, error/empty и отсутствие записей.
- [x] Review/typecheck/gate/production target и настоящая readonly навигация по доступной заявке.
- [x] Документы/локальный commit, продолжать до10:00.

Бизнес-записи заблокированы либо перехвачены; основная БД и frozen memory controls не меняются.
