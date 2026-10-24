# E30 — агрегаты push-наблюдаемости

Приняты локально 2026-09-17. Source46322277e395255a6be6c819d42b2ce9e46a01fd → main191d105d9ab6102fc4fbdd482a4b9494afd7168c. Independent APPROVE /tmp/qoldau-push-observation-review/report.md:50targeted+7PG16+12independent probes, real AppModule compile/init/HTTP, три reverse forwardRef проверены поодиночке. Ownfixture удалён. Fresh main301tests/45suites+lint/buildPASS; tree=reviewed, clean.

## Использование после отдельного развёртывания

GET /v1/admin/notifications/push-observation?from=<UTC>&to=<UTC> доступен действующему сотруднику любой роли через существующую admin авторизацию. Оба параметра обязательны, по одному значению: строгие календарные UTC даты с Z, миллисекунды максимум. from<to<=observedAt, окно не больше24ч — техническое ограничение, не политика оповещений.

Ответ содержит только агрегаты и фиксированные оговорки (полный контракт E30-PUSH-OBSERVATION-CONTRACT.md). Основная когорта: offer.incoming с pushSentAt в [from,to). completedFanoutCount — завершённый внутренний fanout; deviceAckCount — записанные ack этой когорты, в том числе позднее to; unacknowledgedCount — отсутствие записанного ack, не доказанная недоставка.

latencySampleCount учитывает неотрицательную разницу ack-send; negativeLatencyCount учитывается отдельно, может возникнуть при ack до завершения повторного fanout. Их сумма равна deviceAckCount. P95 nearest-rank только по валидным samples, null без samples. Не делить число samples на outbox population.

Три отдельные outbox-группы фильтруются по offer.incoming: joined dead по deadAt; joined closed с NULLpushSentAt/deadNULL по sentAt; orphan closed по sentAt. closedWithoutRecordedFanoutCount не доказывает отсутствие устройств. Они не прибавляются к notification denominator; частичная доставка возможна при dead.

state=observed только при успешном согласованном SELECT; non2xx — отсутствие наблюдения, не нули. observedAt — единое время приложения перед запросом, не causal AS OF snapshot: поздние ack, зафиксированные к началу SQL, могут входить.

## Открытые условия

providerAcceptance=not_observed, delivery=not_determined_by_source. Нет проверки боевого провайдера/реальных устройств/killed-app/SLO3с. Нет alerting/paging/политики выборки/порогов/production integration. Для включения оповещений нужны отдельные решения по окну, минимальной выборке, grace/порогам/действиям. Push/ack/outbox/retry/provider/guard behavior и schema не менялись; три module registration corrections обеспечивают новый цикл DI, без изменений бизнес-логики. Deploy/migrations/push не выполнялись.
