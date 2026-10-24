# 19. Release plan и backlog

## 1. Стратегия скорости

Быстро закончить проект означает не писать больше кода параллельно, а закрывать вертикальные потоки в правильном порядке:

1. заморозить канон;
2. не переделывать уже работающий foundation;
3. сначала core role flows;
4. затем деньги и надёжность;
5. затем retention/monetization;
6. B2B/B2G после стабилизации core;
7. исследования отдельно от production roadmap.

## 2. Release gates

| Release | Exit gate |
| --- | --- |
| R0 | PD-001…020 resolved; one registry; visual baseline; local Obsidian reconciled |
| R1 | Core client/expert/admin/public flows; no critical auth/safety/matching defects; visual P0 parity |
| R2 | Money authoritative; device calls; complaint/refund; operational admin; reliability evidence |
| R3 | Premium/content/reviews/privacy ops; retention metrics; no entitlement leak |
| R4 | B2B privacy/pool/contract/reporting pilot passed |
| R5 | B2G consent/supervision/restrictions/hours pilot passed |
| R6 | Separate business/legal/safety approval per experiment |

## 3. Epics

## E00 — Заморозка канона и экранного реестра (R0)

**Outcome:** Одна утверждённая версия решений, терминов, цен, ролей и экранов.  
**Owner:** Product Owner + Design Lead  
**Affected:** docs + all surfaces  
**Dependencies:** нет

**Stories:**
- S00-01 Утвердить PD-001…PD-020
- S00-02 Зафиксировать screen registry 106 экранов
- S00-03 Создать visual baseline и changelog
- S00-04 Сверить локальный Obsidian planning с этим blueprint

**Epic exit:** outcome воспроизводится сквозным role flow; screen/API/rules связаны; GO/NO-GO evidence приложено.
## E01 — Identity, consent и onboarding (R1)

**Outcome:** Клиент и эксперт безопасно входят, восстанавливают session и понимают режим доступа.  
**Owner:** Identity Lead  
**Affected:** app_client, app_expert, web, backend  
**Dependencies:** E00

**Stories:**
- S01-01 Client guest/OTP flow parity
- S01-02 Guest→registered conversion
- S01-03 Expert auth без guest
- S01-04 Consent/age versioning
- S01-05 RU/KK parity and route adapter

**Epic exit:** outcome воспроизводится сквозным role flow; screen/API/rules связаны; GO/NO-GO evidence приложено.
## E02 — Safety entry и кризисная граница (R1)

**Outcome:** SOS никогда не превращается в опасный обычный matching.  
**Owner:** Safety Owner  
**Affected:** app_client, web, backend, admin  
**Dependencies:** E00, E01

**Stories:**
- S02-01 Safety-approved screening copy
- S02-02 Offline emergency numbers
- S02-03 Urgent-but-not-emergency flow
- S02-04 Safety event/ticket routing

**Epic exit:** outcome воспроизводится сквозным role flow; screen/API/rules связаны; GO/NO-GO evidence приложено.
## E03 — Каталог, профиль и подбор (R1)

**Outcome:** Клиент выбирает тему/формат и получает только eligible специалистов.  
**Owner:** Marketplace Lead  
**Affected:** app_client, web, backend  
**Dependencies:** E01, E02

**Stories:**
- S03-01 Server-owned topic taxonomy
- S03-02 Catalog filters and empty states
- S03-03 Public profile moderation parity
- S03-04 Instant request/search/found flow
- S03-05 No-experts alternatives
- S03-06 Favorites

**Epic exit:** outcome воспроизводится сквозным role flow; screen/API/rules связаны; GO/NO-GO evidence приложено.
## E04 — Офферы и атомарный матч (R1)

**Outcome:** Один request создаёт одну консультацию даже при гонках.  
**Owner:** Backend/Realtime Lead  
**Affected:** app_expert, app_client, web, backend  
**Dependencies:** E03

**Stories:**
- S04-01 Offer alert/deadline states
- S04-02 Accept/decline/timeout/revoke
- S04-03 Reconnect/resync
- S04-04 Killed-state limitation copy
- S04-05 Concurrency evidence

**Epic exit:** outcome воспроизводится сквозным role flow; screen/API/rules связаны; GO/NO-GO evidence приложено.
## E05 — Чат и завершение core-сессии (R1)

**Outcome:** Клиент и эксперт проводят чат, восстанавливаются после сети и корректно завершают.  
**Owner:** Consultation Lead  
**Affected:** app_client, app_expert, web, backend  
**Dependencies:** E04

**Stories:**
- S05-01 Participant authorization
- S05-02 Idempotent messages
- S05-03 Offline/reconnect state
- S05-04 Expert private notes
- S05-05 Complete outcome and post-session CTA

**Epic exit:** outcome воспроизводится сквозным role flow; screen/API/rules связаны; GO/NO-GO evidence приложено.
## E06 — Frontend visual convergence core (R1)

**Outcome:** Core flow визуально соответствует prototype v2 на mobile/web.  
**Owner:** Frontend Lead  
**Affected:** app_client, app_expert, web, admin, packages/shared  
**Dependencies:** E01, E02, E03, E04, E05

**Stories:**
- S06-01 Token layer from prototype
- S06-02 Client mobile golden baselines
- S06-03 Expert mobile golden baselines
- S06-04 Public web baseline
- S06-05 Accessibility and reduced motion
- S06-06 Visual change log approvals

**Epic exit:** outcome воспроизводится сквозным role flow; screen/API/rules связаны; GO/NO-GO evidence приложено.
## E07 — Плановая запись и расписание (R2)

**Outcome:** Клиент бронирует/переносит, эксперт управляет слотами без double booking.  
**Owner:** Scheduling Lead  
**Affected:** app_client, app_expert, web, backend  
**Dependencies:** E03

**Stories:**
- S07-01 UTC/Asia-Almaty slot contract
- S07-02 Booking confirm and conflict
- S07-03 Reschedule/cancel UX
- S07-04 Weekly schedule/exceptions
- S07-05 Reminder notifications

**Epic exit:** outcome воспроизводится сквозным role flow; screen/API/rules связаны; GO/NO-GO evidence приложено.
## E08 — Платежи, возвраты и ledger (R2)

**Outcome:** Все деньги имеют authoritative status, idempotency и reconciliation.  
**Owner:** Finance Lead  
**Affected:** app_client, app_expert, web, admin, backend  
**Dependencies:** E00, E07

**Stories:**
- S08-01 Provider decision record
- S08-02 Payment intent/hold
- S08-03 Capture/void/refund matrix
- S08-04 Cancellation/no-show settlement
- S08-05 Reconciliation and stuck queue
- S08-06 Receipts/history
- S08-07 Admin finance evidence

**Epic exit:** outcome воспроизводится сквозным role flow; screen/API/rules связаны; GO/NO-GO evidence приложено.
## E09 — Аудио/видео и device acceptance (R2)

**Outcome:** Звонки работают на реальных устройствах с permissions/reconnect/fallback.  
**Owner:** Media/QA Lead  
**Affected:** app_client, app_expert, web, backend, infra  
**Dependencies:** E05

**Stories:**
- S09-01 Install JDK/device toolchain
- S09-02 Audio device walkthrough
- S09-03 Video device walkthrough
- S09-04 Chat→audio→video escalation
- S09-05 Network interruption test
- S09-06 LiveKit webhook/security test

**Epic exit:** outcome воспроизводится сквозным role flow; screen/API/rules связаны; GO/NO-GO evidence приложено.
## E10 — Жалобы, поддержка и качество (R2)

**Outcome:** Каждый спор имеет owner, SLA, evidence boundary и исполнимое решение.  
**Owner:** Quality Lead  
**Affected:** app_client, app_expert, web, admin, backend  
**Dependencies:** E05, E08

**Stories:**
- S10-01 Complaint create/status
- S10-02 Expert response
- S10-03 Quality decision
- S10-04 Refund/strike handoff
- S10-05 Support ticket categories/SLA
- S10-06 Appeal and audit

**Epic exit:** outcome воспроизводится сквозным role flow; screen/API/rules связаны; GO/NO-GO evidence приложено.
## E11 — Admin operational completeness (R2)

**Outcome:** Сотрудники выполняют работу по RBAC без скрытых ручных обходов.  
**Owner:** Operations/Admin Lead  
**Affected:** admin, backend  
**Dependencies:** E08, E10

**Stories:**
- S11-01 Queue dashboard/aging
- S11-02 Client block workflow
- S11-03 Dictionaries/versioning
- S11-04 Ledger/manual adjustment four-eyes
- S11-05 Incident center
- S11-06 Role-by-role click map

**Epic exit:** outcome воспроизводится сквозным role flow; screen/API/rules связаны; GO/NO-GO evidence приложено.
## E12 — Отзывы, Premium и контент (R3)

**Outcome:** Монетизация подписки и библиотека работают без ложных обещаний и media leakage.  
**Owner:** Growth/Content Lead  
**Affected:** app_client, app_expert, web, admin, backend  
**Dependencies:** E08, E10

**Stories:**
- S12-01 Public/private review split
- S12-02 Review moderation/reply
- S12-03 Canonical Premium plans
- S12-04 Renewal/cancel/past-due
- S12-05 Content lifecycle RU/KK
- S12-06 Premium media entitlement
- S12-07 Content safety review

**Epic exit:** outcome воспроизводится сквозным role flow; screen/API/rules связаны; GO/NO-GO evidence приложено.
## E13 — Privacy operations и analytics (R3)

**Outcome:** Data subject rights, минимизация и метрики доказуемы.  
**Owner:** Privacy/Data Lead  
**Affected:** all apps + analytics/ops  
**Dependencies:** E01, E10, E11

**Stories:**
- S13-01 Data export/delete workflow
- S13-02 Analytics PII invariant
- S13-03 Admin sensitive search audit
- S13-04 Retention matrix
- S13-05 Marketplace/quality dashboards

**Epic exit:** outcome воспроизводится сквозным role flow; screen/API/rules связаны; GO/NO-GO evidence приложено.
## E14 — B2B lifecycle (R4)

**Outcome:** Компания покупает pool, сотрудник использует coverage, отчёт остаётся анонимным.  
**Owner:** B2B Lead  
**Affected:** web, admin, backend, client surfaces  
**Dependencies:** E08, E13

**Stories:**
- S14-01 Lead/CRM pipeline
- S14-02 Contract/pool/code
- S14-03 Beneficiary activation
- S14-04 Reserve/consume/release
- S14-05 Aggregate report thresholds
- S14-06 Renewal/expiry

**Epic exit:** outcome воспроизводится сквозным role flow; screen/API/rules связаны; GO/NO-GO evidence приложено.
## E15 — B2G, практиканты и супервизия (R5)

**Outcome:** Практиканты работают только в безопасной управляемой модели.  
**Owner:** B2G Lead  
**Affected:** expert/client/admin/web/backend  
**Dependencies:** E10, E13, E14

**Stories:**
- S15-01 B2G contract/code
- S15-02 Student verification
- S15-03 Supervisor capacity/assignment
- S15-04 Client explicit consent
- S15-05 Topic eligibility
- S15-06 De-identified supervision
- S15-07 Hours ledger/report
- S15-08 Graduation to standard applicant

**Epic exit:** outcome воспроизводится сквозным role flow; screen/API/rules связаны; GO/NO-GO evidence приложено.
## E16 — Исследовательские направления (R6)

**Outcome:** Legal vertical, wearables и AI допускаются только после discovery, safety и legal gates.  
**Owner:** Discovery Lead  
**Affected:** separate discovery artifacts only  
**Dependencies:** E13

**Stories:**
- S16-01 Legal service discovery
- S16-02 Wearable privacy/clinical study
- S16-03 AI feature risk assessment
- S16-04 Separate prototype and business case

**Epic exit:** outcome воспроизводится сквозным role flow; screen/API/rules связаны; GO/NO-GO evidence приложено.


## 4. Story index

| Story | Epic | Release | Название | Owner | Affected |
| --- | --- | --- | --- | --- | --- |
| S00-01 | E00 | R0 | Утвердить PD-001…PD-020 | Product Owner + Design Lead | docs + all surfaces |
| S00-02 | E00 | R0 | Зафиксировать screen registry 106 экранов | Product Owner + Design Lead | docs + all surfaces |
| S00-03 | E00 | R0 | Создать visual baseline и changelog | Product Owner + Design Lead | docs + all surfaces |
| S00-04 | E00 | R0 | Сверить локальный Obsidian planning с этим blueprint | Product Owner + Design Lead | docs + all surfaces |
| S01-01 | E01 | R1 | Client guest/OTP flow parity | Identity Lead | app_client, app_expert, web, backend |
| S01-02 | E01 | R1 | Guest→registered conversion | Identity Lead | app_client, app_expert, web, backend |
| S01-03 | E01 | R1 | Expert auth без guest | Identity Lead | app_client, app_expert, web, backend |
| S01-04 | E01 | R1 | Consent/age versioning | Identity Lead | app_client, app_expert, web, backend |
| S01-05 | E01 | R1 | RU/KK parity and route adapter | Identity Lead | app_client, app_expert, web, backend |
| S02-01 | E02 | R1 | Safety-approved screening copy | Safety Owner | app_client, web, backend, admin |
| S02-02 | E02 | R1 | Offline emergency numbers | Safety Owner | app_client, web, backend, admin |
| S02-03 | E02 | R1 | Urgent-but-not-emergency flow | Safety Owner | app_client, web, backend, admin |
| S02-04 | E02 | R1 | Safety event/ticket routing | Safety Owner | app_client, web, backend, admin |
| S03-01 | E03 | R1 | Server-owned topic taxonomy | Marketplace Lead | app_client, web, backend |
| S03-02 | E03 | R1 | Catalog filters and empty states | Marketplace Lead | app_client, web, backend |
| S03-03 | E03 | R1 | Public profile moderation parity | Marketplace Lead | app_client, web, backend |
| S03-04 | E03 | R1 | Instant request/search/found flow | Marketplace Lead | app_client, web, backend |
| S03-05 | E03 | R1 | No-experts alternatives | Marketplace Lead | app_client, web, backend |
| S03-06 | E03 | R1 | Favorites | Marketplace Lead | app_client, web, backend |
| S04-01 | E04 | R1 | Offer alert/deadline states | Backend/Realtime Lead | app_expert, app_client, web, backend |
| S04-02 | E04 | R1 | Accept/decline/timeout/revoke | Backend/Realtime Lead | app_expert, app_client, web, backend |
| S04-03 | E04 | R1 | Reconnect/resync | Backend/Realtime Lead | app_expert, app_client, web, backend |
| S04-04 | E04 | R1 | Killed-state limitation copy | Backend/Realtime Lead | app_expert, app_client, web, backend |
| S04-05 | E04 | R1 | Concurrency evidence | Backend/Realtime Lead | app_expert, app_client, web, backend |
| S05-01 | E05 | R1 | Participant authorization | Consultation Lead | app_client, app_expert, web, backend |
| S05-02 | E05 | R1 | Idempotent messages | Consultation Lead | app_client, app_expert, web, backend |
| S05-03 | E05 | R1 | Offline/reconnect state | Consultation Lead | app_client, app_expert, web, backend |
| S05-04 | E05 | R1 | Expert private notes | Consultation Lead | app_client, app_expert, web, backend |
| S05-05 | E05 | R1 | Complete outcome and post-session CTA | Consultation Lead | app_client, app_expert, web, backend |
| S06-01 | E06 | R1 | Token layer from prototype | Frontend Lead | app_client, app_expert, web, admin, packages/shared |
| S06-02 | E06 | R1 | Client mobile golden baselines | Frontend Lead | app_client, app_expert, web, admin, packages/shared |
| S06-03 | E06 | R1 | Expert mobile golden baselines | Frontend Lead | app_client, app_expert, web, admin, packages/shared |
| S06-04 | E06 | R1 | Public web baseline | Frontend Lead | app_client, app_expert, web, admin, packages/shared |
| S06-05 | E06 | R1 | Accessibility and reduced motion | Frontend Lead | app_client, app_expert, web, admin, packages/shared |
| S06-06 | E06 | R1 | Visual change log approvals | Frontend Lead | app_client, app_expert, web, admin, packages/shared |
| S07-01 | E07 | R2 | UTC/Asia-Almaty slot contract | Scheduling Lead | app_client, app_expert, web, backend |
| S07-02 | E07 | R2 | Booking confirm and conflict | Scheduling Lead | app_client, app_expert, web, backend |
| S07-03 | E07 | R2 | Reschedule/cancel UX | Scheduling Lead | app_client, app_expert, web, backend |
| S07-04 | E07 | R2 | Weekly schedule/exceptions | Scheduling Lead | app_client, app_expert, web, backend |
| S07-05 | E07 | R2 | Reminder notifications | Scheduling Lead | app_client, app_expert, web, backend |
| S08-01 | E08 | R2 | Provider decision record | Finance Lead | app_client, app_expert, web, admin, backend |
| S08-02 | E08 | R2 | Payment intent/hold | Finance Lead | app_client, app_expert, web, admin, backend |
| S08-03 | E08 | R2 | Capture/void/refund matrix | Finance Lead | app_client, app_expert, web, admin, backend |
| S08-04 | E08 | R2 | Cancellation/no-show settlement | Finance Lead | app_client, app_expert, web, admin, backend |
| S08-05 | E08 | R2 | Reconciliation and stuck queue | Finance Lead | app_client, app_expert, web, admin, backend |
| S08-06 | E08 | R2 | Receipts/history | Finance Lead | app_client, app_expert, web, admin, backend |
| S08-07 | E08 | R2 | Admin finance evidence | Finance Lead | app_client, app_expert, web, admin, backend |
| S09-01 | E09 | R2 | Install JDK/device toolchain | Media/QA Lead | app_client, app_expert, web, backend, infra |
| S09-02 | E09 | R2 | Audio device walkthrough | Media/QA Lead | app_client, app_expert, web, backend, infra |
| S09-03 | E09 | R2 | Video device walkthrough | Media/QA Lead | app_client, app_expert, web, backend, infra |
| S09-04 | E09 | R2 | Chat→audio→video escalation | Media/QA Lead | app_client, app_expert, web, backend, infra |
| S09-05 | E09 | R2 | Network interruption test | Media/QA Lead | app_client, app_expert, web, backend, infra |
| S09-06 | E09 | R2 | LiveKit webhook/security test | Media/QA Lead | app_client, app_expert, web, backend, infra |
| S10-01 | E10 | R2 | Complaint create/status | Quality Lead | app_client, app_expert, web, admin, backend |
| S10-02 | E10 | R2 | Expert response | Quality Lead | app_client, app_expert, web, admin, backend |
| S10-03 | E10 | R2 | Quality decision | Quality Lead | app_client, app_expert, web, admin, backend |
| S10-04 | E10 | R2 | Refund/strike handoff | Quality Lead | app_client, app_expert, web, admin, backend |
| S10-05 | E10 | R2 | Support ticket categories/SLA | Quality Lead | app_client, app_expert, web, admin, backend |
| S10-06 | E10 | R2 | Appeal and audit | Quality Lead | app_client, app_expert, web, admin, backend |
| S11-01 | E11 | R2 | Queue dashboard/aging | Operations/Admin Lead | admin, backend |
| S11-02 | E11 | R2 | Client block workflow | Operations/Admin Lead | admin, backend |
| S11-03 | E11 | R2 | Dictionaries/versioning | Operations/Admin Lead | admin, backend |
| S11-04 | E11 | R2 | Ledger/manual adjustment four-eyes | Operations/Admin Lead | admin, backend |
| S11-05 | E11 | R2 | Incident center | Operations/Admin Lead | admin, backend |
| S11-06 | E11 | R2 | Role-by-role click map | Operations/Admin Lead | admin, backend |
| S12-01 | E12 | R3 | Public/private review split | Growth/Content Lead | app_client, app_expert, web, admin, backend |
| S12-02 | E12 | R3 | Review moderation/reply | Growth/Content Lead | app_client, app_expert, web, admin, backend |
| S12-03 | E12 | R3 | Canonical Premium plans | Growth/Content Lead | app_client, app_expert, web, admin, backend |
| S12-04 | E12 | R3 | Renewal/cancel/past-due | Growth/Content Lead | app_client, app_expert, web, admin, backend |
| S12-05 | E12 | R3 | Content lifecycle RU/KK | Growth/Content Lead | app_client, app_expert, web, admin, backend |
| S12-06 | E12 | R3 | Premium media entitlement | Growth/Content Lead | app_client, app_expert, web, admin, backend |
| S12-07 | E12 | R3 | Content safety review | Growth/Content Lead | app_client, app_expert, web, admin, backend |
| S13-01 | E13 | R3 | Data export/delete workflow | Privacy/Data Lead | all apps + analytics/ops |
| S13-02 | E13 | R3 | Analytics PII invariant | Privacy/Data Lead | all apps + analytics/ops |
| S13-03 | E13 | R3 | Admin sensitive search audit | Privacy/Data Lead | all apps + analytics/ops |
| S13-04 | E13 | R3 | Retention matrix | Privacy/Data Lead | all apps + analytics/ops |
| S13-05 | E13 | R3 | Marketplace/quality dashboards | Privacy/Data Lead | all apps + analytics/ops |
| S14-01 | E14 | R4 | Lead/CRM pipeline | B2B Lead | web, admin, backend, client surfaces |
| S14-02 | E14 | R4 | Contract/pool/code | B2B Lead | web, admin, backend, client surfaces |
| S14-03 | E14 | R4 | Beneficiary activation | B2B Lead | web, admin, backend, client surfaces |
| S14-04 | E14 | R4 | Reserve/consume/release | B2B Lead | web, admin, backend, client surfaces |
| S14-05 | E14 | R4 | Aggregate report thresholds | B2B Lead | web, admin, backend, client surfaces |
| S14-06 | E14 | R4 | Renewal/expiry | B2B Lead | web, admin, backend, client surfaces |
| S15-01 | E15 | R5 | B2G contract/code | B2G Lead | expert/client/admin/web/backend |
| S15-02 | E15 | R5 | Student verification | B2G Lead | expert/client/admin/web/backend |
| S15-03 | E15 | R5 | Supervisor capacity/assignment | B2G Lead | expert/client/admin/web/backend |
| S15-04 | E15 | R5 | Client explicit consent | B2G Lead | expert/client/admin/web/backend |
| S15-05 | E15 | R5 | Topic eligibility | B2G Lead | expert/client/admin/web/backend |
| S15-06 | E15 | R5 | De-identified supervision | B2G Lead | expert/client/admin/web/backend |
| S15-07 | E15 | R5 | Hours ledger/report | B2G Lead | expert/client/admin/web/backend |
| S15-08 | E15 | R5 | Graduation to standard applicant | B2G Lead | expert/client/admin/web/backend |
| S16-01 | E16 | R6 | Legal service discovery | Discovery Lead | separate discovery artifacts only |
| S16-02 | E16 | R6 | Wearable privacy/clinical study | Discovery Lead | separate discovery artifacts only |
| S16-03 | E16 | R6 | AI feature risk assessment | Discovery Lead | separate discovery artifacts only |
| S16-04 | E16 | R6 | Separate prototype and business case | Discovery Lead | separate discovery artifacts only |

## 5. Stories подробно

### S00-01 — Утвердить PD-001…PD-020

**Epic/Release:** `E00` / `R0`  
**Owner:** Product Owner + Design Lead  
**Affected:** docs + all surfaces

**Outcome:** вклад этой истории в результат «Одна утверждённая версия решений, терминов, цен, ролей и экранов.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S00-02 — Зафиксировать screen registry 106 экранов

**Epic/Release:** `E00` / `R0`  
**Owner:** Product Owner + Design Lead  
**Affected:** docs + all surfaces

**Outcome:** вклад этой истории в результат «Одна утверждённая версия решений, терминов, цен, ролей и экранов.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S00-03 — Создать visual baseline и changelog

**Epic/Release:** `E00` / `R0`  
**Owner:** Product Owner + Design Lead  
**Affected:** docs + all surfaces

**Outcome:** вклад этой истории в результат «Одна утверждённая версия решений, терминов, цен, ролей и экранов.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] approved viewport screenshots exist
- [ ] diff classified as defect/intentional
- [ ] no arbitrary feature hex
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S00-04 — Сверить локальный Obsidian planning с этим blueprint

**Epic/Release:** `E00` / `R0`  
**Owner:** Product Owner + Design Lead  
**Affected:** docs + all surfaces

**Outcome:** вклад этой истории в результат «Одна утверждённая версия решений, терминов, цен, ролей и экранов.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S01-01 — Client guest/OTP flow parity

**Epic/Release:** `E01` / `R1`  
**Owner:** Identity Lead  
**Affected:** app_client, app_expert, web, backend

**Outcome:** вклад этой истории в результат «Клиент и эксперт безопасно входят, восстанавливают session и понимают режим доступа.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S01-02 — Guest→registered conversion

**Epic/Release:** `E01` / `R1`  
**Owner:** Identity Lead  
**Affected:** app_client, app_expert, web, backend

**Outcome:** вклад этой истории в результат «Клиент и эксперт безопасно входят, восстанавливают session и понимают режим доступа.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S01-03 — Expert auth без guest

**Epic/Release:** `E01` / `R1`  
**Owner:** Identity Lead  
**Affected:** app_client, app_expert, web, backend

**Outcome:** вклад этой истории в результат «Клиент и эксперт безопасно входят, восстанавливают session и понимают режим доступа.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S01-04 — Consent/age versioning

**Epic/Release:** `E01` / `R1`  
**Owner:** Identity Lead  
**Affected:** app_client, app_expert, web, backend

**Outcome:** вклад этой истории в результат «Клиент и эксперт безопасно входят, восстанавливают session и понимают режим доступа.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S01-05 — RU/KK parity and route adapter

**Epic/Release:** `E01` / `R1`  
**Owner:** Identity Lead  
**Affected:** app_client, app_expert, web, backend

**Outcome:** вклад этой истории в результат «Клиент и эксперт безопасно входят, восстанавливают session и понимают режим доступа.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S02-01 — Safety-approved screening copy

**Epic/Release:** `E02` / `R1`  
**Owner:** Safety Owner  
**Affected:** app_client, web, backend, admin

**Outcome:** вклад этой истории в результат «SOS никогда не превращается в опасный обычный matching.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S02-02 — Offline emergency numbers

**Epic/Release:** `E02` / `R1`  
**Owner:** Safety Owner  
**Affected:** app_client, web, backend, admin

**Outcome:** вклад этой истории в результат «SOS никогда не превращается в опасный обычный matching.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S02-03 — Urgent-but-not-emergency flow

**Epic/Release:** `E02` / `R1`  
**Owner:** Safety Owner  
**Affected:** app_client, web, backend, admin

**Outcome:** вклад этой истории в результат «SOS никогда не превращается в опасный обычный matching.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S02-04 — Safety event/ticket routing

**Epic/Release:** `E02` / `R1`  
**Owner:** Safety Owner  
**Affected:** app_client, web, backend, admin

**Outcome:** вклад этой истории в результат «SOS никогда не превращается в опасный обычный matching.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S03-01 — Server-owned topic taxonomy

**Epic/Release:** `E03` / `R1`  
**Owner:** Marketplace Lead  
**Affected:** app_client, web, backend

**Outcome:** вклад этой истории в результат «Клиент выбирает тему/формат и получает только eligible специалистов.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S03-02 — Catalog filters and empty states

**Epic/Release:** `E03` / `R1`  
**Owner:** Marketplace Lead  
**Affected:** app_client, web, backend

**Outcome:** вклад этой истории в результат «Клиент выбирает тему/формат и получает только eligible специалистов.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S03-03 — Public profile moderation parity

**Epic/Release:** `E03` / `R1`  
**Owner:** Marketplace Lead  
**Affected:** app_client, web, backend

**Outcome:** вклад этой истории в результат «Клиент выбирает тему/формат и получает только eligible специалистов.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S03-04 — Instant request/search/found flow

**Epic/Release:** `E03` / `R1`  
**Owner:** Marketplace Lead  
**Affected:** app_client, web, backend

**Outcome:** вклад этой истории в результат «Клиент выбирает тему/формат и получает только eligible специалистов.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S03-05 — No-experts alternatives

**Epic/Release:** `E03` / `R1`  
**Owner:** Marketplace Lead  
**Affected:** app_client, web, backend

**Outcome:** вклад этой истории в результат «Клиент выбирает тему/формат и получает только eligible специалистов.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S03-06 — Favorites

**Epic/Release:** `E03` / `R1`  
**Owner:** Marketplace Lead  
**Affected:** app_client, web, backend

**Outcome:** вклад этой истории в результат «Клиент выбирает тему/формат и получает только eligible специалистов.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S04-01 — Offer alert/deadline states

**Epic/Release:** `E04` / `R1`  
**Owner:** Backend/Realtime Lead  
**Affected:** app_expert, app_client, web, backend

**Outcome:** вклад этой истории в результат «Один request создаёт одну консультацию даже при гонках.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S04-02 — Accept/decline/timeout/revoke

**Epic/Release:** `E04` / `R1`  
**Owner:** Backend/Realtime Lead  
**Affected:** app_expert, app_client, web, backend

**Outcome:** вклад этой истории в результат «Один request создаёт одну консультацию даже при гонках.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S04-03 — Reconnect/resync

**Epic/Release:** `E04` / `R1`  
**Owner:** Backend/Realtime Lead  
**Affected:** app_expert, app_client, web, backend

**Outcome:** вклад этой истории в результат «Один request создаёт одну консультацию даже при гонках.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S04-04 — Killed-state limitation copy

**Epic/Release:** `E04` / `R1`  
**Owner:** Backend/Realtime Lead  
**Affected:** app_expert, app_client, web, backend

**Outcome:** вклад этой истории в результат «Один request создаёт одну консультацию даже при гонках.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S04-05 — Concurrency evidence

**Epic/Release:** `E04` / `R1`  
**Owner:** Backend/Realtime Lead  
**Affected:** app_expert, app_client, web, backend

**Outcome:** вклад этой истории в результат «Один request создаёт одну консультацию даже при гонках.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S05-01 — Participant authorization

**Epic/Release:** `E05` / `R1`  
**Owner:** Consultation Lead  
**Affected:** app_client, app_expert, web, backend

**Outcome:** вклад этой истории в результат «Клиент и эксперт проводят чат, восстанавливаются после сети и корректно завершают.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] menu visibility matrix
- [ ] direct URL/API 403 test
- [ ] audit after commit
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S05-02 — Idempotent messages

**Epic/Release:** `E05` / `R1`  
**Owner:** Consultation Lead  
**Affected:** app_client, app_expert, web, backend

**Outcome:** вклад этой истории в результат «Клиент и эксперт проводят чат, восстанавливаются после сети и корректно завершают.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S05-03 — Offline/reconnect state

**Epic/Release:** `E05` / `R1`  
**Owner:** Consultation Lead  
**Affected:** app_client, app_expert, web, backend

**Outcome:** вклад этой истории в результат «Клиент и эксперт проводят чат, восстанавливаются после сети и корректно завершают.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S05-04 — Expert private notes

**Epic/Release:** `E05` / `R1`  
**Owner:** Consultation Lead  
**Affected:** app_client, app_expert, web, backend

**Outcome:** вклад этой истории в результат «Клиент и эксперт проводят чат, восстанавливаются после сети и корректно завершают.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S05-05 — Complete outcome and post-session CTA

**Epic/Release:** `E05` / `R1`  
**Owner:** Consultation Lead  
**Affected:** app_client, app_expert, web, backend

**Outcome:** вклад этой истории в результат «Клиент и эксперт проводят чат, восстанавливаются после сети и корректно завершают.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S06-01 — Token layer from prototype

**Epic/Release:** `E06` / `R1`  
**Owner:** Frontend Lead  
**Affected:** app_client, app_expert, web, admin, packages/shared

**Outcome:** вклад этой истории в результат «Core flow визуально соответствует prototype v2 на mobile/web.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] approved viewport screenshots exist
- [ ] diff classified as defect/intentional
- [ ] no arbitrary feature hex
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S06-02 — Client mobile golden baselines

**Epic/Release:** `E06` / `R1`  
**Owner:** Frontend Lead  
**Affected:** app_client, app_expert, web, admin, packages/shared

**Outcome:** вклад этой истории в результат «Core flow визуально соответствует prototype v2 на mobile/web.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] approved viewport screenshots exist
- [ ] diff classified as defect/intentional
- [ ] no arbitrary feature hex
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S06-03 — Expert mobile golden baselines

**Epic/Release:** `E06` / `R1`  
**Owner:** Frontend Lead  
**Affected:** app_client, app_expert, web, admin, packages/shared

**Outcome:** вклад этой истории в результат «Core flow визуально соответствует prototype v2 на mobile/web.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] approved viewport screenshots exist
- [ ] diff classified as defect/intentional
- [ ] no arbitrary feature hex
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S06-04 — Public web baseline

**Epic/Release:** `E06` / `R1`  
**Owner:** Frontend Lead  
**Affected:** app_client, app_expert, web, admin, packages/shared

**Outcome:** вклад этой истории в результат «Core flow визуально соответствует prototype v2 на mobile/web.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] approved viewport screenshots exist
- [ ] diff classified as defect/intentional
- [ ] no arbitrary feature hex
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S06-05 — Accessibility and reduced motion

**Epic/Release:** `E06` / `R1`  
**Owner:** Frontend Lead  
**Affected:** app_client, app_expert, web, admin, packages/shared

**Outcome:** вклад этой истории в результат «Core flow визуально соответствует prototype v2 на mobile/web.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S06-06 — Visual change log approvals

**Epic/Release:** `E06` / `R1`  
**Owner:** Frontend Lead  
**Affected:** app_client, app_expert, web, admin, packages/shared

**Outcome:** вклад этой истории в результат «Core flow визуально соответствует prototype v2 на mobile/web.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] approved viewport screenshots exist
- [ ] diff classified as defect/intentional
- [ ] no arbitrary feature hex
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S07-01 — UTC/Asia-Almaty slot contract

**Epic/Release:** `E07` / `R2`  
**Owner:** Scheduling Lead  
**Affected:** app_client, app_expert, web, backend

**Outcome:** вклад этой истории в результат «Клиент бронирует/переносит, эксперт управляет слотами без double booking.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] small-cohort suppression
- [ ] no individual usage fields
- [ ] contract expiry test
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S07-02 — Booking confirm and conflict

**Epic/Release:** `E07` / `R2`  
**Owner:** Scheduling Lead  
**Affected:** app_client, app_expert, web, backend

**Outcome:** вклад этой истории в результат «Клиент бронирует/переносит, эксперт управляет слотами без double booking.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S07-03 — Reschedule/cancel UX

**Epic/Release:** `E07` / `R2`  
**Owner:** Scheduling Lead  
**Affected:** app_client, app_expert, web, backend

**Outcome:** вклад этой истории в результат «Клиент бронирует/переносит, эксперт управляет слотами без double booking.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S07-04 — Weekly schedule/exceptions

**Epic/Release:** `E07` / `R2`  
**Owner:** Scheduling Lead  
**Affected:** app_client, app_expert, web, backend

**Outcome:** вклад этой истории в результат «Клиент бронирует/переносит, эксперт управляет слотами без double booking.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S07-05 — Reminder notifications

**Epic/Release:** `E07` / `R2`  
**Owner:** Scheduling Lead  
**Affected:** app_client, app_expert, web, backend

**Outcome:** вклад этой истории в результат «Клиент бронирует/переносит, эксперт управляет слотами без double booking.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S08-01 — Provider decision record

**Epic/Release:** `E08` / `R2`  
**Owner:** Finance Lead  
**Affected:** app_client, app_expert, web, admin, backend

**Outcome:** вклад этой истории в результат «Все деньги имеют authoritative status, idempotency и reconciliation.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S08-02 — Payment intent/hold

**Epic/Release:** `E08` / `R2`  
**Owner:** Finance Lead  
**Affected:** app_client, app_expert, web, admin, backend

**Outcome:** вклад этой истории в результат «Все деньги имеют authoritative status, idempotency и reconciliation.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] idempotency test
- [ ] provider duplicate/timeout test
- [ ] money shown from authoritative state
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S08-03 — Capture/void/refund matrix

**Epic/Release:** `E08` / `R2`  
**Owner:** Finance Lead  
**Affected:** app_client, app_expert, web, admin, backend

**Outcome:** вклад этой истории в результат «Все деньги имеют authoritative status, idempotency и reconciliation.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] idempotency test
- [ ] provider duplicate/timeout test
- [ ] money shown from authoritative state
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S08-04 — Cancellation/no-show settlement

**Epic/Release:** `E08` / `R2`  
**Owner:** Finance Lead  
**Affected:** app_client, app_expert, web, admin, backend

**Outcome:** вклад этой истории в результат «Все деньги имеют authoritative status, idempotency и reconciliation.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S08-05 — Reconciliation and stuck queue

**Epic/Release:** `E08` / `R2`  
**Owner:** Finance Lead  
**Affected:** app_client, app_expert, web, admin, backend

**Outcome:** вклад этой истории в результат «Все деньги имеют authoritative status, idempotency и reconciliation.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] idempotency test
- [ ] provider duplicate/timeout test
- [ ] money shown from authoritative state
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S08-06 — Receipts/history

**Epic/Release:** `E08` / `R2`  
**Owner:** Finance Lead  
**Affected:** app_client, app_expert, web, admin, backend

**Outcome:** вклад этой истории в результат «Все деньги имеют authoritative status, idempotency и reconciliation.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S08-07 — Admin finance evidence

**Epic/Release:** `E08` / `R2`  
**Owner:** Finance Lead  
**Affected:** app_client, app_expert, web, admin, backend

**Outcome:** вклад этой истории в результат «Все деньги имеют authoritative status, idempotency и reconciliation.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] menu visibility matrix
- [ ] direct URL/API 403 test
- [ ] audit after commit
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S09-01 — Install JDK/device toolchain

**Epic/Release:** `E09` / `R2`  
**Owner:** Media/QA Lead  
**Affected:** app_client, app_expert, web, backend, infra

**Outcome:** вклад этой истории в результат «Звонки работают на реальных устройствах с permissions/reconnect/fallback.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] real device or supported emulator evidence
- [ ] permission denied flow
- [ ] 10s network loss/reconnect evidence
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S09-02 — Audio device walkthrough

**Epic/Release:** `E09` / `R2`  
**Owner:** Media/QA Lead  
**Affected:** app_client, app_expert, web, backend, infra

**Outcome:** вклад этой истории в результат «Звонки работают на реальных устройствах с permissions/reconnect/fallback.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] real device or supported emulator evidence
- [ ] permission denied flow
- [ ] 10s network loss/reconnect evidence
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S09-03 — Video device walkthrough

**Epic/Release:** `E09` / `R2`  
**Owner:** Media/QA Lead  
**Affected:** app_client, app_expert, web, backend, infra

**Outcome:** вклад этой истории в результат «Звонки работают на реальных устройствах с permissions/reconnect/fallback.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] real device or supported emulator evidence
- [ ] permission denied flow
- [ ] 10s network loss/reconnect evidence
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S09-04 — Chat→audio→video escalation

**Epic/Release:** `E09` / `R2`  
**Owner:** Media/QA Lead  
**Affected:** app_client, app_expert, web, backend, infra

**Outcome:** вклад этой истории в результат «Звонки работают на реальных устройствах с permissions/reconnect/fallback.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] real device or supported emulator evidence
- [ ] permission denied flow
- [ ] 10s network loss/reconnect evidence
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S09-05 — Network interruption test

**Epic/Release:** `E09` / `R2`  
**Owner:** Media/QA Lead  
**Affected:** app_client, app_expert, web, backend, infra

**Outcome:** вклад этой истории в результат «Звонки работают на реальных устройствах с permissions/reconnect/fallback.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] real device or supported emulator evidence
- [ ] permission denied flow
- [ ] 10s network loss/reconnect evidence
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S09-06 — LiveKit webhook/security test

**Epic/Release:** `E09` / `R2`  
**Owner:** Media/QA Lead  
**Affected:** app_client, app_expert, web, backend, infra

**Outcome:** вклад этой истории в результат «Звонки работают на реальных устройствах с permissions/reconnect/fallback.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] real device or supported emulator evidence
- [ ] permission denied flow
- [ ] 10s network loss/reconnect evidence
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S10-01 — Complaint create/status

**Epic/Release:** `E10` / `R2`  
**Owner:** Quality Lead  
**Affected:** app_client, app_expert, web, admin, backend

**Outcome:** вклад этой истории в результат «Каждый спор имеет owner, SLA, evidence boundary и исполнимое решение.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S10-02 — Expert response

**Epic/Release:** `E10` / `R2`  
**Owner:** Quality Lead  
**Affected:** app_client, app_expert, web, admin, backend

**Outcome:** вклад этой истории в результат «Каждый спор имеет owner, SLA, evidence boundary и исполнимое решение.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S10-03 — Quality decision

**Epic/Release:** `E10` / `R2`  
**Owner:** Quality Lead  
**Affected:** app_client, app_expert, web, admin, backend

**Outcome:** вклад этой истории в результат «Каждый спор имеет owner, SLA, evidence boundary и исполнимое решение.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S10-04 — Refund/strike handoff

**Epic/Release:** `E10` / `R2`  
**Owner:** Quality Lead  
**Affected:** app_client, app_expert, web, admin, backend

**Outcome:** вклад этой истории в результат «Каждый спор имеет owner, SLA, evidence boundary и исполнимое решение.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] idempotency test
- [ ] provider duplicate/timeout test
- [ ] money shown from authoritative state
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S10-05 — Support ticket categories/SLA

**Epic/Release:** `E10` / `R2`  
**Owner:** Quality Lead  
**Affected:** app_client, app_expert, web, admin, backend

**Outcome:** вклад этой истории в результат «Каждый спор имеет owner, SLA, evidence boundary и исполнимое решение.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S10-06 — Appeal and audit

**Epic/Release:** `E10` / `R2`  
**Owner:** Quality Lead  
**Affected:** app_client, app_expert, web, admin, backend

**Outcome:** вклад этой истории в результат «Каждый спор имеет owner, SLA, evidence boundary и исполнимое решение.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S11-01 — Queue dashboard/aging

**Epic/Release:** `E11` / `R2`  
**Owner:** Operations/Admin Lead  
**Affected:** admin, backend

**Outcome:** вклад этой истории в результат «Сотрудники выполняют работу по RBAC без скрытых ручных обходов.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S11-02 — Client block workflow

**Epic/Release:** `E11` / `R2`  
**Owner:** Operations/Admin Lead  
**Affected:** admin, backend

**Outcome:** вклад этой истории в результат «Сотрудники выполняют работу по RBAC без скрытых ручных обходов.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S11-03 — Dictionaries/versioning

**Epic/Release:** `E11` / `R2`  
**Owner:** Operations/Admin Lead  
**Affected:** admin, backend

**Outcome:** вклад этой истории в результат «Сотрудники выполняют работу по RBAC без скрытых ручных обходов.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S11-04 — Ledger/manual adjustment four-eyes

**Epic/Release:** `E11` / `R2`  
**Owner:** Operations/Admin Lead  
**Affected:** admin, backend

**Outcome:** вклад этой истории в результат «Сотрудники выполняют работу по RBAC без скрытых ручных обходов.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] idempotency test
- [ ] provider duplicate/timeout test
- [ ] money shown from authoritative state
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S11-05 — Incident center

**Epic/Release:** `E11` / `R2`  
**Owner:** Operations/Admin Lead  
**Affected:** admin, backend

**Outcome:** вклад этой истории в результат «Сотрудники выполняют работу по RBAC без скрытых ручных обходов.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S11-06 — Role-by-role click map

**Epic/Release:** `E11` / `R2`  
**Owner:** Operations/Admin Lead  
**Affected:** admin, backend

**Outcome:** вклад этой истории в результат «Сотрудники выполняют работу по RBAC без скрытых ручных обходов.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] menu visibility matrix
- [ ] direct URL/API 403 test
- [ ] audit after commit
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S12-01 — Public/private review split

**Epic/Release:** `E12` / `R3`  
**Owner:** Growth/Content Lead  
**Affected:** app_client, app_expert, web, admin, backend

**Outcome:** вклад этой истории в результат «Монетизация подписки и библиотека работают без ложных обещаний и media leakage.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S12-02 — Review moderation/reply

**Epic/Release:** `E12` / `R3`  
**Owner:** Growth/Content Lead  
**Affected:** app_client, app_expert, web, admin, backend

**Outcome:** вклад этой истории в результат «Монетизация подписки и библиотека работают без ложных обещаний и media leakage.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S12-03 — Canonical Premium plans

**Epic/Release:** `E12` / `R3`  
**Owner:** Growth/Content Lead  
**Affected:** app_client, app_expert, web, admin, backend

**Outcome:** вклад этой истории в результат «Монетизация подписки и библиотека работают без ложных обещаний и media leakage.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S12-04 — Renewal/cancel/past-due

**Epic/Release:** `E12` / `R3`  
**Owner:** Growth/Content Lead  
**Affected:** app_client, app_expert, web, admin, backend

**Outcome:** вклад этой истории в результат «Монетизация подписки и библиотека работают без ложных обещаний и media leakage.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S12-05 — Content lifecycle RU/KK

**Epic/Release:** `E12` / `R3`  
**Owner:** Growth/Content Lead  
**Affected:** app_client, app_expert, web, admin, backend

**Outcome:** вклад этой истории в результат «Монетизация подписки и библиотека работают без ложных обещаний и media leakage.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S12-06 — Premium media entitlement

**Epic/Release:** `E12` / `R3`  
**Owner:** Growth/Content Lead  
**Affected:** app_client, app_expert, web, admin, backend

**Outcome:** вклад этой истории в результат «Монетизация подписки и библиотека работают без ложных обещаний и media leakage.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S12-07 — Content safety review

**Epic/Release:** `E12` / `R3`  
**Owner:** Growth/Content Lead  
**Affected:** app_client, app_expert, web, admin, backend

**Outcome:** вклад этой истории в результат «Монетизация подписки и библиотека работают без ложных обещаний и media leakage.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S13-01 — Data export/delete workflow

**Epic/Release:** `E13` / `R3`  
**Owner:** Privacy/Data Lead  
**Affected:** all apps + analytics/ops

**Outcome:** вклад этой истории в результат «Data subject rights, минимизация и метрики доказуемы.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S13-02 — Analytics PII invariant

**Epic/Release:** `E13` / `R3`  
**Owner:** Privacy/Data Lead  
**Affected:** all apps + analytics/ops

**Outcome:** вклад этой истории в результат «Data subject rights, минимизация и метрики доказуемы.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] PII allow-list test
- [ ] retention/owner documented
- [ ] no sensitive free text
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S13-03 — Admin sensitive search audit

**Epic/Release:** `E13` / `R3`  
**Owner:** Privacy/Data Lead  
**Affected:** all apps + analytics/ops

**Outcome:** вклад этой истории в результат «Data subject rights, минимизация и метрики доказуемы.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] menu visibility matrix
- [ ] direct URL/API 403 test
- [ ] audit after commit
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S13-04 — Retention matrix

**Epic/Release:** `E13` / `R3`  
**Owner:** Privacy/Data Lead  
**Affected:** all apps + analytics/ops

**Outcome:** вклад этой истории в результат «Data subject rights, минимизация и метрики доказуемы.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] PII allow-list test
- [ ] retention/owner documented
- [ ] no sensitive free text
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S13-05 — Marketplace/quality dashboards

**Epic/Release:** `E13` / `R3`  
**Owner:** Privacy/Data Lead  
**Affected:** all apps + analytics/ops

**Outcome:** вклад этой истории в результат «Data subject rights, минимизация и метрики доказуемы.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S14-01 — Lead/CRM pipeline

**Epic/Release:** `E14` / `R4`  
**Owner:** B2B Lead  
**Affected:** web, admin, backend, client surfaces

**Outcome:** вклад этой истории в результат «Компания покупает pool, сотрудник использует coverage, отчёт остаётся анонимным.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S14-02 — Contract/pool/code

**Epic/Release:** `E14` / `R4`  
**Owner:** B2B Lead  
**Affected:** web, admin, backend, client surfaces

**Outcome:** вклад этой истории в результат «Компания покупает pool, сотрудник использует coverage, отчёт остаётся анонимным.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] small-cohort suppression
- [ ] no individual usage fields
- [ ] contract expiry test
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S14-03 — Beneficiary activation

**Epic/Release:** `E14` / `R4`  
**Owner:** B2B Lead  
**Affected:** web, admin, backend, client surfaces

**Outcome:** вклад этой истории в результат «Компания покупает pool, сотрудник использует coverage, отчёт остаётся анонимным.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S14-04 — Reserve/consume/release

**Epic/Release:** `E14` / `R4`  
**Owner:** B2B Lead  
**Affected:** web, admin, backend, client surfaces

**Outcome:** вклад этой истории в результат «Компания покупает pool, сотрудник использует coverage, отчёт остаётся анонимным.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S14-05 — Aggregate report thresholds

**Epic/Release:** `E14` / `R4`  
**Owner:** B2B Lead  
**Affected:** web, admin, backend, client surfaces

**Outcome:** вклад этой истории в результат «Компания покупает pool, сотрудник использует coverage, отчёт остаётся анонимным.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] small-cohort suppression
- [ ] no individual usage fields
- [ ] contract expiry test
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S14-06 — Renewal/expiry

**Epic/Release:** `E14` / `R4`  
**Owner:** B2B Lead  
**Affected:** web, admin, backend, client surfaces

**Outcome:** вклад этой истории в результат «Компания покупает pool, сотрудник использует coverage, отчёт остаётся анонимным.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S15-01 — B2G contract/code

**Epic/Release:** `E15` / `R5`  
**Owner:** B2G Lead  
**Affected:** expert/client/admin/web/backend

**Outcome:** вклад этой истории в результат «Практиканты работают только в безопасной управляемой модели.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] small-cohort suppression
- [ ] no individual usage fields
- [ ] contract expiry test
- [ ] intern heavy-topic denial
- [ ] active supervisor required
- [ ] explicit client consent
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S15-02 — Student verification

**Epic/Release:** `E15` / `R5`  
**Owner:** B2G Lead  
**Affected:** expert/client/admin/web/backend

**Outcome:** вклад этой истории в результат «Практиканты работают только в безопасной управляемой модели.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] intern heavy-topic denial
- [ ] active supervisor required
- [ ] explicit client consent
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S15-03 — Supervisor capacity/assignment

**Epic/Release:** `E15` / `R5`  
**Owner:** B2G Lead  
**Affected:** expert/client/admin/web/backend

**Outcome:** вклад этой истории в результат «Практиканты работают только в безопасной управляемой модели.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] intern heavy-topic denial
- [ ] active supervisor required
- [ ] explicit client consent
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S15-04 — Client explicit consent

**Epic/Release:** `E15` / `R5`  
**Owner:** B2G Lead  
**Affected:** expert/client/admin/web/backend

**Outcome:** вклад этой истории в результат «Практиканты работают только в безопасной управляемой модели.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S15-05 — Topic eligibility

**Epic/Release:** `E15` / `R5`  
**Owner:** B2G Lead  
**Affected:** expert/client/admin/web/backend

**Outcome:** вклад этой истории в результат «Практиканты работают только в безопасной управляемой модели.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S15-06 — De-identified supervision

**Epic/Release:** `E15` / `R5`  
**Owner:** B2G Lead  
**Affected:** expert/client/admin/web/backend

**Outcome:** вклад этой истории в результат «Практиканты работают только в безопасной управляемой модели.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S15-07 — Hours ledger/report

**Epic/Release:** `E15` / `R5`  
**Owner:** B2G Lead  
**Affected:** expert/client/admin/web/backend

**Outcome:** вклад этой истории в результат «Практиканты работают только в безопасной управляемой модели.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] idempotency test
- [ ] provider duplicate/timeout test
- [ ] money shown from authoritative state
- [ ] intern heavy-topic denial
- [ ] active supervisor required
- [ ] explicit client consent
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S15-08 — Graduation to standard applicant

**Epic/Release:** `E15` / `R5`  
**Owner:** B2G Lead  
**Affected:** expert/client/admin/web/backend

**Outcome:** вклад этой истории в результат «Практиканты работают только в безопасной управляемой модели.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S16-01 — Legal service discovery

**Epic/Release:** `E16` / `R6`  
**Owner:** Discovery Lead  
**Affected:** separate discovery artifacts only

**Outcome:** вклад этой истории в результат «Legal vertical, wearables и AI допускаются только после discovery, safety и legal gates.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S16-02 — Wearable privacy/clinical study

**Epic/Release:** `E16` / `R6`  
**Owner:** Discovery Lead  
**Affected:** separate discovery artifacts only

**Outcome:** вклад этой истории в результат «Legal vertical, wearables и AI допускаются только после discovery, safety и legal gates.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] PII allow-list test
- [ ] retention/owner documented
- [ ] no sensitive free text
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S16-03 — AI feature risk assessment

**Epic/Release:** `E16` / `R6`  
**Owner:** Discovery Lead  
**Affected:** separate discovery artifacts only

**Outcome:** вклад этой истории в результат «Legal vertical, wearables и AI допускаются только после discovery, safety и legal gates.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.
### S16-04 — Separate prototype and business case

**Epic/Release:** `E16` / `R6`  
**Owner:** Discovery Lead  
**Affected:** separate discovery artifacts only

**Outcome:** вклад этой истории в результат «Legal vertical, wearables и AI допускаются только после discovery, safety и legal gates.».

**Scope**
- минимальный вертикальный срез, необходимый для названного outcome;
- существующий код сохраняется, если он не нарушает канон;
- contract, UI states, permissions, analytics и evidence входят в одну историю, если без них outcome нельзя проверить.

**Out of scope**
- несвязанный рефакторинг;
- обновление стека «заодно»;
- новые функции, отсутствующие в use case;
- массовое переименование/переформатирование;
- fake data в production route.

**Acceptance**
- [ ] happy path automated or reproducible
- [ ] error/empty/offline states covered
- [ ] RU/KK copy and accessibility checked
- [ ] Все связанные тесты зелёные; новые critical branches покрыты.
- [ ] Screen registry/traceability/decision log обновлены.
- [ ] Нет P0/P1 regression соседнего flow.
- [ ] Есть точная команда или сценарий проверки и evidence.

**Rollback:** feature flag/совместимый route/обратимая миграция либо документированная процедура возврата к предыдущему поведению.


## 6. WIP и размер изменений

- одна команда/ИИ-сессия — одна story;
- одна story в идеале меняет 2–8 логически связанных файлов на поверхность, но outcome важнее формального лимита;
- не более двух параллельных stories в одном domain boundary;
- schema/API/UI migration разбивается только если промежуточное состояние безопасно;
- feature не считается законченной без соседних error/offline/permission states;
- невыполненный device/manual gate остаётся открытым долгом и блокирует соответствующий release.
