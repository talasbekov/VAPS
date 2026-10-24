# 10 — Домен, API и события

Статус: готов · Дата: 2026-09-13 · AS-IS по коду; TO-BE-переходы помечены `[TO-BE]`.
Связано: [[03_AS_IS_ARCHITECTURE]], [[09_TARGET_ARCHITECTURE]], [[17_TRACEABILITY_MATRIX]], `docs/openapi.json` (108 путей / 123 операции, версия 1.0, security `bearer`).

## 1. Формальные машины состояний

Формат переходов: **актор · команда · предусловие · транзакция · результат · событие · отказ · идемпотентность · audit**.

### 1.1 User / Auth
| Переход | Актор | Команда | Предусловие | Результат | Событие | Отказ | Идемпотентность | Audit |
|---|---|---|---|---|---|---|---|---|
| ∅ → Guest | клиент | `POST /auth/guest {deviceId}` | — | User{isGuest} (или существующий по deviceId) | — | 400 | по deviceId (partial unique) | `user.registered` |
| ∅/Guest → Registered | клиент | `request-code` → `verify-code` / `guest/convert` | код верный ≤5 попыток, TTL 5 мин | User{phone}; при convert — перенос консультации/карты | — | 400 `SMS_CODE_INVALID`, 429 | код одноразовый | `user.registered` |
| tokens → tokens' | клиент | `POST /auth/refresh` | refresh не отозван, не истёк | старый `revokedAt`, новый выдан | — | 401 | ротация атомарна (update where revokedAt null) | — |
| Registered → Deleted | клиент | `DELETE /me` | нет ACTIVE-консультации, нет невыведенного баланса | PII обезличен, `deletedAt`, токены отозваны, чат/заметки/устройства удалены | — | 409 | повтор → 404 | `user.deleted` [TO-BE: проверить наличие] |

### 1.2 Верификация эксперта — см. [[03_AS_IS_ARCHITECTURE]] §7.4; audit: `expert.document_approved/rejected`, `expert.verified`, `expert.verification_rejected`, `expert.blocked/unblocked`; уведомления `verification.approved/rejected`. [TO-BE] Q-07: второй поток практикантов — отдельный `Expert.kind`.

### 1.3 Доступность эксперта
`NOT_ACCEPTING → ACCEPTING` (эксперт, `PATCH work-status`, VERIFIED && !blocked; presence add) · `ACCEPTING → BUSY` (система при ACTIVE) · `BUSY → ACCEPTING` (система при завершении) · `* → UNAVAILABLE/NOT_ACCEPTING` (эксперт; presence remove) · свежесть: heartbeat ≤ stale → в матчинге. Audit `expert.work_status_changed`.

### 1.4 Request и 1.5 Candidate Offer — диаграммы в [[03_AS_IS_ARCHITECTURE]] §7.1–7.2. Инварианты: не более одного PENDING на пару (заявка, эксперт) — partial unique; у обычной заявки не более одного PENDING — логика `offerToNext` с перечиткой статуса; accept атомарен (tx + `consultations.request_id` unique + `expert_active_uq`); дедлайн в БД, таймер — сканом каждые 1 с; audit `request.created/matched/no_experts/cancelled/broadcast/callback_requested/auto_match_blocked`, `offer.sent/accepted/declined/timeout/revoked`.

### 1.6 Consultation — §7.3. Инварианты: одна ACTIVE на эксперта; `priceTiyn` — снимок; исход задаёт settle; `remindedAt`/`noShowNotifiedAt` защищают от повторов после рестарта. Audit `consultation.created/activated/completed/cancelled/cancelled_by_client/late_cancelled/reminder_sent/no_show_hint/*_read`.

### 1.7 Chat / Call connection
`disconnected → connected(ready)` (клиент, JWT) → `subscribed` (комнаты) → `chat.send` разрешён только participant && ACTIVE → `chat.error{code}` иначе. Звонок: `no-token → token(format)` (participant && ACTIVE) → `joined` (вебхук) → `left`; `noShowHint` при отсутствии второй стороны 3 мин. [TO-BE] `events?since` для ресинка.

### 1.8 Review moderation
`∅ → PUBLISHED` (клиент, консультация COMPLETED, один отзыв) · `PUBLISHED → FLAGGED` (эксперт, complaint) · `FLAGGED → HIDDEN | PUBLISHED` (QUALITY_TEAM, resolve) · `PUBLISHED → deleted` (клиент, пересчёт рейтинга) · ответ эксперта не меняет статус. Audit `review.*` [TO-BE: добавить, сейчас через `reviews.service` — проверить].

### 1.9 Document verification
`UPLOADED → APPROVED | REUPLOAD_REQUIRED` (оператор) · `REUPLOAD_REQUIRED → UPLOADED` (эксперт заменяет) · при VERIFIED замена документа → проверка только его.

### 1.10 Деньги
Payment: `PENDING → HELD → CAPTURED | VOIDED | FAILED`; `HELD → HELD (reheld)`; `HELD → VOIDED (hold_voided_by_bank)`; settle ретраи 10 × 60 с → `settle_exhausted` (алерт). Payout: `∅ → PENDING_REVIEW | PROCESSING` (порог 300 000 ₸/мес) → `PAID | REJECTED` (резерв возвращается). Subscription: `ACTIVE → GRACE → ACTIVE|EXPIRED`, `ACTIVE → CANCELLED → EXPIRED`. Ledger: каждая операция — транзакция с записями дебет=кредит; `@@unique(kind, refId)`.

## 2. Инвентаризация эндпоинтов

Полная таблица (метод, путь, контроллер, security, DTO запроса/ответа, коды) — сгенерирована из OpenAPI и хранится рядом: [[planning/10a_ENDPOINT_TABLE|10a — таблица эндпоинтов]]. Ниже — сводка по группам с ролями, побочными эффектами и тестами.

| Группа (тег) | Эндпоинты | Роль / guard | Побочные эффекты и события | Идемпотентность | Тесты |
|---|---|---|---|---|---|
| App | `GET /`, `GET /health` | публично | — | — | `health` |
| auth | `POST /auth/guest`, `guest/convert`, `refresh`, `request-code`, `verify-code` | публично / bearer (convert) | SMS; токены; audit | код одноразовый; refresh-ротация | `auth-*`, `throttling` |
| account | `GET /me`, `POST /me/expert-visibility`, `DELETE /me` | bearer | согласие (время); каскадное удаление | повторное согласие не сдвигает дату | `account-delete`, `expert-visibility-consent` |
| devices | `POST/DELETE /devices`, `PATCH /me/locale` | bearer | upsert токена (перепривязка) | upsert | `devices` |
| topics | `GET /topics` | публично | — | — | `topics` |
| experts | `GET /experts`, `GET /experts/{id}`, `POST /experts`, `GET/PATCH /experts/me`, `work-status`, `heartbeat`, `documents*`, `photo`, `clients*` | публично / bearer / ExpertGuard | presence; S3; модерация; журнал доступа к клиентам | документы: один на тип (unique) | 12 наборов |
| booking / offers / requests / matching | `GET /experts/{id}/slots`, `POST /bookings`, `POST /requests`, `GET /requests/{id}`, `cancel`, `GET /experts/me/offers`, `accept`, `decline`, `GET /matching/online-count` | bearer / ExpertGuard | заявка → оффер → WS/push/SMS; консультация; BUSY; холд (booking) | accept: 409/410; слот: partial unique; [TO-BE] `Idempotency-Key` на create | `requests-*`, `matching-*`, `booking-*`, `slots` |
| consultations | `GET /consultations`, `GET /{id}`, `cancel`, `cancel-by-expert`, `complete`, `reschedule`, `media-token`, `messages`, `note` | bearer + participant | settle; ACCEPTING; уведомления; журнал доступа | complete: 409 при повторе | 8 наборов |
| payments / payment-methods / payouts | `payment-methods` CRUD, `pay`, `payment`, `earnings(/daily)`, `balance`, `payouts`, `admin/payouts*` | bearer / ExpertGuard / FINANCE_CONTROL | провайдер hold/capture/void; ledger; уведомления | `hold:{id}:{attempt}`, `@@unique(kind,refId)` | 9 наборов |
| premium | `GET /premium/plans` (публично), `GET /premium`, `subscribe`, `cancel` | bearer | charge; подписка | одна живая подписка (partial unique) | `premium-*` |
| reviews | `POST /consultations/{id}/review`, `DELETE /reviews/{id}`, `reply`, `complaint`, `GET /experts/{id}/reviews`, `GET /experts/me/reviews`, `admin/reviews*` | bearer / QUALITY_TEAM | рейтинг; FLAGGED | один отзыв на консультацию | `reviews*` |
| content | `GET /content*` (список/карточка публично), `media`, `progress`, `vote`, `streak`, `admin/content*` | публично / bearer / CONTENT_EDITOR+SUPERADMIN | presigned; пейволл | — | `content-*` |
| notifications | `GET /notifications`, `read`, `ack` | bearer | метрика доставки | — | `notifications-*` |
| tickets | `GET/POST /tickets`, `{id}`, `reply`, `admin/tickets*` | bearer (гость с контактом) / роли команд | уведомление автору | — | `tickets-*` |
| admin | `admin/auth/*`, `admin/staff*`, `admin/verification*`, `admin/experts/*`, `admin/profile-moderation*` | публично (login) / роли | TOTP, lockout; решения; блокировки | — | `admin-*`, `profile-moderation` |
| webhooks | `POST /webhooks/livekit`, `payments`, `payouts` | без guard, подпись | join/leave; статусы платежей/выплат | `ProviderEvent(kind, id)` для платежей/выплат; [TO-BE] для LiveKit | `media`, `payments-sweep`, `payouts` |

Полнота: 123 операции описаны в OpenAPI с `summary` у большинства; без `summary` — content/favorites/payment-methods/premium (HARDEN: описания и примеры). Коды ошибок задокументированы частично (см. таблицу 10a).

## 3. WebSocket-контракт

| Событие | Направление | Payload (AS-IS) | Получатель / комната | Условие | Reconnect / дубли | [TO-BE] |
|---|---|---|---|---|---|---|
| `ready` | S→C | `{expertId|null}` | сокет | после join комнат | клиент ждёт перед подписками | — |
| `request.updated` | S→C | `RequestDto` | `user:{client}` | любой переход заявки | ресинк `GET /requests/{id}` | `version` |
| `offer.new` | S→C | `OfferDto` (тема, формат, код клиента, цена, `deadlineAt`) | `expert:{id}` | создание PENDING | дублируется пушем + SMS; после reconnect `GET /experts/me/offers` | — |
| `offer.revoked` | S→C | `{offerId, requestId}` | `expert:{id}` | REVOKED/TIMEOUT | — | — |
| `consultation.updated` | S→C | `Consultation*Dto` | обе комнаты | создание, эскалация формата, завершение, no-show hint | ресинк `GET /consultations/{id}` | `version` |
| `chat.message` | S→C | `{id, consultationId, senderRole, text, createdAt}` | обе комнаты (включая отправителя) | после персиста | история `GET messages` | ack не нужен |
| `chat.typing` | C→S→C | `{consultationId, senderRole}` | вторая сторона | participant | не критично | — |
| `chat.send` | C→S | `{consultationId, text}` | — | participant && ACTIVE | `chat.error{code}` | `clientMessageId` для дедупа |
| `chat.error` | S→C | `{code}` | сокет | ошибка send | — | — |
| `notification.new` | S→C | `NotificationDto` | `user:{id}` | dispatch | центр перезапрашивается | — |

Namespace `/ws`; auth `handshake.auth.token`; версионирование: отсутствует → [TO-BE] `contracts/ws-events.md` + поле `v` в payload.

## 4. Ошибки, идемпотентность, версии

Envelope `{error:{code,message,details?}}`; коды из `apiError` (примеры: `SMS_CODE_INVALID`, `EXPERT_NOT_FOUND`, `OFFER_EXPIRED` 410, `EXPERT_VISIBILITY_CONSENT_REQUIRED` 409, `AUTO_MATCH_BLOCKED` 409, `PAYWALL` 403). [TO-BE] `contracts/errors.md` — единый список с HTTP-кодом и действием клиента. Rate limit — 429 с `Retry-After`. Версия `/v1`; смена контракта — по правилам [[09_TARGET_ARCHITECTURE]] §4.

## 5. Трассируемость (пример строки; полная — [[17_TRACEABILITY_MATRIX]])

`REQ-5.3-02 «таймер 45 с/20 с» → R-EXPERT-VERIFIED → UF-06/07 → EX-Offer, EW-Заявки → POST /offers/{id}/accept → offer.new/revoked → RequestCandidate.deadlineAt → request-timers.e2e, matching-accept-race.e2e → E3 (done) → —`

## 6. Модель данных — таблица по моделям

| Модель | Владелец | Связи | Индексы | Чувствительность | Lifecycle / ретенция | Инварианты | Миграции | Тесты |
|---|---|---|---|---|---|---|---|---|
| User | auth/account | Expert 1:1, RefreshToken, Subscription, Content* | phone unique; guest partial unique(deviceId) | PII (phone, displayName) | обезличивание при удалении; строка остаётся | один телефон; `expertVisibilityAcceptedAt` — время | core_init, guest_device_id, user_deleted_at, r27 | auth-*, account-delete |
| SmsCode | auth | — | phone unique | секрет (hash) | TTL 5 мин | ≤5 попыток | core_init | auth-* |
| RefreshToken / AdminRefreshToken | auth/admin | User / AdminUser (cascade) | tokenHash unique | секрет (hash) | 30 дн; отзыв | ротация | core_init, admin_refresh_tokens(+cascade) | auth-verify, admin-session |
| Topic | topics | ExpertTopic, Request, Consultation | slug unique | — | справочник | 12 тем ru/kz | core_init | topics |
| AuditLog | audit | — | (entity, entityId) | может содержать PII в payload | бессрочно | append-only | core_init | audit spec |
| Expert (+ExpertTopic, ExpertDocument, ExpertScheduleDay, ScheduleException) | experts/verification/schedule | User (FK) | photoStatus, aboutStatus; documents unique(expert,type); exceptions unique(expert,date) | PII эксперта, документы (ключи) | документы — без ретенции | цена в коридоре; VERIFIED для матчинга | expert_core, public_profile, submitted_at, scheduled | 12+ наборов |
| Request / RequestCandidate | requests | Topic (FK); candidates → expert без FK | (client,status); (request); (expert,response); partial unique pending per expert | clientCode (псевдоним) | закрытые — бессрочно | см. §1.4 | requests_core, one_pending, pending_per_expert | requests-*, matching-* |
| Favorite | favorites | без FK | pk(user,expert) | — | удаляется при удалении аккаунта | — | requests_core | favorites |
| Consultation (+ChatMessage, ExpertNote, Review) | consultations/chat/reviews | Topic FK; внутренние FK; без FK на users/experts | (client,status), (expert,status), (status,startedAt); partial unique slot/active; messages (consultation, createdAt); reviews (expert,status) | **медицинская тайна**: ciphertext чата и заметок; отзывы | чат/заметки удаляются при `DELETE /me`; **срок хранения не задан** | одна ACTIVE на эксперта; один отзыв | consultations_core, scheduled_*, expert_single_active | consultation-*, chat, reviews |
| PaymentMethod / Payment / LedgerTransaction / LedgerEntry / Payout / ProviderEvent | payments/ledger/payouts | без FK | см. схему | финансовые; токен карты у провайдера; maskedPan | ProviderEvent 30 дн; остальное бессрочно | тиыны; дебет=кредит; unique(kind, refId); unique(kind, providerEventId) | payments_core, payments_hardening | 9 наборов |
| Device | devices | без FK | token unique | push-токен | удаляется при удалении аккаунта | глобальная уникальность | notifications_core | devices |
| AdminUser / AdminRecoveryCode | admin | cascade | email unique; codeHash unique | секреты (bcrypt, TOTP зашифрован) | деактивация | последний SUPERADMIN защищён | admin_rbac, admin_totp | admin-* |
| Notification / NotificationOutbox | notifications | без FK | (user,createdAt), (user,readAt), (type,delivered,sms) + partial | содержимое шаблонов (без текста чата) | прочитанные 90 дн; непрочитанные — никогда | outbox: attempts ≤5 | notifications_core, notification_outbox, retention_partial_index | notifications-*, outbox, retention |
| Ticket / TicketMessage | tickets | без FK | (team,status,createdAt), (author,createdAt) | контакты гостя, тексты обращений | бессрочно | маршрутизация в команду | tickets_core, reorder_index, assignment | tickets-* |
| Subscription | premium | User FK | (status, periodEnd); partial unique живая | финансовые | — | одна живая | premium | premium-* |
| ContentItem / ContentProgress / ContentVote | content | cascade | (kind,published,sort), (category,published); unique(user,item) | — | — | payload по kind | content, content_editor_role | content-* |

Отсутствующие сущности прототипа v2: Complaint, B2BContract, B2GContract, Tariff, Mailing, User.city/isCorporate, Expert.tier/isIntern/university/iin — см. [[16_RISKS_QUESTIONS_AND_ADRS]].
