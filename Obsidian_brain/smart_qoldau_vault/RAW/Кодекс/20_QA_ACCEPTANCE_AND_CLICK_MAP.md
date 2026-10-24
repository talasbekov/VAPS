# 20. QA, acceptance и click-map

## 1. Почему прежних unit/widget тестов недостаточно

Fable уже зафиксировал headless tests для Flutter, но часть Android/device, LiveKit и integration flows не была прогнана из-за окружения. Release gate не закрывается фразой «код покрыт тестами», если пользовательский звонок, permission, killed-state push или reconnect не проверен на целевой платформе.

## 2. Test layers

| Layer | Что доказывает | Обязателен для |
| --- | --- | --- |
| Unit/domain | state/rule/calculation | все business rules |
| Contract | client ↔ OpenAPI/WS | все API changes |
| Repository/integration | DB/Redis/S3/provider adapter | persistence/concurrency |
| API e2e | role, errors, transitions | critical endpoints |
| Widget/component | UI logic/states/a11y basics | screens/components |
| Browser e2e | routes/BFF/auth/role flows | web/admin |
| Mobile integration | navigation/permissions/deep links | Flutter apps |
| Real device | audio/video/push/background | R2 release |
| Visual regression | prototype/token/layout drift | P0/P1 screens |
| Security/privacy | authz/PII/webhook/bucket | sensitive features |
| Performance/reliability | p95/reconnect/load | matching/realtime/media |

## 3. Click-map

`Actual`, `Verdict` и evidence должны заполняться реальным прогоном. Blueprint не подменяет тестирование выдуманным PASS.

| Flow | Step | Role | Action | Expected | Actual | Evidence | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CF-001 | 01 | GUEST_CLIENT/REGISTERED_CLIENT | Welcome/Auth | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-001 | 02 | GUEST_CLIENT/REGISTERED_CLIENT | Home/SOS boundary | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-001 | 03 | GUEST_CLIENT/REGISTERED_CLIENT | Topic/format | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-001 | 04 | GUEST_CLIENT/REGISTERED_CLIENT | Search | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-001 | 05 | GUEST_CLIENT/REGISTERED_CLIENT | Found/payment | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-001 | 06 | GUEST_CLIENT/REGISTERED_CLIENT | Session | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-001 | 07 | GUEST_CLIENT/REGISTERED_CLIENT | Complete/review | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-002 | 01 | REGISTERED_CLIENT | Catalog | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-002 | 02 | REGISTERED_CLIENT | Expert profile | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-002 | 03 | REGISTERED_CLIENT | Slot picker | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-002 | 04 | REGISTERED_CLIENT | Price/policy | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-002 | 05 | REGISTERED_CLIENT | Booking | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-002 | 06 | REGISTERED_CLIENT | Reminder | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-002 | 07 | REGISTERED_CLIENT | Join/reschedule/cancel | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-003 | 01 | REGISTERED_CLIENT | Materials | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-003 | 02 | REGISTERED_CLIENT | Locked item | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-003 | 03 | REGISTERED_CLIENT | Premium plans | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-003 | 04 | REGISTERED_CLIENT | Payment | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-003 | 05 | REGISTERED_CLIENT | Entitlement | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-003 | 06 | REGISTERED_CLIENT | Media/progress | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-003 | 07 | REGISTERED_CLIENT | Cancel renewal | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-004 | 01 | EXPERT_APPLICANT | Auth | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-004 | 02 | EXPERT_APPLICANT | Onboarding | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-004 | 03 | EXPERT_APPLICANT | Documents | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-004 | 04 | EXPERT_APPLICANT | Submit | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-004 | 05 | EXPERT_APPLICANT | Admin review | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-004 | 06 | EXPERT_APPLICANT | Reupload/approve | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-004 | 07 | EXPERT_APPLICANT | Profile/tariff/schedule | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-005 | 01 | VERIFIED_EXPERT | Availability | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-005 | 02 | VERIFIED_EXPERT | Incoming offer | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-005 | 03 | VERIFIED_EXPERT | Accept | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-005 | 04 | VERIFIED_EXPERT | Session | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-005 | 05 | VERIFIED_EXPERT | Note | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-005 | 06 | VERIFIED_EXPERT | Complete | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-005 | 07 | VERIFIED_EXPERT | Earnings | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-006 | 01 | VERIFICATION_OPERATOR | Login/2FA | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-006 | 02 | VERIFICATION_OPERATOR | Queue/SLA | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-006 | 03 | VERIFICATION_OPERATOR | Documents | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-006 | 04 | VERIFICATION_OPERATOR | Decision | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-006 | 05 | VERIFICATION_OPERATOR | Audit | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-006 | 06 | VERIFICATION_OPERATOR | Expert notification | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-007 | 01 | REGISTERED_CLIENT + QUALITY_TEAM + FINANCE_CONTROL | Create complaint | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-007 | 02 | REGISTERED_CLIENT + QUALITY_TEAM + FINANCE_CONTROL | Triage | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-007 | 03 | REGISTERED_CLIENT + QUALITY_TEAM + FINANCE_CONTROL | Expert response | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-007 | 04 | REGISTERED_CLIENT + QUALITY_TEAM + FINANCE_CONTROL | Decision | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-007 | 05 | REGISTERED_CLIENT + QUALITY_TEAM + FINANCE_CONTROL | Refund | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-007 | 06 | REGISTERED_CLIENT + QUALITY_TEAM + FINANCE_CONTROL | Notifications | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-007 | 07 | REGISTERED_CLIENT + QUALITY_TEAM + FINANCE_CONTROL | Close/appeal | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-008 | 01 | Client/Expert + SUPPORT_OPERATOR | Create ticket | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-008 | 02 | Client/Expert + SUPPORT_OPERATOR | Priority/category | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-008 | 03 | Client/Expert + SUPPORT_OPERATOR | Assign | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-008 | 04 | Client/Expert + SUPPORT_OPERATOR | Reply/escalate | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-008 | 05 | Client/Expert + SUPPORT_OPERATOR | Resolution | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-008 | 06 | Client/Expert + SUPPORT_OPERATOR | Close | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-009 | 01 | all staff roles | Login | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-009 | 02 | all staff roles | Menu visibility | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-009 | 03 | all staff roles | Direct URL | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-009 | 04 | all staff roles | API permission | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-009 | 05 | all staff roles | Audit | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-009 | 06 | all staff roles | Last superadmin protection | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-010 | 01 | CORPORATE_BENEFICIARY + ORG_REP | Lead/contract | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-010 | 02 | CORPORATE_BENEFICIARY + ORG_REP | Activation | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-010 | 03 | CORPORATE_BENEFICIARY + ORG_REP | Coverage | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-010 | 04 | CORPORATE_BENEFICIARY + ORG_REP | Booking | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-010 | 05 | CORPORATE_BENEFICIARY + ORG_REP | Pool settlement | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-010 | 06 | CORPORATE_BENEFICIARY + ORG_REP | Aggregate report | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-010 | 07 | CORPORATE_BENEFICIARY + ORG_REP | Expiry/renewal | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-011 | 01 | INTERN_EXPERT + SUPERVISOR + CLIENT | Code/documents | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-011 | 02 | INTERN_EXPERT + SUPERVISOR + CLIENT | Verification | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-011 | 03 | INTERN_EXPERT + SUPERVISOR + CLIENT | Assignment | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-011 | 04 | INTERN_EXPERT + SUPERVISOR + CLIENT | Client consent | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-011 | 05 | INTERN_EXPERT + SUPERVISOR + CLIENT | Allowed match | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-011 | 06 | INTERN_EXPERT + SUPERVISOR + CLIENT | Session | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-011 | 07 | INTERN_EXPERT + SUPERVISOR + CLIENT | Supervision | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-011 | 08 | INTERN_EXPERT + SUPERVISOR + CLIENT | Hours | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-012 | 01 | Client + Expert | Socket loss | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-012 | 02 | Client + Expert | Media loss | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-012 | 03 | Client + Expert | Token refresh | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-012 | 04 | Client + Expert | Authoritative resync | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |
| CF-012 | 05 | Client + Expert | No duplicate message/payment/session | Определено use case/screen spec | TO_EXECUTE | screenshot/video/network/API log | OPEN |

## 4. Visual test set

- 390×844 and 430×932 for every P0 client/expert screen;
- 1440×900 for public/expert web/admin P0;
- RU and KK for critical text-heavy screens;
- default/loading/empty/error/offline/forbidden/success;
- light mode only until dark mode approved;
- dynamic text scale 100% and accessibility scale;
- keyboard focus sequence for web/admin;
- screenshot privacy review: no real PII.

## 5. Critical concurrency/reliability tests

- parallel offer accept → one consultation;
- offer timeout vs accept boundary;
- booking same slot from two clients;
- duplicate payment webhook;
- client timeout after provider success;
- refund retry;
- payout retry/provider failure;
- socket disconnect/reconnect and missed-event recovery;
- duplicate message client id;
- LiveKit join webhook delay;
- no-show timer vs late join;
- two admin decisions on one verification/complaint;
- last SUPERADMIN parallel deactivation;
- B2B pool concurrent reserve;
- supervisor removal while intern request is matching.

## 6. GO / NO-GO

### Automatic NO-GO

- unresolved P0/P1 safety, authorization, payment or data loss defect;
- 102/103 flow inaccessible offline/mobile;
- money status can be duplicated or shown as false success;
- client/expert can open чужую consultation;
- critical call flow not tested on target device;
- screen has production fake data;
- RU/KK critical flow incomplete;
- B2B report can identify an employee;
- intern can receive heavy/crisis request;
- visual core flow materially differs from approved prototype without changelog.

### GO evidence bundle

- commit/build identifiers;
- test commands/results;
- click-map with PASS/known accepted deviations;
- visual screenshots/diffs;
- API/DB/provider evidence where applicable;
- accessibility notes;
- incident/rollback plan;
- approvals for intentional deviations.
