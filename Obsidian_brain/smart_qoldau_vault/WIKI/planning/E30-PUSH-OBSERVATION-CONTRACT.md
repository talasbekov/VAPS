# E30: push-observation — следующий минимальный read-only срез

Base inspected: `f812453e922e68082ed7c722845caf5ff1cd6296`. This is a design
note only: no code, runtime, tests, vault, provider, outbox, ack or retry
behaviour is changed.

## Canon and evidence

* The acceptance criterion is an incoming-offer push delivered in <=3 seconds
  at p95; the metrics dashboard names the two measures (ack ratio and p95
  `push_delivered_at - push_sent_at`) but says that, until a production
  provider exists, they describe the internal conveyor only:
  `WIKI/Дашборд метрик админки.md:104-115`.
* E9 defines the same boundary: <=3 s p95 is on real devices; this epic only
  made data available. It also specifies an offer SMS fallback after 10 s
  without ack, not a delivery-SLO alert policy:
  `WIKI/plans/2026-08-21-план-E9-уведомления.md:5-17`.
* Schema semantics are explicit: `pushSentAt` is "bus sent to provider" and
  `pushDeliveredAt` is device ack; outbox separately has `sentAt` and
  `deadAt`: `backend/prisma/schema.prisma:656-709`.
* `ack()` records only the first authenticated client acknowledgement; an
  absent ack is consequently an unobserved outcome, not evidence of failure:
  `backend/src/notifications/notifications.service.ts:196-211`.
* Outbox closes `sentAt` when there are no devices (`:169-183`), stamps both
  `sentAt` and `pushSentAt` only after every device call in the fanout
  succeeded (`:186-207`), and may have accepted a subset before a retry/dead
  row (`:146-166`, `:210-244`):
  `backend/src/notifications/outbox-sweep.service.ts:114-244`.
* The only provider is a mock: it writes Redis and returns a generated id,
  which is not persisted by the sweeper (`backend/src/notifications/provider/mock-push.provider.ts:8-44`; `backend/src/notifications/outbox-sweep.service.ts:154-161`). It cannot establish bank/provider or handset delivery.
* Existing E30 signal shape and admin route precedent are `GET
  /admin/payments/operational-signal`, `AdminJwtGuard` + `RolesGuard`, a
  single aggregate and `unknown` rather than fabricated zeroes:
  `backend/src/payments/payments-admin.controller.ts:16-32`,
  `backend/src/payments/payment-operational-signal.service.ts:15-53`.

## One proposed source (one next slice)

Owner: **backend notifications module**. Add only
`GET /v1/admin/notifications/push-observation?from=<ISO>&to=<ISO>` plus its
query/response DTO and one service aggregate. Import `AdminModule` into
`NotificationsModule` so the existing admin guard resolves; its current
imports/controller are at `backend/src/notifications/notifications.module.ts:18-36`.
Use `AdminJwtGuard, RolesGuard` but no `@Roles`: canonical dashboard group 6
is visible to every staff role and this response has no PII
(`WIKI/Дашборд метрик админки.md:124-128`; no-role guard is still admin-only:
`backend/src/admin/roles.decorator.ts:6-10`). No cache, Redis read/write,
new table, migration, worker, webhook, provider call, or UI.

Both parameters are required UTC instants, `from < to`, and the requested
half-open cohort `[from,to)` is technically limited to 24 h (it is not an
approved alert window). One `ClockService.now()` supplies `observedAt` and
validates `to <= observedAt` before the one read-only DB statement. The
aggregate is the database snapshot taken by that statement, not an `AS OF
observedAt` causal cutoff; in particular, it does not exclude a concurrently
committed late ack by comparing it to that application-clock value.

```json
{
  "signal": "push.offer_observation",
  "state": "observed",
  "window": { "from": "...Z", "to": "...Z" },
  "observedAt": "...Z",
  "completedFanoutCount": 37,
  "deviceAckCount": 29,
  "unacknowledgedCount": 8,
  "latencySampleCount": 28,
  "negativeLatencyCount": 1,
  "ackLatencyP95Ms": 2180,
  "outboxDeadCount": 2,
  "closedWithoutRecordedFanoutCount": 4,
  "missingNotificationForClosedOutboxCount": 0,
  "providerAcceptance": "not_observed",
  "delivery": "not_determined_by_source"
}
```

Population/denominator: `completedFanoutCount` is notifications where
`type = 'offer.incoming'` and `pushSentAt in [from,to)`. It is the sole
denominator of `deviceAckCount` and `unacknowledgedCount`. An ack counts when
that cohort row has non-null `pushDeliveredAt` in the statement snapshot; it
may be after `to`, because this is a cohort snapshot, not a claim that delivery
occurred inside the selected window. `unacknowledgedCount = completedFanoutCount
- deviceAckCount`; it means *no recorded client ack in that statement snapshot*
only.

`latencySampleCount` is the acknowledged cohort rows whose
`pushDeliveredAt >= pushSentAt`; `negativeLatencyCount` is acknowledged cohort
rows where it is earlier. The latter is reported but not automatically called
corruption: a client can ack an earlier partial fanout before a later retry
finishes and stamps `pushSentAt`. The p95 denominator is therefore
`latencySampleCount`, not the ack-ratio denominator. `ackLatencyP95Ms` is the
nearest-rank p95 of non-negative `pushDeliveredAt - pushSentAt`, or `null`
when there are no valid samples. Nearest-rank is an explicit implementation
choice for this endpoint, not a canonically approved percentile algorithm.

The three outbox counts are separate diagnostic populations, never added to
that denominator: joined `offer.incoming` outboxes with `deadAt in [from,to)`;
joined `offer.incoming` outboxes with `sentAt in [from,to)`, `pushSentAt IS
NULL`, and `deadAt IS NULL`; and, respectively, outboxes with
`type = 'offer.incoming'`, `sentAt in [from,to)` whose notification no longer
joins. `closedWithoutRecordedFanoutCount` states precisely that predicate;
the no-device closure is one implemented way to reach it, not a proven cause.
The last group remains separately visible even without a joined notification.
`outboxDeadCount` means local retries exhausted and may include partial fanout;
it does not prove zero provider/device deliveries.

`state` is `observed` only on a successful aggregate snapshot. An
impossible/missing aggregate is an error/non-2xx response; DB errors propagate
and never become `ok`, `unknown`, or fabricated zero counts. There is
deliberately no `alerting` state and no alert threshold in this slice: the
3-second real-device acceptance criterion is not an approved production alert
policy, sample-size rule, or missing-ack timeout. External monitoring may
record raw values but must not page from them until those decisions are
explicitly approved.

## Acceptance / limitations / decisions

Acceptance: one read-only aggregate snapshot; strict UTC/window validation
including `to <= observedAt`; all integer counts >=0;
`ack + unacknowledged = completedFanout` and
`latencySampleCount + negativeLatencyCount = deviceAckCount`; p95 is null on
zero valid latency samples; no identifiers, device tokens, title/body/data,
user id, provider message id or error text in DTO; ordinary admin auth rejects
non-admin/invalid sessions. Tests exercise no-device-possible closure,
partial/dead fanout, ackless, delayed/negative-ack latency and
missing-joined-notification classifications without changing their behavior.

Limitations are intentional: `pushSentAt` is completed internal fanout, not
durable provider acceptance; mock success is not a production provider result;
ack is not a receipt guarantee; no ack is not non-delivery; a dead outbox can
have partly delivered. The source cannot prove the §11.6 killed-app condition.

Open owner decisions before paging: (1) approved production provider and a
persisted provider-acceptance event; (2) fixed alert window, minimum cohort
size, lateness/grace rule and threshold/action for p95/ackless/dead counts;
(3) whether the endpoint should later be folded into the E8 dashboard rather
than remain an operational API. None is assumed here.

## Решение root

2026-09-17: исправленный контракт принят для реализации. Diagnostic populations фильтруются по outbox.type; notification cohort агрегируется отдельно, не размножается join. Required UTC даты проверяются календарно, arrays/duplicates запрещены. План не закрывает alert delivery/production provider/device acceptance.
