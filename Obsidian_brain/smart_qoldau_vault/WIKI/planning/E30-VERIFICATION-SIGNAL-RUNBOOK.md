# E30 — сигнал просроченной верификации

Принят локально 2026-09-17: source d3e63cbb3d64620d43fee8a047c56ee4048da22d → main 7418a8023c6c2542aa9ae43ab83b6ff7d704cbf8. Независимое APPROVE: /tmp/qoldau-verification-signal-review/report.md. На объединённом main 234 теста / 38 suites, lint/build PASS. Независимо exact service query проверен на disposable PostgreSQL16, ресурсы удалены.

## Использование после отдельного развёртывания

GET /v1/admin/verification/operational-signal, действующий admin bearer с ролью VERIFICATION_OPERATOR. Права и guard-политика не менялись. Ответ содержит только signal, state, thresholdHours, overdueCount, oldestPendingAgeSeconds, missingSubmittedAtCount, observedAt; персональные данные и ссылки на документы отсутствуют.

- signal: verification.queue_over_24h. state=alerting только при overdueCount>0.
- Считаются PENDING со временем отправки строго старше24ч; ровно24ч не нарушение. Повторная отправка начинает новый отсчёт.
- NULL submittedAt учитывается отдельно в missingSubmittedAtCount; это качество данных, не подтверждённая просрочка.
- oldestPendingAgeSeconds: возраст самой старой PENDING с известным временем, floor секунд; null если таких нет, 0 для будущего времени.
- Один момент ClockService и один агрегатный SELECT обеспечивают согласованность ответа.

Мониторинг должен открывать/поддерживать alert по alerting и снимать только после следующего успешного ok. Не-2xx, пропущенный опрос или устаревшее observedAt не означают ok: это недоступность/несвежесть источника. Конкретные cadence, credentials lifecycle и routing ещё не настроены. Не помещать bearer в журналы или команды с общедоступными аргументами.

## Границы приёмки

Принят только источник сигнала; расписание, доставка уведомлений, централизованный мониторинг и production rollout остаются открыты. Сервис не меняет очередь и решения верификации. Нет новых миграций, изменений денег/авторизации, внешних сообщений или deploy. Остальные E30 сигналы не закрыты этим срезом.
