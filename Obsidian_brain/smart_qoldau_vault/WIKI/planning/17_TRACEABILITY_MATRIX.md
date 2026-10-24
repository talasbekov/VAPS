# 17 — Матрица трассируемости

Статус: готов · Дата: 2026-09-13 · Цепочка: **Требование → Роль → Поток → Экран → API → Событие → Модель → Тест → Эпик → История**.
ID: требования `REQ-<раздел ТЗ>-<n>` (ТЗ MVP v1.0; v2-требования — `REQ-V2-<n>` до включения в ТЗ v1.1), роли [[06_ROLES_AND_PERMISSIONS]], потоки UF-* [[07_USER_FLOWS_AND_INFORMATION_ARCHITECTURE]], экраны [[11a_SCREEN_REGISTRY]], функции F-* [[04_FEATURE_INVENTORY]], эпики [[14_ROADMAP_AND_BACKLOG]]. Тесты — имена e2e-наборов бэкенда, если не указано иное. «—» в эпике = закрыто ранее (E1–E17).

| REQ | Требование (кратко) | Роль | Поток | Экран | API | Событие | Модель | Тест | Эпик / история | Статус |
|---|---|---|---|---|---|---|---|---|---|---|
| REQ-4-01 | Анонимность: эксперт видит только код клиента; имя по согласию (Р-27) | CLIENT, EXPERT | UF-03, UF-08 | CL-32, EW-05 | `GET /experts/me/clients*`, `POST /me/expert-visibility` | — | User, Consultation.clientCode | `expert-visibility-consent`, `expert-clients`, `expert-public-contract` | — (E17); E17-8 юр | I&T |
| REQ-4-02 | Локализация ru/kz | все | все | все | `PATCH /me/locale` | — | User.locale, Device.locale | web `messages.test`, CI l10n | — | I&T; Q-10 |
| REQ-4-03 | Дисклеймеры 102/103 | CLIENT | UF-04 | CL-09, WB-* (EmergencyBar) | — | — | — | web `EmergencyBar.test` | — | I&T |
| REQ-4-04 | ₸, Asia/Almaty | все | — | — | `earnings/daily` | — | тиыны | `daily-earnings.spec` | — | I&T |
| REQ-4-05 | Audit log всех переходов | SYSTEM | все | AD-10 (журнал) | — | — | AuditLog | `audit.service.spec` | E21-6 (просмотр) | BACKEND_ONLY UI |
| REQ-5.1-01 | Телефон + SMS, повтор 45 с | GUEST/CLIENT | UF-01 | CL-04, WB-15 | `auth/request-code`, `verify-code` | — | SmsCode | `auth-request-code`, `auth-verify`, `throttling` | — | I&T |
| REQ-5.1-02 | Гостевой режим, конверсия (Р-22) | GUEST | UF-01 | CL-03, CL-26 | `auth/guest`, `guest/convert` | — | User | `auth-guest` | — | I&T (веб ✗ по дизайну) |
| REQ-5.1-03 | Удаление аккаунта и данных | CLIENT | UF-23 | CL-26 | `DELETE /me` | — | User.deletedAt | `account-delete` | — | I&T |
| REQ-5.1-04 | Анкета эксперта, цена 2 000–15 000, 4 документа | EXPERT-APP | UF-16 | EX-02, EX-03 | `POST /experts`, `documents/*` | — | Expert, ExpertDocument | `experts-profile`, `experts-documents` | — ; Q-04 | I&T |
| REQ-5.1-05 | JWT + refresh, устройства | все | UF-01 | — | `auth/refresh`, `devices` | — | RefreshToken, Device | `auth-verify`, `devices` | — | I&T |
| REQ-5.2-01 | Очередь верификации, чек-лист, SLA 24 ч | ADM-VERIF | UF-17 | AD-02 | `admin/verification/*` | `verification.*` | Expert.verificationSubmittedAt | `admin-verification` | — | I&T |
| REQ-5.2-02 | Блокировка с причиной, разблокировка | ADM-VERIF | UF-17 | AD-02/AD-03 | `admin/experts/{id}/block` | — | Expert.isBlocked | `admin-lifecycle` | E29 (T-06) | I&T (отзыв токенов ✗) |
| REQ-5.2-03 | Повторная проверка одного документа | EXPERT, ADM-VERIF | UF-18 | EX-04, AD-02 | `documents/{id}/decision` | — | ExpertDocument.status | `admin-verification` | — | I&T |
| REQ-5.3-01 | Автоподбор: фильтры → скоринг → Premium | SYSTEM | UF-03 | CL-08 | `POST /requests` | `request.updated` | Request, RequestCandidate | `matching-*`, `premium-priority` | — | I&T |
| REQ-5.3-02 | Таймер 45/20 с, автоотклонение → следующий | EXPERT | UF-06/07 | EX-07, EW-02 | `offers/{id}/accept|decline` | `offer.new`, `offer.revoked` | RequestCandidate.deadlineAt | `request-timers`, `matching-accept-race` | — | I&T |
| REQ-5.3-03 | Поиск ≤ 2 мин, счётчик онлайн | CLIENT | UF-05 | CL-08, WB-04 | `matching/online-count` | — | — | `matching-online-count`, loadtest | — | I&T |
| REQ-5.3-04 | Статусы эксперта (4), BUSY авто, расписание, срочные | EXPERT | UF-19/20 | EX-05, EX-17, EW-06 | `work-status`, `schedule*`, `availability` | — | Expert.workStatus, ScheduleDay | `experts-status`, `experts-schedule`, `schedule-exceptions` | — | I&T |
| REQ-5.3-05 | Каталог, профиль, избранное, запись к конкретному | CLIENT | UF-15 | CL-11…13, WB-02/03 | `GET /experts*`, `favorites`, `bookings` | — | Favorite | `experts-public`, `favorites`, `booking-create` | — | I&T |
| REQ-5.3-06 | Автоприём (Р-11, R2) | EXPERT | — | EX-05 | ✗ | — | — | — | не запланирован (Q-*: решить в E19) | DOCUMENTED_ONLY |
| REQ-5.4-01 | Экстренный: скрининг, приоритет, 2 мин → все, 5 мин → 150/103/112 + callback | CLIENT, SYSTEM | UF-04 | CL-09 | `POST /requests {isEmergency}` | `request.updated` | Request.broadcastAt, CALLBACK_REQUESTED | `request-emergency` | E21-7 (очередь callback), Q-16 | I&T (callback PART) |
| REQ-5.5-01 | Чат/аудио/видео, реконнект, no-show 3 мин, эскалация | оба | UF-08…12 | CL-14…16, EX-10, EW-04 | `media-token`, `messages`, WS | `chat.*`, `consultation.updated` | Consultation, ChatMessage | `chat`, `media`, `consultation-lifecycle` | E28 (ресинк) | I&T |
| REQ-5.5-02 | 50 мин, напоминание 15 мин | SYSTEM | UF-21 | CL-27, EX-15 | — | `consultation.reminder` | Consultation.remindedAt | `scheduled-sweep` | Q-11 | I&T |
| REQ-5.5-03 | Исходы, приватные заметки | EXPERT | UF-14 | EX-11, EX-12 | `complete`, `note` | — | Consultation.outcome, ExpertNote | `consultations-complete`, `expert-notes` | — | I&T |
| REQ-5.5-04 | Перенос/отмена, поздние отмены в скор | CLIENT, EXPERT | UF-21 | CL-18, EX-09 | `reschedule`, `cancel`, `cancel-by-expert` | `consultation.rescheduled/cancelled` | Consultation | `booking-*` | Q-03 → E22 | I&T (v1 правила) |
| REQ-5.5-05 | TLS, DTLS-SRTP, без записи, шифрованная история | SYSTEM | — | — | — | — | ciphertext | `message-cipher.spec` | E29 (keyVersion), E30 (TLS) | I&T (серверное шифрование) |
| REQ-5.6-01 | Карты (токенизация), несколько карт | CLIENT | UF-08 | CL-25 | `payment-methods` | — | PaymentMethod | `payment-methods` | — ; Q-12 → E25 | I&T |
| REQ-5.6-02 | Эскроу: hold → capture/void, перехолд >5 дн | SYSTEM | UF-14 | — | `pay`, вебхуки | `payment.*` | Payment | `payments-hold`, `payments-settle`, `payments-sweep`, `money-lifecycle` | E0 (боевой эквайер) | I&T (mock) |
| REQ-5.6-03 | Начисление 85 %, ledger двойной записи | SYSTEM | UF-14 | EX-13, EW-07 | `earnings` | `earning.credited` | LedgerTransaction/Entry | `ledger` | — | I&T |
| REQ-5.6-04 | Выводы ≥10 000, автоодобрение ≤300 000/мес, финконтроль | EXPERT, ADM-FINANCE | — | EX-13, AD-06 | `payouts`, `admin/payouts/*` | `payout.*` | Payout | `payouts`, `payouts-admin` | — | I&T |
| REQ-5.6-05 | Abuse-счётчик, автоотключение автоподбора | SYSTEM | UF-12 | CL-08 (forbidden) | — | `request.auto_match_blocked` | Redis `abuse:*` | `abuse-gate` | E21-3 (блокировка клиента) | I&T |
| REQ-5.6-06 | Premium-биллинг, скидка 10 %, автопродление | CLIENT | UF-22 | CL-24, WB-06 | `premium/*` | `premium.*` | Subscription | `premium-*` | Q-01 | I&T |
| REQ-5.7-01 | Оценка + теги + публичный/приватный отзыв, удаление | CLIENT | UF-15 | CL-17 | `review`, `DELETE /reviews/{id}` | — | Review | `reviews`, `review-tags` | — | I&T |
| REQ-5.7-02 | Рейтинг, порог <4.0 при ≥20 | SYSTEM, ADM-QUALITY | — | AD-11 (flagged) | `admin/experts/flagged` | — | Expert.ratingAvg/Count | `admin-experts-flagged` | — | I&T |
| REQ-5.7-03 | Ответ эксперта, жалоба на отзыв, модерация 3 дня | EXPERT, ADM-QUALITY | — | EX-14, AD-11 | `reply`, `complaint`, `admin/reviews/*` | — | Review.status | `reviews-moderation` | — | I&T |
| REQ-5.7-04 | Жалобы из сессии → тикеты / (v2) сущность жалоб | CLIENT, EXPERT, ADM-QUALITY | — | CL-29/30, EX-22/23, AD-05 | `tickets` (сейчас) | — | Ticket / Complaint | `tickets-create` | E20 (Q-05) | PART |
| REQ-5.8-01 | Пуш: заявка (критичный, DND), напоминание, деньги, чат | все | UF-06 | EX-07 | `devices`, `notifications` | `offer.incoming` … | Notification, Outbox | `notifications-*`, `offer-push-fallback` | E27 (FCM/APNs, VoIP) | PART (mock) |
| REQ-5.8-02 | SMS-fallback 10 с | SYSTEM | UF-06 | — | — | — | Notification.smsFallbackAt | `offer-push-fallback`, `sms-fallback-budget` | — | I&T |
| REQ-5.8-03 | Центр уведомлений в обоих приложениях | все | — | CL-27, EX-15 | `notifications` | `notification.new` | Notification | `notifications-center` | — | I&T |
| REQ-5.9-01 | Админка: верификация | ADM-VERIF | UF-17 | AD-02 | — | — | — | admin `VerificationQueuePage.test` | — | I&T |
| REQ-5.9-02 | Эксперты/клиенты: поиск, карточки, блокировки, abuse | ADM | — | AD-03, AD-04 | ✗ | — | User.isBlocked ✗ | — | E21-3/4 | MISSING |
| REQ-5.9-03 | Финансы: транзакции, ledger, выводы, корректировки | ADM-FINANCE | — | AD-06 | `admin/payouts` (часть) | — | Ledger | `payouts-admin` | E21-5 | PART |
| REQ-5.9-04 | Модерация: жалобы, приватные отзывы, флаги | ADM-QUALITY | — | AD-05, AD-11 | `admin/reviews/*` | — | Review | `reviews-moderation` | E20 | PART |
| REQ-5.9-05 | Тикеты Новый→В работе→Решён, маршрутизация Р-23 | ADM-* | — | AD-16 | `admin/tickets/*` | `ticket.replied` | Ticket | `tickets-admin` | — | I&T |
| REQ-5.9-06 | Справочники: темы, дисклеймеры, юрдокументы | ADM-SUPER | — | AD-10 | ✗ | — | Topic | — | E21-8 | MISSING |
| REQ-5.9-07 | Дашборд метрик §11, RBAC | ADM | — | AD-01 | ✗ | — | — | — | E21-1/2 | MISSING |
| REQ-5.10-01 | CMS контента, пейволл, стрики | ADM-CONTENT, CLIENT | — | CL-19, WB-05, AD-10 | `content/*`, `admin/content/*` | — | ContentItem | `content-*` | E18-3 (тесты) | I&T |
| REQ-6-01 | p95 подбора ≤ 5 с, оффер ≤ 3 с, медиа ≤ 5 с | SYSTEM | — | — | — | — | — | loadtest 2026-08-26 (p50 заявка→матч 3,6 с) | E27 (замер пуша) | PART |
| REQ-6-02 | 99.5 %, деградация видео → аудио/чат, реконнект ≤ 30 с | клиенты | UF-11 | CL-15/16 | — | — | — | — | E28, E30 | PART |
| REQ-6-03 | ASVS L2, шифрование, доступ сотрудников закрыт | SYSTEM | — | — | — | — | — | ASVS-чеклист 2026-08-26 | E29 | PART |
| REQ-6-04 | ПД в РК, оферта, условия для специалистов | владелец | — | WB-10 | — | — | — | — | E0, E17-8 | OPEN |
| REQ-6-05 | Наблюдаемость: логи, трейсинг, алерты | INFRA | — | — | `/health` | — | — | — | E30 | MISSING |
| REQ-9-01 | Платёжный провайдер с hold/capture/void, вебхуки | SYSTEM | — | — | `webhooks/payments|payouts` | — | ProviderEvent | `payments-sweep` | E0 | MOCKED |
| REQ-9-02 | LiveKit токены и вебхуки | SYSTEM | UF-10 | — | `webhooks/livekit` | — | Consultation.*JoinedAt | `media` | E28 (дедуп) | I&T |
| REQ-9-03 | REST + WS, /v1, единый формат ошибок, OpenAPI в репо | API | — | — | все | все | — | `openapi`, `errors` | E28 (contracts/) | I&T |
| REQ-10-01 | Аналитика воронки (PostHog) | продукт | — | — | — | — | — | `funnel_analytics_test` (app_client) | — (веб ✗) | PART |
| REQ-11-01…08 | Критерии приёмки R1 | все | — | — | — | — | — | см. [[Готовность к пилоту и публикации (E11)]] | E11, E27, E0 | 5 подтверждены кодом, 3 требуют прод/устройств |
| REQ-V2-01 | Жалобы и споры | CLIENT/EXPERT/ADM | — | CL-29/30, EX-22/23, AD-05 | — | — | Complaint ✗ | — | E20 (Q-05) | MISSING |
| REQ-V2-02 | Политика отмен 50 %/компенсации | — | — | CL-18, EX-09 | — | — | — | — | E22 (Q-03) | MISSING |
| REQ-V2-03 | Тарифы специалистов | EXPERT/ADM | — | EX-21, WB-07, AD-10 | — | — | Tariff ✗ | — | E23 (Q-02) | MISSING |
| REQ-V2-04 | B2B/B2G, практиканты | все | — | CL-04, WB-11/12, AD-08/09, AD-02 | — | — | Contract ✗ | — | E24 (Q-06/07) | MISSING |
| REQ-V2-05 | Kaspi/Apple/Google Pay | CLIENT | — | CL-10, CL-25 | — | — | — | — | E25 (Q-12) | MISSING |
| REQ-V2-06 | Рассылки | ADM-SUPER | — | AD-07 | — | — | Mailing ✗ | — | E26 (Q-13) | MISSING |
| REQ-V2-07 | Дашборд/специалисты/клиенты/настройки админки | ADM | — | AD-01/03/04/10 | — | — | — | — | E21 | MISSING |
| REQ-V2-08 | Cookie-баннер, LangSwitch | аноним | — | WB-13/14 | — | — | — | — | E19 (Q-10) | MISSING/◐ |

Правило поддержки: каждая история PR обновляет свои строки; новые REQ добавляются только из ТЗ v1.1 или Р-решений.
