# E30: наблюдение подтверждённых client no-show (read-only)

Статус: исследовательский план; изменений в repo/vault/DB нет. Base:
`191d105d9ab6102fc4fbdd482a4b9494afd7168c`.

## Вывод аудита

`CLIENT_NO_SHOW` — единственный пригодный подтверждённый факт: он хранится в
`Consultation.outcome` (`backend/prisma/schema.prisma:349-357, 380-387`) и
выставляется только при `ACTIVE -> COMPLETED` вместе с `endedAt` из
`ClockService` (`backend/src/consultations/consultations.service.ts:231-241`).
Если LiveKit уже записал `clientJoinedAt`, такой outcome отвергается
(`:216-228`). Следовательно, `noShowNotifiedAt` и audit transition
`consultation.client_no_show_hint` не являются outcome: sweep только помечает
и уведомляет эксперта, решение остаётся за ним (`no-show.service.ts:11-18,
31-67`). Их не включать ни в numerator, ни в denominator.

В vault есть quality-метрика «распределение outcome среди завершённых
консультаций периода» и пример denominator `count(outcome IS NOT NULL)`, но
там не заданы timestamp периода, точный статусный predicate и порог именно
для no-show; перечень также не включает текущий `EXPERT_CANCELLED`
(`WIKI/Дашборд метрик админки.md:80-91`; enum: `schema.prisma:349-357`). Это
не достаточно утверждённый E30 denominator/rate contract. Отдельного
no-show alert threshold не найден. Поэтому первый срез — raw observation,
не бизнес-«доля» и не alert.

## Один минимальный источник

Добавить в `consultations` один admin read-model, например
`GET /admin/consultations/no-show-observation?from=<UTC>&to=<UTC>`.
Владелец: `ConsultationNoShowObservationService` + DTO/controller рядом с
`ConsultationsModule`; он читает только `consultations`, без join, идентификаторов
или PII. Для admin-guard dependency модуль может применить уже используемый
`forwardRef(() => AdminModule)` паттерн платежей
(`backend/src/payments/payments.module.ts:1-35`). Route применяет существующие
`AdminJwtGuard`, `RolesGuard` и явный `@Roles(AdminRole.QUALITY_TEAM)`;
`RolesGuard` пропускает QUALITY_TEAM либо SUPERADMIN (`admin/roles.guard.ts:17-44`).
Это соответствует владельцу quality-метрик, не раскрывая карточки консультаций.

`from`/`to` — строгие UTC instants, `[from,to)`, `from < to`, `to <= observedAt`,
а длина не более 24 часов. Это *технический bound запроса*, повторяющий
существующий bounded observation (`notifications/push-observation.service.ts:42-75`),
не дневная продуктовая политика. Один SQL statement/CTE даёт согласованный
снимок; ошибку/отсутствующий aggregate не превращать в нули или `ok`.

Техническая когорта: `status = COMPLETED AND ended_at >= from AND ended_at < to`.
Ответ (все поля — integers >=0, кроме окна/observedAt):

```json
{
  "signal": "consultation.client_no_show_observation",
  "state": "observed",
  "window": { "from": "...Z", "to": "...Z" },
  "observedAt": "...Z",
  "cohortCompletedCount": 14,
  "clientNoShowOutcomeCount": 2,
  "outcomeCounts": {
    "COMPLETED": 8,
    "CLIENT_CANCELLED": 1,
    "TECH_ISSUE": 2,
    "EXPERT_CANCELLED": 0
  },
  "completedWithoutOutcomeCount": 1,
  "completedWithoutEndedAtCountAllTime": 0,
  "ratio": null,
  "ratioReason": "no_approved_no_show_denominator_or_threshold"
}
```

Инвариант окна: `cohortCompletedCount = clientNoShowOutcomeCount +
sum(outcomeCounts) + completedWithoutOutcomeCount`. `completedWithoutOutcomeCount`
виден внутри когорты. `completedWithoutEndedAtCountAllTime` намеренно отдельный
integrity counter (`status=COMPLETED AND endedAt IS NULL`): такую строку нельзя
честно отнести к окну без времени завершения. Поля `outcome` и `endedAt`
nullable именно как указано в схеме; поздний expert outcome попадёт
в то окно, когда записан `endedAt`, а не в окно no-show hint. Ни одной доли,
денежного вывода, штрафа, нового outcome или alert-порога источник не создаёт.

## Acceptance / ограничения / следующий срез

- Endpoint доступен QUALITY_TEAM/SUPERADMIN с действующей staff-сессией;
  неавторизованный/неподходящая роль получает существующий guard-ответ.
- Невалидное, будущее либо >24ч окно — 400; DB failure — 5xx, не observed/ok.
- В response нет consultationId, user/client/expert IDs, имени, topic, времени
  отдельной записи, payment или hint. Один aggregate query, проверка
  неотрицательных counters и приведённого равенства.
- Seed/test: подтверждённый `CLIENT_NO_SHOW` в окне; все иные enum outcomes;
  `COMPLETED + outcome NULL`; `COMPLETED + endedAt NULL`; outcome/hint вне окна;
  поздно записанный outcome. Hint сам по себе не увеличивает no-show count.

Ограничения: `endedAt` — момент фиксации итогового outcome, не начало сессии и
не время неявки; count не измеряет частоту среди запланированных сессий.
Отдельного индекса `status, endedAt` в схеме нет (только `[status, startedAt]`,
`schema.prisma:395-398`), поэтому 24ч лимит — защитный минимум, а план
индекса/retention требует отдельного performance evidence.

Следующий срез и owner: Quality owner утверждает, является ли denominator
`outcome IS NOT NULL` за `endedAt`-окно каноническим для no-show и какой порог
допустим; только после этого можно добавить `noShowRate`/alert policy. Acceptance
этого решения: явно зафиксированы population, UTC timestamp, denominator,
unknown-data treatment, threshold и владелец реакции.

## Уточнения root, имеют приоритет над предложением выше

2026-09-17: rawcount контракт принят после spotcheck enum/status/endedAt/QUALITY_TEAM. Поля ratio и ratioReason исключить из ответа: rate/alert не входят в срез, оговорка в Swagger/runbook. Ограничение окна24ч не ограничивает число сканируемых строк; alltime NULL-endedAt counter и отсутствие подходящего индекса остаются performance limitation. Общий pure UTC helper можно выделить без изменения push поведения и без зависимости модулей.
