# E30 — сигнал исчерпанных попыток расчёта

Принят локально 2026-09-17. Source a1c2c708d972f6a241a7fc0c3f33a1df3680b398 → main f812453e922e68082ed7c722845caf5ff1cd6296. Independent APPROVE: /tmp/qoldau-settle-signal-review/report.md. На main 251 тест / 41 suite, lint/build PASS, tree совпадает с reviewed source.

## Контракт и применение после отдельного развёртывания

GET /v1/admin/payments/operational-signal через действующий admin bearer FINANCE_CONTROL или SUPERADMIN. Возвращает только signal, state, maxAttempts, currentExhaustedCount, unexpectedContextCount, providerOutcome, observedAt. Нет ID, сумм, карт, провайдерских идентификаторов или персональных данных.

- H: текущий Payment HELD, settleAttempts>=10, по общему неизменённому лимиту sweep.
- E: H с COMPLETED/CANCELLED консультацией. currentExhaustedCount=E.
- X: оставшиеся H, включая отсутствующую консультацию. unexpectedContextCount=X.
- state=alerting при E>0; иначе unknown при X>0; иначе ok. X сохраняется и при alerting.
- providerOutcome всегда not_determined_by_source. ok означает лишь отсутствие E/X в текущем локальном снимке, не банковский успех или финансовое разрешение инцидента. HELD→FAILED тоже выводит запись из E/X.
- Один параметризованный SELECT с LEFT JOIN, без100limit, audit не источник текущего count. Ошибки API/БД не означают ok; нельзя подставлять нули или снимать alert при отсутствии наблюдения.

Потребитель мониторинга должен сохранять оба счётчика и observedAt; alerting требует разбора, unknown — изучения контекста, без автоматических capture/void/reset/retry. Финансовая сверка требует отдельного разрешённого процесса и доказательств: API не сообщает результат банка. Ответственный, период опроса, доставка и эскалация пока не подключены. Bearer не записывать в журналы.

## Проверки и границы

Независимо: targeted17 + guard12 tests; real AppModule DI/HTTP в штатном, admin-first и compiled входе; PG16 125 сочетаний и132 успешных DTO/single-query assertions с SELECT-only ролью. Собственный контейнер и tmpfs удалены. Отчёт восстановлен из сохранённых tool outputs после прерывания; прежние временные raw logs недоступны, причина не установлена. Новые main unit/lint/build выполнены отдельно.

Существующее ограничение parent: импорт PaymentsModule первым может ломать DI PaymentsService→ConsultationsService. Это воспроизведено на parent и source, не новая регрессия; metadata tests не доказывают все порядки импорта. Штатный AppModule проверен. Production startup/нагрузка/провайдер/alert delivery не подтверждены этим срезом. Счётчик может наследоваться между hold, не равен числу отказов банка. Денежные операции/guards/retry policy не менялись; миграций/deploy/push не было.
