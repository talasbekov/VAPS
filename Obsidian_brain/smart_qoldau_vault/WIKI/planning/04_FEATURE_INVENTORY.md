# 04 — Инвентаризация функций

Статус: готов · Дата: 2026-09-13 · Статусы по коду `main` @ `310dde3`.
Легенда статусов: `IMPLEMENTED_AND_TESTED` (I&T), `IMPLEMENTED_PARTIALLY` (PART), `BACKEND_ONLY`, `UI_ONLY`, `DOCUMENTED_ONLY`, `MOCKED`, `BROKEN`, `MISSING`, `UNKNOWN`.
Колонки UI: Моб = Flutter-приложение, Веб = `web/`, Адм = `admin/`. Пути API без префикса `/v1`. Тесты — имена e2e-наборов `backend/test/*.e2e-spec.ts` и тестов клиентов.
Связано: [[05_PRODUCT_DEFINITION]], [[10_DOMAIN_API_AND_EVENTS]], [[17_TRACEABILITY_MATRIX]].

## 1. Клиент

| ID | Функция | Бизнес-цель | Backend | API / события | Модели | Тесты | Моб | Веб | Адм | Док | Статус |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F-CL-01 | Гостевой вход по устройству | обратиться без имени | `auth` | `POST /auth/guest` | User (частичный индекс guest) | `auth-guest` | ✓ | ✗ (веб только SMS) | — | ТЗ §5.1, Р-22 | I&T (моб.); веб — MISSING по дизайну E16 |
| F-CL-02 | Вход по телефону + SMS-код | аккаунт | `auth` | `POST /auth/request-code`, `verify-code` | SmsCode | `auth-request-code`, `auth-verify`, `throttling`; web `LoginForm`, `login.spec` | ✓ | ✓ (BFF, httpOnly) | — | §5.1 | I&T |
| F-CL-03 | Refresh-токен, ротация | сессия | `auth` | `POST /auth/refresh` | RefreshToken | `auth-verify` | ✓ | ✓ (сервер Next) | — | §5.1 | I&T |
| F-CL-04 | Конверсия гостя в аккаунт | сохранить консультацию/карту | `auth` | `POST /auth/guest/convert` | User | `auth-guest` | ✓ (`/profile/convert`) | — | — | Р-22 | I&T |
| F-CL-05 | Список тематик ru/kz | выбор темы | `topics` | `GET /topics` | Topic (12, seed) | `topics` | ✓ | ✓ | ✗ (нет CRUD) | Р-14 | I&T |
| F-CL-06 | Выбор «психологическая / юридическая помощь» | — | — | — | — | — | ✗ | ✗ | — | только корневой README | **CONTRADICTED**: продукт — только психология (темы, ТЗ); README упоминает юридическую → OUTDATED |
| F-CL-07 | Выбор формата чат/аудио/видео | — | `requests` | `format` в `POST /requests` | Request | `requests-flow` | ✓ | ✓ | — | §5.3 | I&T |
| F-CL-08 | Обычная заявка, автоподбор, ротация 45 с | помощь ≤ 2 мин | `requests`, `matching` | `POST /requests`; WS `request.updated` | Request, RequestCandidate | `requests-flow`, `request-timers`, `matching-*` | ✓ (`/search/:id`) | ✓ (`/requests/new`, `/requests/[id]`) | — | §5.3, Р-10, Р-12 | I&T |
| F-CL-09 | Экстренная заявка: скрининг, 20 с, broadcast 2 мин, hotlines/callback 5 мин | кризис | `requests/escalation` | `isEmergency`; `CALLBACK_REQUESTED` | Request | `request-emergency` | ✓ (`/emergency*`, 150/103/112) | ✓ (E16-15) | — | §5.4, Р-16 | I&T |
| F-CL-10 | Направленная заявка конкретному эксперту | «продолжить с тем же» | `requests` | `directedExpertId` | Request | `requests-flow` | ✓ | ✓ | — | БП-01 | I&T |
| F-CL-11 | Экран ожидания, счётчик «сейчас онлайн» | прозрачность | `matching` | `GET /matching/online-count`; WS | — | `matching-online-count(-perf)` | ✓ | ✓ | — | §5.3 | I&T |
| F-CL-12 | Отмена заявки | — | `requests` | `POST /requests/{id}/cancel` | Request | `requests-flow` | ✓ | ✓ | — | БП-01 | I&T |
| F-CL-13 | Обратный звонок первым освободившимся | тупик экстренной | `requests` | статус `CALLBACK_REQUESTED` + hotlines | Request | `request-emergency` | ✓ (экран hotlines) | ✓ | ✗ | Р-16 | **PART**: заявка фиксируется, но очереди callback у экспертов/админки и самого «перезвона» нет → BACKEND_ONLY-остаток |
| F-CL-14 | Просмотр эксперта (публичный профиль, отзывы) | ручной выбор | `experts`, `reviews` | `GET /experts`, `/experts/{id}`, `/experts/{id}/reviews` | Expert, Review | `experts-public`, `expert-public-contract`, `experts-pagination`; web `catalog.spec`, `expert.spec` | ✓ | ✓ (SSR, JSON-LD, sitemap) | — | §5.3 | I&T |
| F-CL-15 | Избранное | повтор | `favorites` | `GET/PUT/DELETE /favorites` | Favorite | `favorites` | ✓ | ✓ | — | §5.3 | I&T |
| F-CL-16 | Чат в сессии (индикатор набора, история) | формат | `chat`, `ws` | WS `chat.send/message/typing`; `GET /consultations/{id}/messages` | ChatMessage | `chat`, `notifications-chat`; web `Chat.test`, `cabinet.spec` | ✓ | ✓ | — | §5.5 | I&T |
| F-CL-17 | Аудио | формат | `media` | `POST /consultations/{id}/media-token` | Consultation | `media`; web `call.test` | ✓ (LiveKit SDK) | ✓ (livekit-client) | — | §5.5 | I&T (на реальных iOS-устройствах не проверено — UNKNOWN) |
| F-CL-18 | Видео + эскалация формата | формат | `media` | тот же | — | `media` | ✓ | ✓ | — | §5.5 | I&T (то же) |
| F-CL-19 | Реконнект после потери сети | надёжность | клиенты | socket.io reconnect; LiveKit reconnect | — | `socket.test` (web), `sq_socket` (shared) | ✓ | ✓ | — | §6 | PART: переподключение есть, восстановления пропущенных событий нет (ресинк REST) |
| F-CL-20 | Завершение/исход (фиксирует эксперт), отмена клиентом | деньги | `consultations` | `POST /consultations/{id}/cancel` | Consultation | `consultations-complete` | ✓ | ✓ | — | §5.5 | I&T |
| F-CL-21 | Отзыв: звёзды, теги, публичный/приватный текст, удаление | качество | `reviews` | `POST /consultations/{id}/review`, `DELETE /reviews/{id}` | Review | `reviews`, `review-tags` | ✓ (`/review/:id`) | ✓ | — | §5.7 | I&T |
| F-CL-22 | История консультаций | — | `consultations` | `GET /consultations` | — | `consultations-*` | ✓ | ✓ | — | — | I&T |
| F-CL-23 | Плановая запись на слот, перенос, отмена | планирующий клиент | `booking` | `GET /experts/{id}/slots`, `POST /bookings`, `reschedule`, `cancel` | Consultation SCHEDULED, Payment | `booking-*`, `slots` | ✓ | ✗ (в вебе только мгновенный подбор) | — | БП-03, Р-17 | I&T (моб.); веб — MISSING |
| F-CL-24 | Оплата холдом, карты (токенизация), статус платежа | эскроу | `payments` | `POST /payment-methods`, `POST /consultations/{id}/pay`, `GET …/payment` | PaymentMethod, Payment | `payments-hold`, `payment-methods`, `money-lifecycle` | ✓ (`/cards`) | ✓ | — | §5.6, Р-01 | **MOCKED** провайдер (логика I&T) |
| F-CL-25 | Premium: планы, подписка, отмена, скидка 10 %, приоритет | R2 | `premium` | `GET /premium/plans`, `GET/POST /premium*` | Subscription | `premium-*` | ✓ | ✓ | — | Р-03, Р-08, Р-09 | I&T (цены 4 990/39 900 из API) |
| F-CL-26 | Материалы самопомощи, пейволл, прогресс, стрик | R2 | `content` | `GET /content*` | ContentItem, Progress, Vote | `content-*` | ✓ (`/materials`) | ✓ (`/materials`) | ✓ CMS | БП-11 | I&T |
| F-CL-27 | Уведомления: центр, пуш, ack | — | `notifications`, `devices` | `GET /notifications`, `read`, `ack`; `POST /devices` | Notification, Device | `notifications-*`, `devices` | ✓ | ✓ (центр) | — | §5.8 | PART: **push-провайдер mock** (нет FCM/APNs) |
| F-CL-28 | Управление аккаунтом: имя, локаль, согласие Р-27, удаление | — | `account`, `devices` | `GET /me`, `POST /me/expert-visibility`, `PATCH /me/locale`, `DELETE /me` | User | `account-delete`, `expert-visibility-consent` | ✓ (`/profile`, consent) | ✓ | — | §5.1, Р-27 | I&T |
| F-CL-29 | Согласия и политика конфиденциальности | право | — | страницы `/terms`, `/privacy`; экран «Разрешения» | — | web `privacy/terms page.test` | ✓ | ✓ | — | §11.8 | PART: тексты не вычитаны юристом после Р-27 (E17-8) |
| F-CL-30 | Поддержка (тикеты, переписка) | — | `tickets` | `GET/POST /tickets*` | Ticket | `tickets-create`, `tickets-reply-author` | ✓ (`/support*`) | ✓ (`/support` форма) | — | Р-23 | I&T |
| F-CL-31 | Deep links `/e /t /sos /c` | вход из пуша/сайта | — | `docs/deeplinks.md`; `app_client/lib/core/deep_links.dart` | — | тесты deep_links | ✓ | ✗ `.well-known` | — | E6-23 | PART (веб не отдаёт assetlinks/AASA) |
| F-CL-32 | Жалоба на консультацию/специалиста, «Мои жалобы» | v2 прототип | — | нет (частично через тикет `CONSULTATIONS`) | нет Complaint | — | ✗ | ✗ | ✗ | v2: 48 ч, статусы, решения | **MISSING** (Q-05) |
| F-CL-33 | Корпоративный доступ B2B: код `SQ-XXXX-YYYY`, «оплачено компанией» | v2 | — | нет | нет | — | ✗ | ✗ | ✗ | v2 ER §6 | MISSING (Q-06) |
| F-CL-34 | Kaspi Pay / Apple Pay / Google Pay | v2 | — | нет | — | — | ✗ | ✗ | — | v2 | MISSING (Q-12; зависит от эквайера) |
| F-CL-35 | «Новые специалисты −15 %» / практиканты бесплатно | v2 | — | нет | — | — | ✗ | ✗ | — | v2 | MISSING (Q-02/Q-07) |
| F-CL-36 | Веб-кабинет клиента (заявка, ожидание, консультации, чат, звонок, профиль, избранное, уведомления, Premium) | E16-B | — | через BFF (белый список 10 префиксов) | — | web Jest/Playwright | — | ✓ | — | Р-26 (расширено E16) | I&T; **CONTRADICTED прототипом v2** (профиль → «установите приложение», Q-08) |

## 2. Эксперт

| ID | Функция | Backend | API / события | Модели | Тесты | Моб | Веб | Адм | Док | Статус |
|---|---|---|---|---|---|---|---|---|---|---|
| F-EX-01 | Регистрация (тот же телефон+SMS) и анкета | `auth`, `experts` | `POST /experts` | Expert | `experts-profile`, `expert-profile-schema` | ✓ (`/onboarding/*`) | ✓ (`/become-expert` → вход) | — | §5.1 | I&T |
| F-EX-02 | Специализации, языки, форматы, цена 2 000–15 000 ₸, город, опыт, образование | `experts` | `PATCH /experts/me` | ExpertTopic | `experts-profile` | ✓ | ✓ (профиль кабинета) | — | Р-04, Р-18 | I&T (**v2: коридор 15–35 тыс., Q-04**) |
| F-EX-03 | Фото и «о себе» с модерацией | `experts`, `verification` | `POST/DELETE /experts/me/photo`; admin `profile-moderation` | Expert.photo*/about* | `expert-photo`, `expert-about`, `profile-moderation` | ✓ | ✓ | ✓ | E2a | I&T |
| F-EX-04 | Загрузка 4 документов, отправка на проверку | `experts` | `POST /experts/me/documents/{type}`, `submit` | ExpertDocument | `experts-documents`, `expert-lifecycle` | ✓ | ✗ (только приложение) | — | БП-04 | I&T |
| F-EX-05 | Статус верификации, повторная загрузка одного документа | `verification` | `GET /experts/me` (статусы) | — | `admin-verification` | ✓ (`/verification/status`) | ✓ (статус) | — | Р-18 | I&T |
| F-EX-06 | Рабочий статус (4), тумблер срочных | `experts`, `presence` | `PATCH /experts/me/work-status`, `availability` | Expert, Redis | `experts-status` | ✓ | ✓ («честный онлайн») | — | БП-05, Р-13 | I&T |
| F-EX-07 | Presence/heartbeat | `presence` | `POST /experts/me/heartbeat` | Redis | `experts-heartbeat` | ✓ (фоновая служба) | ✓ (пока вкладка видима) | — | — | I&T |
| F-EX-08 | Расписание и исключения | `schedule` | `GET/PUT /experts/me/schedule`, `exceptions/{date}` | ExpertScheduleDay, ScheduleException | `experts-schedule`, `schedule-exceptions` | ✓ | ✓ (неделя) | — | БП-05 | I&T |
| F-EX-09 | Получение оффера: полноэкранный алерт, таймер 45/20 с, звук | `requests`, `notifications` | WS `offer.new/revoked`; push `offer.incoming` + SMS-fallback | RequestCandidate | `offer-push-fallback`, `sms-fallback-budget` | ✓ | ✓ (колонка офферов) | — | §5.3, §5.8 | PART: **из убитого приложения не доставляется** (нет VoIP/CallKit, push mock) — долг E7 |
| F-EX-10 | Accept / Decline | `requests` | `POST /offers/{id}/accept|decline` | — | `matching-accept-race` | ✓ | ✓ | — | БП-01 | I&T |
| F-EX-11 | Автоприём заявок (Р-11) | — | нет | — | — | ✗ | ✗ | — | ТЗ «R2», Р-11 | DOCUMENTED_ONLY |
| F-EX-12 | Консультация: чат/аудио/видео, эскалация формата, автостатус BUSY | `consultations`, `media` | см. F-CL-16…18 | — | `consultation-lifecycle` | ✓ | ✓ (видео+чат рядом, выбор камеры/микрофона) | — | §5.5 | I&T |
| F-EX-13 | Завершение с исходом (4 исхода + EXPERT_CANCELLED для плановых) | `consultations` | `POST /consultations/{id}/complete`, `cancel-by-expert` | Consultation | `consultations-complete`, `booking-cancel` | ✓ | ✓ | — | §5.5 | I&T |
| F-EX-14 | Приватная заметка (шифрованная) | `consultations` | `GET/PUT /consultations/{id}/note` | ExpertNote | `expert-notes` | ✓ | ✓ | — | §5.5 | I&T |
| F-EX-15 | История консультаций | `consultations` | `GET /consultations?as=expert` | — | — | ✓ | ✓ | — | — | I&T |
| F-EX-16 | Доход (цена − 15 % = итого), по дням, баланс, выплаты, история | `payments`, `payouts` | `GET /experts/me/earnings(/daily)`, `balance`, `GET/POST /payouts` | Payment, Payout, Ledger | `payouts`, `ledger`, `money-lifecycle` | ✓ (`/earnings`, `/earnings/payout`) | ✓ (график) | ✓ финконтроль | Р-02, Р-06 | I&T (провайдер выплат mock) |
| F-EX-17 | Отзывы о себе, ответ, жалоба на отзыв | `reviews` | `GET /experts/me/reviews`, `POST /reviews/{id}/reply|complaint` | Review | `expert-reviews-me`, `reviews-moderation` | ✓ | ✓ | ✓ | §5.7, Р-21 | I&T |
| F-EX-18 | Блокировка: исключение из каталога/матчинга/записи, экран «профиль заблокирован» | `verification` | `POST /admin/experts/{id}/block` | Expert.isBlocked | `admin-lifecycle` | ✓ (экран) | ✓ | ✓ | Р-19 | I&T (сессия эксперта не отзывается — [[12_SECURITY_AND_PRIVACY]] T-06) |
| F-EX-19 | Уведомления (центр + пуш) | `notifications` | — | — | — | ✓ | ✓ | — | §5.8 | PART (push mock) |
| F-EX-20 | Поддержка эксперта (категории выплаты/верификация/вопрос о клиенте) | `tickets` | `POST /tickets` | Ticket | `tickets-create` | ✓ | ✗ (в веб-кабинете нет) | ✓ | расхождение №12 | PART (веб) |
| F-EX-21 | Клиенты: имя и история встреч по согласию, журнал доступа | `experts/clients` | `GET /experts/me/clients(/{id})` | User.displayName, expertVisibilityAcceptedAt, AuditLog | `expert-clients`, `expert-visibility-consent` | ✗ (моб. эксперта нет раздела) | ✓ | — | Р-27 | PART (моб.) |
| F-EX-22 | Тарифы Старт/Базовый/Про/Топ, пробный период | — | нет | нет | — | ✗ | ✗ | ✗ | v2 | MISSING (Q-02) |
| F-EX-23 | «Жалоба на вас», объяснение, споры по no-show | — | нет | нет | — | ✗ | ✗ | ✗ | v2 | MISSING (Q-05) |
| F-EX-24 | Веб-кабинет эксперта (дашборд, заявки, консультации, расписание, доход, рейтинг, клиенты, профиль) | — | BFF | — | web тесты `expert-cabinet/*`, `expert.spec` | — | ✓ (нет: чаты вне сессии, настройки, поддержка) | — | Р-26, E16-C | I&T |
| F-EX-25 | Работа из убитого приложения (VoIP-push/CallKit/ConnectionService) | — | нет | — | — | ✗ | — | — | ТЗ §5.8, §11.6 | **MISSING** — единственный критерий приёмки без реализации |

## 3. Администратор и команда

| ID | Функция | Backend | API | Роль | Тесты | Адм UI | Док | Статус |
|---|---|---|---|---|---|---|---|---|
| F-AD-01 | Вход email+пароль, TOTP (обязателен в prod), lockout, refresh, recovery-коды | `admin` | `/admin/auth/*` | все | `admin-auth`, `admin-2fa`, `admin-lockout`, `admin-session` | ✓ `/login`, `/login/totp`, `/settings` (привязка) | E8a, E11a | I&T |
| F-AD-02 | Роли: 6 (`VERIFICATION_OPERATOR, SUPPORT_OPERATOR, QUALITY_TEAM, FINANCE_CONTROL, CONTENT_EDITOR, SUPERADMIN`), несколько на сотрудника | `admin` | `RolesGuard` | — | `roles.guard.spec`, `admin-staff` | ✓ `RoleGate` | ТЗ §3 | I&T (**v2: 2 роли «супер-админ/модератор», Q-09**) |
| F-AD-03 | Очередь верификации с SLA 24 ч | `verification` | `GET /admin/verification/queue` | VERIFICATION_OPERATOR | `admin-verification` | ✓ `/verification` (индикатор просрочки) | §5.2 | I&T |
| F-AD-04 | Просмотр документов (presigned 300 с) | `verification`, `storage` | в очереди `downloadUrl` | VERIFICATION_OPERATOR | `experts-documents` | ✓ | §5.2 | I&T (доступ админа к документу **не журналируется** — T-09) |
| F-AD-05 | Approve анкеты / документа | `verification` | `POST /admin/verification/{expertId}/decision`, `documents/{id}/decision` | VERIFICATION_OPERATOR | `admin-verification` | ✓ | Р-18 | I&T |
| F-AD-06 | Reupload request (reject документа с комментарием) | `verification` | тот же | — | — | ✓ | Р-18 | I&T |
| F-AD-07 | Блокировка / разблокировка эксперта с причиной | `verification` | `POST /admin/experts/{id}/block|unblock` | VERIFICATION_OPERATOR (block), — | `admin-lifecycle` | ✓ (в очереди/флагах) | Р-19 | I&T (разблокировка «через тикет» — процесс) |
| F-AD-08 | Управление тематиками (CRUD, ru/kz) | — | нет (seed) | — | — | ✗ | §5.9 | MISSING |
| F-AD-09 | Модерация отзывов (FLAGGED → hide/restore) | `reviews` | `GET /admin/reviews/flagged`, `POST …/resolve` | QUALITY_TEAM | `reviews-moderation` | ✓ `/reviews` | Р-21 | I&T |
| F-AD-10 | Флаг качества <4.0 при ≥20 | `verification` | `GET /admin/experts/flagged` | QUALITY_TEAM | `admin-experts-flagged` | ✓ `/flagged-experts` | Р-20 | I&T |
| F-AD-11 | Жалобы и споры (сущность, решения: возврат/частичный/отказ/страйк) | — | нет | — | — | ✗ | ТЗ: «жалобы из сессии → тикеты»; v2 — отдельный раздел | MISSING (Q-05); сейчас только тикеты категории `CONSULTATIONS` |
| F-AD-12 | Очередь callback (экстренные без ответа) | — | нет (статус есть) | — | — | ✗ | Р-16 | MISSING |
| F-AD-13 | Мониторинг экстренных заявок в реальном времени | — | нет | — | — | ✗ | БП-02 | MISSING |
| F-AD-14 | Просмотр audit_log | `audit` | нет эндпоинта | — | — | ✗ | §4.5, v2 «журнал действий» | BACKEND_ONLY |
| F-AD-15 | Тикеты: очередь по командам, назначение, ответ, решение | `tickets` | `/admin/tickets*` | SUPPORT/VERIFICATION/FINANCE/QUALITY | `tickets-admin`, `tickets-assignment` | ✓ `/tickets`, `/tickets/:id` | Р-23 | I&T |
| F-AD-16 | Просмотр технических проблем (исходы TECH_ISSUE, ошибки медиа) | — | нет | — | — | ✗ | §6 наблюдаемость | MISSING |
| F-AD-17 | Управление клиентами: поиск по коду, карточка, блокировка, счётчики злоупотреблений | — | нет (`User` без `isBlocked`; abuse-счётчик в Redis) | — | — | ✗ | §5.9, v2 «Клиенты» | MISSING |
| F-AD-18 | Управление специалистами: таблица, карточка, финистория | частично (`verification` очередь/флаг) | нет списка всех экспертов для админа | — | — | ✗ | §5.9, v2 «Специалисты» | PART/MISSING |
| F-AD-19 | Финансы: очередь выводов, approve/reject | `payouts` | `/admin/payouts*` | FINANCE_CONTROL | `payouts-admin` | ✓ `/payouts` | Р-06 | I&T |
| F-AD-20 | Финансы: ledger/транзакции, ручные корректировки с двойным подтверждением, экспорт CSV, доход платформы | `ledger` (данные есть) | нет | — | — | ✗ | §5.9, v2 «Финансы» | BACKEND_ONLY / MISSING |
| F-AD-21 | Контент CMS | `content` | `/admin/content*` | CONTENT_EDITOR, SUPERADMIN | `content-admin` | ✓ `/content` | E13 | I&T |
| F-AD-22 | Дашборд метрик (§5.9, [[Дашборд метрик админки]]) | — | нет | — | — | ✗ (корень → `/verification`) | §5.9, v2 «Дашборд» | MISSING (спецификация метрик готова в WIKI) |
| F-AD-23 | Сотрудники: список, создание, роли, деактивация | `admin` | `/admin/staff*` | SUPERADMIN | `admin-staff` | ✓ `/staff` | §3 | I&T |
| F-AD-24 | Модерация фото/«о себе» | `verification` | `/admin/profile-moderation*` | VERIFICATION_OPERATOR | `profile-moderation` | ✓ | E2a | I&T |
| F-AD-25 | Рассылки (push/email по сегментам, инцидент-алерты) | — | нет | — | — | ✗ | v2 | MISSING (Q-13) |
| F-AD-26 | B2B/B2G-контракты | — | нет | — | — | ✗ | v2 | MISSING (Q-06) |
| F-AD-27 | Настройки платформы: пакеты (цена/комиссия), темы, контент, журнал | — | нет | — | — | ✗ (`/settings` = только TOTP) | v2 | MISSING (Q-02/Q-09) |
| F-AD-28 | Верификация практикантов (второй поток, супервизор, код B2G, дубликат ИИН) | — | нет (ИИН не собирается) | — | — | ✗ | v2 | MISSING (Q-07) |

## 4. Сквозные

| ID | Функция | Реализация | Статус |
|---|---|---|---|
| F-XS-01 | Анонимность/PII-инвариант: эксперт видит `clientCode`; имя — только по согласию; телефон никогда | DTO `ConsultationExpertDto`, `OfferDto`, `ClientDetailDto`; e2e `expert-visibility-consent`, `expert-public-contract` | I&T |
| F-XS-02 | Локализация ru/kz | next-intl, ARB, шаблоны уведомлений, `PATCH /me/locale` | I&T |
| F-XS-03 | Audit log всех переходов | `AuditService`, ~60 transition-кодов | I&T (UI просмотра нет) |
| F-XS-04 | Дисклеймеры 102/103/150/112 | экраны экстренного, поддержки, `EmergencyBar` на всех страницах веба | I&T |
| F-XS-05 | Троттлинг и helmet | `common/throttle` (Redis), `helmet` без CSP | I&T (CSP выключен — T-13) |
| F-XS-06 | OpenAPI как контракт | `docs/openapi.json` → `web/lib/api/generated.ts` (openapi-typescript); Dart `SqApi` — вручную + контрактный тест | PART (Dart-клиент не генерируется) |
| F-XS-07 | Ретенция | `maintenance` (события 30 дн, уведомления 90 дн) | I&T; переписка/документы — без срока |
| F-XS-08 | Наблюдаемость (логи, трейсинг, алерты §6) | `Logger` Nest, `/v1/health` | MISSING (централизованных логов/алертов нет) |
| F-XS-09 | Резервное копирование/восстановление | вне репозитория (README infra) | MISSING |
| F-XS-10 | Аналитика PostHog | `packages/shared/lib/analytics` (мобильные); веб — нет | PART |

## 5. Сводка пробелов, требующих продуктового решения

1. **Прототип v2 против ТЗ/кода:** жалобы, тарифы специалистов, отмены 50 %, B2B/B2G, практиканты, коридор цен, Premium без скидки, «KZ скоро», витрина веба без записи, 2 роли админки, напоминание за час, Kaspi/Apple/Google Pay, рассылки — Q-01…Q-14 в [[16_RISKS_QUESTIONS_AND_ADRS]].
2. **ТЗ §5.9 без реализации:** дашборд, клиенты, тематики, ledger-просмотр и корректировки, audit-просмотр, callback-очередь.
3. **Критерий приёмки §11.6 (пуш ≤ 3 с, включая убитое приложение):** нет боевого push-адаптера и VoIP-канала.
4. **Провайдеры:** эквайер, выплаты, push — mock.
5. **Веб:** нет гостя, плановой записи, поддержки эксперта, `.well-known`.
