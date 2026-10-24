# E30 — минимальный следующий срез эксплуатационных сигналов (read-only план)

Статус: исследовательская записка, не implementation и не review approval.
Base: `caaaa844180ba807d296b815728083b261f093e5`.

## Выбор: один сигнал `verification.queue_over_24h`

Первым следует сделать только машинно-читаемый сигнал просроченной очереди
верификации. Это единственный из четырёх названных в E30 сигналов, для
которого уже одновременно есть: (1) утверждённый порог `>24 ч`, (2) точная
персистентная точка начала отсчёта и (3) однозначный открытый статус.

Обоснование по коду:

- E30 прямо называет «очередь верификации >24 ч» среди алертов
  (`14_ROADMAP_AND_BACKLOG.md:79-80`).
- При отправке анкеты `verificationSubmittedAt` ставится из `ClockService`,
  именно как начало SLA 24 ч; повторная отправка перезапускает отсчёт
  (`backend/src/experts/documents.service.ts:111-120`).
- Модель хранит это поле отдельно от регистрации и поясняет, почему
  `createdAt` для SLA неверен (`backend/prisma/schema.prisma:151-157`).
- Рабочая очередь уже выбирает только `PENDING` и сортирует по этой отметке
  (`backend/src/verification/verification.service.ts:43-59`). Поэтому условие
  `PENDING AND verificationSubmittedAt < now - 24h` достоверно; записи с
  `NULL` не объявлять просроченными, а возвращать отдельным счётчиком
  `missingSubmittedAt` для оператора.

## Предлагаемый scope и ownership

Небольшой read-only endpoint в существующем `verification`-модуле, например
`GET /admin/verification/operational-signal`, доступный
`VERIFICATION_OPERATOR`. Он возвращает один агрегированный сигнал, а внешний
операционный мониторинг создаёт/снимает alert по `state`. Это не меняет
верификационные решения, деньги, авторизацию или бизнес-правила.

Владелец и вероятные файлы:

- `backend/src/verification/verification.service.ts` — один Prisma aggregate/
  group query через `ClockService`; не переиспользовать `queue()`, так как та
  включает PII и подписанные URL (`:43-68`).
- `backend/src/verification/verification.controller.ts` — маршрут рядом с
  очередью, существующие `AdminJwtGuard`, `RolesGuard` и
  `VERIFICATION_OPERATOR` (`:39-52`).
- `backend/src/verification/verification.module.ts` — без нового модуля;
  текущий владелец уже содержит service/controller (`:12-27`).
- Новый DTO и unit/service-spec в `backend/src/verification/dto/` и
  `backend/src/verification/`.

Не добавлять миграцию, cron/worker, Redis, UI, webhook или alert-provider в
этот срез. Частота опроса и маршрутизация уведомления остаются ответственностью
платформы централизованных логов/мониторинга; они не определены в E30.

## Контракт без PII

Пример стабильного ответа:

```json
{
  "signal": "verification.queue_over_24h",
  "state": "alerting",
  "thresholdHours": 24,
  "overdueCount": 3,
  "oldestPendingAgeSeconds": 90123,
  "missingSubmittedAtCount": 1,
  "observedAt": "2026-09-17T00:00:00.000Z"
}
```

`state` = `alerting`, если `overdueCount > 0`, иначе `ok`. В ответе нет ID,
имён, документов, URL, userId, текста анкеты или причин решений.
`missingSubmittedAtCount` — качество данных/operator follow-up, не нарушение
SLA и не причина `alerting`. Порог ровно 24 часа — единственный утверждённый
порог; иных порогов не вводить.

## Acceptance и tests

- При `PENDING` с submittedAt строго старше 24 ч: `alerting`, верные count и
  возраст; ровно 24 ч не считается `>24 ч`.
- `VERIFIED`/`DRAFT`, а также свежие `PENDING`, не входят в `overdueCount`.
- `PENDING` без submittedAt увеличивает только `missingSubmittedAtCount`.
- Виртуальное время через `ClockService`, без инфраструктуры.
- Контроллер: `VERIFICATION_OPERATOR` получает исключительно DTO выше;
  неавторизованный/иная роль получает существующий guard-ответ.
- Контрактный тест проверяет отсутствие PII-полей и отсутствие обращения к
  storage/signed URLs.

## Почему не остальные E30-сигналы в этом срезе

- `payment.settle_exhausted` уже оставляет audit transition с payment ID,
  consultationId и attempts (`backend/src/payments/settle-retry.service.ts:147-166`);
  `AuditLog` имеет timestamp, но нет индекса по transition (`backend/prisma/schema.prisma:84-95`).
  Его можно добавить следующим независимым read-model/индексным срезом, не
  смешивая с SLA очереди.
- «доля no-show» сейчас неоднозначна: sweep фиксирует только hint до решения
  эксперта (`backend/src/consultations/no-show.service.ts:11-18, 31-67`), а
  окончательный `CLIENT_NO_SHOW` — лишь один enum outcome
  (`backend/prisma/schema.prisma:349-357`). E30 не задаёт ни период, ни
  знаменатель, ни порог: это operator-config/open, не включать.
- Push хранит полезные три состояния: provider acceptance (`pushSentAt`),
  device ack (`pushDeliveredAt`) и dead outbox (`deadAt`)
  (`backend/prisma/schema.prisma:656-709`). `pushSentAt` ставится только после
  успешного fanout (`backend/src/notifications/outbox-sweep.service.ts:186-207`),
  а delivery — только клиентский ack (`backend/src/notifications/notifications.service.ts:196-212`).
  Mock provider всего лишь пишет запись в Redis и возвращает message id
  (`backend/src/notifications/provider/mock-push.provider.ts:8-43`), поэтому
  он доказывает provider acceptance, но не доставку на устройство. Период,
  denominator и delivery-SLO/порог — operator-config/open.

Ограничения: endpoint является источником сигнала, не самостоятельной
гарантией доставки alert; доступ к операторскому API и мониторинг должны быть
развёрнуты отдельно. Не затрагивать E29 admin-session или Redis backups.

## Уточнения оркестратора перед реализацией

Root подтвердил verificationSubmittedAt/status и действующие route guards. Для первого среза: oldestPendingAgeSeconds = null при отсутствии PENDING с известным временем, иначе floor seconds с clamp0; единый ClockService.now; согласованный агрегатный снимок БД; ошибки БД не превращаются в ok. Это источник сигнала, доставка alert остаётся отдельным незакрытым пунктом.
