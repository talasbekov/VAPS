# E30: текущий payment.settle_exhausted — минимальный read-only срез

Статус: предложение источника наблюдаемости, не implementation/review approval.
Base/HEAD: 7418a8023c6c2542aa9ae43ab83b6ff7d704cbf8; ссылки ниже относительно repo.
Основание: vault/WIKI/planning/14_ROADMAP_AND_BACKLOG.md:79–80.
Общая /tmp/qoldau-ops-signals-plan.md прочитана; её выбор очереди не пересматривается.

## Выбор и доказательства

Один GET `admin/payments/operational-signal` в PaymentsModule: агрегат текущей БД.
AuditLog — история, а не очередь нерешённых случаев; использовать его как источник
count нельзя. У него только индекс entity/entityId (backend/prisma/schema.prisma:84–95).
Счётчик фиксируется ДО audit отдельным await: обрыв оставляет attempts>=10 без события
(backend/src/payments/settle-retry.service.ts:147–165); возможны и повторные события.
Лимит 10, HELD и COMPLETED/CANCELLED взяты из действующего sweep, не из новой политики
(backend/src/payments/settle-retry.service.ts:14,84–111).

Точные множества для одного согласованного снимка:
- H = Payment.status=HELD AND Payment.settleAttempts >= SETTLE_MAX_ATTEMPTS (=10).
- E = H AND связанная по consultationId Consultation.status IN (COMPLETED,CANCELLED).
- X = H вне E: консультация ACTIVE/SCHEDULED либо отсутствует.
`currentExhaustedCount = |E|`; `unexpectedContextCount = |X|` — отдельная диагностика,
не утверждение, что в X уже требовался settle. Не прятать X за INNER JOIN.
E — текущее локально незавершённое settle с исчерпанным бюджетом sweep, требующее разбора.
Ни audit, ни дата, ни providerHoldId, ни зеркало consultation.paymentStatus не фильтруют E:
отсутствующее/несогласованное значение не должно скрыть исчерпание текущего бюджета.
Для count не нужен outcome: он выбирает capture/void внутри settle, а sweep — status
(backend/src/payments/payments.service.ts:407–427). Не выводить денежное действие из статуса.

## Переходы, reset и предел точности

- Создание: settleAttempts=0, lastSettleAttemptAt=NULL по defaults
  (backend/prisma/schema.prisma:493–494); счётчик растёт только в recordFailedAttempt.
- Первичный settle после исхода не увеличивает этот счётчик: catch пишет settle_failed
  (backend/src/consultations/consultations.service.ts:398–423).
- Sweep увеличивает при исключении либо оставшемся HELD; catch может сработать уже после
  коммита CAPTURED/VOIDED, например при ошибке audit. Поэтому attempts не число отказов банка
  (backend/src/payments/settle-retry.service.ts:118–141;
  backend/src/payments/payments.service.ts:462–492,525–541).
- Успешные capture/void меняют Payment и зеркало, attempts/lastAttempt НЕ обнуляют
  (backend/src/payments/payments.service.ts:462–470,525–534): строка выходит из E по status.
- HELD→FAILED по bank webhook тоже выводит из E, сохраняя счётчик; это не доказательство
  финансового разрешения: для оказанной услуги есть отдельный hold_voided_after_completion
  (backend/src/payments/payments-webhook.controller.ts:109–162).
- Pay разрешён только ACTIVE/SCHEDULED; FAILED→PENDING повторно использует Payment,
  увеличивает holdAttempts, но НЕ сбрасывает settleAttempts/lastSettleAttemptAt;
  успех PENDING→HELD тоже не сбрасывает их
  (backend/src/payments/payments.service.ts:85–107,198–210,278–300).
- Rehold выбирает HELD с ACTIVE/SCHEDULED, меняет hold id/date/reholdCount; не сбрасывает
  settleAttempts/lastAttempt. Неуспех меняет status на FAILED
  (backend/src/payments/settle-retry.service.ts:175–203,264–271,296–304).
- Исходы переводят ACTIVE→COMPLETED и ACTIVE/SCHEDULED→CANCELLED до вызова settle
  (backend/src/consultations/consultations.service.ts:232–240,276,324–336;
  backend/src/booking/booking.service.ts:360–365,405).
- В просмотренных путях нет reset счётчика и возврата завершённой консультации в активную.
  При унаследованном attempts>=10 новый HELD с terminal-консультацией снова входит в E:
  именно действующий sweep его исключает. Нельзя назвать это «10 ошибок нового холда».
- Лимит ограничивает выборку sweep, не любой вызов settle
  (backend/src/payments/payments.service.ts:371–427). Сигнал не обещает отсутствие in-flight.

Текущих полей достаточно для E/X, но нет признака reconciliation/resolution/ack,
поколения settle-счётчика или точного момента исчерпания. lastSettleAttemptAt — последняя
учтённая попытка, не exhaustedAt; updatedAt/holdCreatedAt тоже не заменяют его.
Не добавлять возраст/SLA, дедуп инцидентов или «разрешено оператором» в этот срез.
HELD не доказывает состояние банка: capture/void вызываются ДО локального коммита
(backend/src/payments/payments.service.ts:443–447,462,517–525).
Порт не предоставляет read/reconcile результата (backend/src/payments/provider/payment-provider.port.ts:4–44).
Исчерпание бюджета достоверно локально; исход у провайдера неизвестен этому источнику.

## Контракт и реализация следующего среза

Ответ 200: { signal: 'payment.settle_exhausted', state: 'alerting'|'ok'|'unknown',
  maxAttempts: 10, currentExhaustedCount: integer, unexpectedContextCount: integer,
  providerOutcome: 'not_determined_by_source', observedAt: ISO-8601 UTC }.
`state=alerting` при E>0; иначе `unknown` при X>0; иначе `ok`.
unknown здесь означает неклассифицируемый контекст HELD, а не банковский результат;
providerOutcome одинаков во всех ответах. ok означает только отсутствие E/X на снимке.
Ошибка запроса/недоступность API — non-2xx, не подставлять нули/ok;
потребитель трактует её как отсутствие наблюдения, не снимает alert по такой ошибке.
Переход к ok не называть финансовым разрешением, включая переход HELD→FAILED.
Нет ID/списков, сумм, карт, provider id, токенов, failReason или audit payload в ответе.

Один параметризованный SELECT агрегата по payments LEFT JOIN consultations (PK id),
с WHERE для H и условными count E/X: одинаковый snapshot, полный count без SWEEP_BATCH=100.
Prisma relation здесь нет (backend/src/payments/settle-retry.service.ts:75–79), поэтому
не закладывать несуществующий relation-filter. SQL статический, без пользовательских фильтров.
Существующий индекс Payment(status,holdCreatedAt) имеет ведущий status
(backend/prisma/schema.prisma:499); новая миграция/индекс AuditLog для этого не требуются.
Это не доказательство быстродействия на prod: объём HELD и query plan сейчас неизвестны.
Лимит должен иметь один источник с sweep (вынести существующую константу без смены значения).

## Ownership, acceptance и открытые вопросы

Backend Payments владеет read-service/DTO/controller и регистрацией в PaymentsModule
(backend/src/payments/payments.module.ts:27–52); read-service зависит только от Prisma/Clock.
Доступ: AdminJwtGuard + RolesGuard + @Roles(FINANCE_CONTROL), по существующему образцу
backend/src/payouts/payouts-admin.controller.ts:37–44; SUPERADMIN сохраняет доступ
по backend/src/admin/roles.guard.ts:26–42. Не создавать новую auth/machine-identity границу.
Предлагаемый адресат разбора — финконтроль; E30/эксплуатация владеет потребителем сигнала.
Конкретный ответственный, polling/доставка/эскалация и доступ мониторинга через существующую
админскую границу не определены; это не даёт разрешения на денежные действия.

Acceptance будущей реализации (сейчас тесты не запускались):
- HELD + COMPLETED/CANCELLED, attempts=10 и >10 входят; 9 не входит.
- Audit отсутствует/дублирован/старый: count не меняется; NULL lastAttempt не скрывает E.
- CAPTURED/VOIDED/FAILED/PENDING с attempts>=10 или старым audit не входят в E/X.
- ACTIVE/SCHEDULED/отсутствующая консультация при H дают X; проверить приоритет alerting.
- История rehold/pay/reset не используется; текущие status/attempts определяют снимок.
- Более 100 подходящих строк учитываются полностью; нулевой снимок и ошибки различимы.
- FINANCE_CONTROL/SUPERADMIN разрешены; остальные роли/неавторизованный доступ отклонены.
- DTO строго агрегированный; нет вызовов provider, settle, sweep, audit/write или ledger.
Без миграций, изменения денег/retry/reset, новых cron/UI/политик/ручного resolution.
Код/БД/vault не изменялись; инфраструктура, провайдеры, секреты, E29/Redis reviews не трогались.

## Решение оркестратора

2026-09-17: контракт принят для ограниченной реализации источника наблюдаемости. Root сверил HELD/attempts/sweep terminal predicate, схему и FINANCE_CONTROL образец; политика расчётов не меняется. ok не означает финансовую сверку или разрешение инцидента. Нужны independent review и проверка exact SQL на disposable PG16.
