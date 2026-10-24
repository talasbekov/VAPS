# 06 — Роли и права

Статус: готов · Дата: 2026-09-13 · По коду (`JwtAuthGuard`, `ExpertGuard`, `AdminJwtGuard + RolesGuard`, DTO) и ТЗ §3.
Связано: [[05_PRODUCT_DEFINITION]], [[10_DOMAIN_API_AND_EVENTS]], [[12_SECURITY_AND_PRIVACY]].

## 1. Модель ролей

Идентичности в коде — две: **User** (клиенты и эксперты; эксперт = User + Expert-анкета) и **AdminUser** (сотрудники; отдельные таблицы токенов, отдельный guard). Роль клиента/эксперта не хранится полем — выводится из наличия анкеты (`ExpertGuard`) и её статусов.

| ID | Роль | Как определяется в коде | Цели | Канал | Жизненный цикл |
|---|---|---|---|---|---|
| R-GUEST | Гость | `User.isGuest=true`, `deviceId` | помощь без имени | приложение (веб — нет) | `POST /auth/guest` → конверсия `guest/convert` → Клиент; удаление `DELETE /me` |
| R-CLIENT | Клиент | `User` с `phone`, без анкеты | помощь, планирование | приложение, веб | регистрация → (согласие Р-27) → удаление |
| R-CLIENT-PREMIUM | Клиент Premium | `Subscription` ACTIVE/GRACE/CANCELLED до `currentPeriodEnd` (частичный индекс «одна живая») | приоритет, скидка, контент | те же | subscribe → renew/grace → expired |
| R-EXPERT-APPLICANT | Кандидат | `Expert.verificationStatus ∈ {DRAFT, PENDING}` | пройти проверку | приложение, веб (статус) | анкета → документы → submit → решение |
| R-EXPERT-VERIFIED | Верифицированный эксперт | `VERIFIED && !isBlocked` | принимать заявки, зарабатывать | приложение, веб | статусы работы, расписание |
| R-EXPERT-BLOCKED | Заблокированный | `isBlocked=true` | восстановить доступ через поддержку | экран «профиль заблокирован» | block → unblock |
| R-ADM-VERIFICATION | Оператор верификации | `AdminRole.VERIFICATION_OPERATOR` | очередь, документы, модерация профилей, блокировка | админка | создаётся SUPERADMIN, деактивация отзывает токены |
| R-ADM-SUPPORT | Оператор поддержки | `SUPPORT_OPERATOR` | тикеты своей команды | админка | — |
| R-ADM-QUALITY | Команда качества | `QUALITY_TEAM` | модерация отзывов, флаг <4.0, тикеты категории безопасность/качество | админка | — |
| R-ADM-FINANCE | Финконтроль | `FINANCE_CONTROL` | выводы >300 тыс., тикеты по выплатам | админка | — |
| R-ADM-CONTENT | Редактор контента | `CONTENT_EDITOR` | CMS | админка | — |
| R-ADM-SUPER | Суперадмин | `SUPERADMIN` (нельзя деактивировать последнего) | сотрудники, всё остальное **только там, где явно разрешено** | админка | bootstrap из env / CLI |
| R-SYSTEM | Система | `actorType='system'` в audit; интервал-задачи, вебхуки | таймеры, settle, sweep | — | — |
| *v2-кандидаты* | Корпоративный клиент (B2B), Практикант (B2G), «Модератор» | нет в коде | — | — | требуют Q-06/Q-07/Q-09 |

[FACT] `SUPERADMIN` **не** является суперролью в `RolesGuard`: у эндпоинтов верификации, отзывов, выплат он не перечислен (`@Roles(AdminRole.VERIFICATION_OPERATOR)` и т.п.) — суперадмин без соответствующей роли получит 403; тикеты — исключение (SUPERADMIN видит все команды). [DECISION] Сохранить: явные роли безопаснее неявного «всё можно»; в UI показывать суперадмину подсказку «добавьте себе роль».

## 2. Матрица RBAC/ABAC: Роль × Ресурс × Действие × Условие

Условия ABAC (проверяются в сервисах, не в guard): **owner** — `userId` совпадает; **participant** — клиент или эксперт консультации (`resolveParticipant`); **active** — статус ACTIVE; **consented** — `expertVisibilityAcceptedAt` не null и консультация после этого момента; **team** — `Ticket.team` ∈ роли сотрудника.

| Ресурс | Действие | GUEST | CLIENT | EXPERT-VER | EXPERT-APP | ADM-VERIF | ADM-SUPPORT | ADM-QUALITY | ADM-FINANCE | ADM-CONTENT | ADM-SUPER | SYSTEM |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Topics | read | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — | — | — |
| Experts (public) | list/read | ✓ (аноним) | ✓ | ✓ | ✓ | — | — | — | — | — | — | — |
| Expert profile (me) | create/update | — | ✓ (создать анкету) | ✓ owner | ✓ owner | — | — | — | — | — | — | — |
| Expert documents | upload/submit | — | — | ✓ owner | ✓ owner | read (presigned) | — | — | — | — | — | — |
| Verification decisions | approve/reject/block | — | — | — | — | ✓ | — | ✓ (flagged) | — | — | ✗ без роли | — |
| Work status / heartbeat / schedule | update | — | — | ✓ owner | ✓ owner (не попадает в матчинг: не VERIFIED) | — | — | — | — | — | — | BUSY автоматически |
| Request | create | ✓ (abuse-гейт → только directed) | ✓ | ✓ (как клиент) | ✓ | — | — | — | — | — | — | timeout/broadcast/callback |
| Request | read/cancel | owner | owner | — | — | — | — | — | — | — | — | — |
| Offer | list/accept/decline | — | — | ✓ owner, VERIFIED && !blocked && оффер PENDING и не просрочен | — | — | — | — | — | — | — | timeout/revoke |
| Consultation | read | participant | participant | participant | — | — | — | — | — | — | — | — |
| Consultation | cancel (client) | participant | participant | — | — | — | — | — | — | — | — | — |
| Consultation | complete/outcome, cancel-by-expert | — | — | participant && active | — | — | — | — | — | — | — | no-show hint |
| Consultation | media-token | participant && active | participant && active | participant && active | — | — | — | — | — | — | — | — |
| Chat messages | read/send/typing | participant | participant | participant && active | — | — | — | — | — | — | — | — |
| Expert note | read/write | — | — | participant && owner(expert) | — | — | — | — | — | — | — | — |
| Review | create/delete | participant-client (COMPLETED) | то же | — | — | — | — | — | — | — | — | — |
| Review | reply/complaint | — | — | owner(expert), PUBLISHED | — | — | — | resolve FLAGGED | — | — | — | — |
| Booking / slots | read/create/reschedule | ✓ | ✓ | (как клиент) | — | — | — | — | — | — | — | sweep activate |
| Payment methods | CRUD | owner | owner | owner | — | — | — | — | — | — | — | — |
| Payment | pay/status | participant-client | то же | — | — | — | — | — | — | — | — | settle/rehold/webhook |
| Earnings/balance | read | — | — | owner | — | — | — | — | — | — | — | — |
| Payout | request/list | — | — | owner | — | — | — | — | approve/reject (PENDING_REVIEW) | — | — | webhook paid |
| Premium | plans read | ✓ аноним | ✓ | ✓ | ✓ | — | — | — | — | — | — | renewal |
| Premium | subscribe/cancel/status | — | owner | owner | — | — | — | — | — | — | — | — |
| Content | list/read | ✓ аноним (список, карточка) | ✓ | ✓ | ✓ | — | — | — | — | — | — | — |
| Content | media/body PREMIUM, progress, vote, streak | ✗ | ✓ (PREMIUM — только с подпиской) | ✓ | — | — | — | — | — | CRUD | CRUD | — |
| Notifications | list/read/ack | owner | owner | owner | — | — | — | — | — | — | — | dispatch |
| Devices/locale | register/remove/locale | owner | owner | owner | — | — | — | — | — | — | — | — |
| Favorites | CRUD | owner | owner | owner | — | — | — | — | — | — | — | — |
| Account | profile/consent/delete | owner | owner | owner (удаление отклоняется при активной консультации/невыведенном балансе) | — | — | — | — | — | — | — | — |
| Expert clients (Р-27) | list/detail | — | — | owner && consented; телефон никогда | — | — | — | — | — | — | — | access log |
| Tickets | create/read/reply | ✓ (гость: контакт обязателен) | owner | owner | owner | team | team | team | team | — | все команды | — |
| Tickets (admin) | assign/reply/resolve | — | — | — | — | team | team | team | team | — | ✓ | — |
| Staff | list/create/update | — | — | — | — | — | — | — | — | — | ✓ | — |
| Audit log | read | — | — | — | — | — | — | — | — | — | ✗ (нет эндпоинта) | write |
| Webhooks | livekit/payments/payouts | — | — | — | — | — | — | — | — | — | — | подпись |

## 3. Данные, недоступные ролям (инварианты)

| Кому | Что запрещено | Где обеспечено |
|---|---|---|
| Эксперту | телефон клиента — всегда; имя и история — без согласия; консультации до согласия | `ClientDetailDto`, `clients.service.ts`, e2e `expert-visibility-consent` |
| Эксперту | чужие консультации/чат/заметки | `resolveParticipant`, `ExpertGuard`, e2e `chat`, `expert-notes` |
| Клиенту | приватные заметки эксперта, приватный текст чужих отзывов | DTO `ConsultationClientDto`; `privateText` только QUALITY |
| Сотрудникам | содержимое консультаций (чат, заметки) | эндпоинтов нет; метаданные — с журналом `consultation.*_read` |
| Сотрудникам без роли | чужие разделы | `RolesGuard` (403) |
| Всем | PAN карты | `PaymentMethod.providerToken` + `maskedPan` |
| Анониму | тело PREMIUM-материала, медиа | `content` (закрыто 2026-09-02, e2e `content-paywall`) |

## 4. Переходы между ролями

`Гость → Клиент` (`guest/convert`: переносятся активная консультация, карта, статистика; история с других устройств не восстанавливается — Р-22) · `Клиент → Кандидат` (`POST /experts`; один User — одна анкета, `userId` unique) · `Кандидат → Верифицированный` (решение оператора) · `Верифицированный ↔ Заблокированный` (Р-19; разблокировка через тикет) · `Клиент ↔ Premium` (подписка) · `Сотрудник: роли меняет SUPERADMIN` (`PATCH /admin/staff/{id}`), деактивация отзывает refresh-токены.

## 5. Пробелы модели ролей (для [[14_ROADMAP_AND_BACKLOG]])

- [RISK] Клиент не может быть заблокирован (нет `User.isBlocked`); abuse-гейт живёт в Redis с TTL 30 дней — ТЗ §5.9 требует блокировки клиентов с причиной.
- [RISK] Блокировка эксперта не отзывает его токены и не разрывает WS (см. [[12_SECURITY_AND_PRIVACY]] T-06).
- [QUESTION] Q-09: «Модератор» из прототипа v2 = пресет `VERIFICATION_OPERATOR + QUALITY_TEAM` (рекомендация), а не новая роль.
- [QUESTION] Q-06/Q-07: корпоративный клиент и практикант — новые атрибуты User/Expert, а не роли guard'а; практикант дополнительно ограничен по темам (`HEAVY_TOPICS`).
