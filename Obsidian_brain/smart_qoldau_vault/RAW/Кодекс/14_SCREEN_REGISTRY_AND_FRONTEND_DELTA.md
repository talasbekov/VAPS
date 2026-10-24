# 14. Screen registry и frontend delta

## 1. Покрытие прототипа

- всего HTML-экранов: **106**;
- внутренних отсутствующих targets по static analysis: **0**;
- визуальный runtime render в текущем окружении не выполнен: браузер блокировал локальные HTML (`ERR_BLOCKED_BY_ADMINISTRATOR`), поэтому layout анализировался по HTML/CSS и переданным image sheets;
- текущий код также не запускался локально из-за отсутствия сетевого доступа к clone/dependencies; статус взят из актуальных README, CLAUDE.md и просмотренного GitHub snapshot.

### По поверхностям

| Surface | Screens |
| --- | --- |
| Admin Web | 10 |
| Client Mobile | 32 |
| Deck/Overview | 2 |
| Expert Mobile | 33 |
| Expert Web | 12 |
| Prototype Overview | 1 |
| Public Web | 16 |

### По текущему статусу

| Status | Screens |
| --- | --- |
| IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | 81 |
| PROTOTYPE_OR_BACKEND_GAP | 5 |
| IMPLEMENTED_OR_PARTIAL | 5 |
| REFERENCE_ONLY | 4 |
| IMPLEMENTED_HEADLESS_DEVICE_NOT_VERIFIED | 4 |
| PARTIAL_OR_NEEDS_CONTRACT_CHECK | 4 |
| DEFERRED_RESEARCH | 1 |
| PARTIAL_BACKEND_GAPS | 1 |
| PARTIAL_PAYOUTS_ONLY | 1 |

## 2. Delta strategy

| Область | Решение | Что уже ценно | Следующее действие |
| --- | --- | --- | --- |
| Client Flutter routing/state | KEEP + ALIGN | Маршруты и feature-состав уже широкие | Сверить 32 client screens, copy, loading/error/offline и visual baselines |
| Expert Flutter app | KEEP + HARDEN | Онбординг, verification, offers, session, earnings, reviews реализованы | Device run, killed-state truth, Mobile/Web ownership |
| Shared Flutter package | KEEP BOUNDED | API/models/session primitives полезны | Не переносить platform UI и client-specific DTO в общий слой |
| Next.js public/client/expert | KEEP + CONVERGE | SSR, BFF/httpOnly, locale routes — сильная основа | Prototype v2 visual audit; один domain contract с Flutter |
| React admin | KEEP + EXTEND | RBAC и операционные очереди уже есть | Не имитировать dashboard/B2B/B2G/client block/ledger без backend |
| Backend/OpenAPI | KEEP + DOCUMENT | Большая часть core поддержана | Сделать generated contract source и gap ledger каноническими |
| Prototype v2 | KEEP AS VISUAL BASELINE | 106 экранов и единый тон | Убрать demo business truth; создать visual changelog |
| Old screenshots/Investor Deck | REFERENCE ONLY | Полезны для storytelling | Не использовать как acceptance без screen spec |

## 3. Реестр 106 экранов

| ID | Surface | Экран | Canonical route | Release | Current status | Action |
| --- | --- | --- | --- | --- | --- | --- |
| SCR-001 | Client Mobile | ER-схема | reference-only | REFERENCE | REFERENCE_ONLY | Не реализовывать как runtime-экран; использовать как evidence. |
| SCR-002 | Deck/Overview | Investor Deck | reference-only | REFERENCE | REFERENCE_ONLY | Не реализовывать как runtime-экран; использовать как evidence. |
| SCR-003 | Client Mobile | Premium | /premium | R3 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Не переписывать; провести visual/state audit по prototype v2. |
| SCR-004 | Client Mobile | Анализ | /analysis | R6 | DEFERRED_RESEARCH | Не переносить в релиз до privacy/clinical discovery. |
| SCR-005 | Client Mobile | Аудиозвонок | /call/:id?format=audio | R2 | IMPLEMENTED_HEADLESS_DEVICE_NOT_VERIFIED | Сохранить код; обязательна device acceptance. |
| SCR-006 | Client Mobile | Видеозвонок | /call/:id?format=video | R2 | IMPLEMENTED_HEADLESS_DEVICE_NOT_VERIFIED | Сохранить код; обязательна device acceptance. |
| SCR-007 | Client Mobile | Выбор темы | /topic | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Не переписывать; провести visual/state audit по prototype v2. |
| SCR-008 | Client Mobile | Главная | /home | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Не переписывать; провести visual/state audit по prototype v2. |
| SCR-009 | Client Mobile | Добавить карту | /cards/add | R2 | PARTIAL_OR_NEEDS_CONTRACT_CHECK | Сверить реальный API и довести states/visual parity. |
| SCR-010 | Client Mobile | Добро пожаловать | /welcome | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Не переписывать; провести visual/state audit по prototype v2. |
| SCR-011 | Client Mobile | Дыхательное упражнение | /materials/:id (kind=BREATHING) | R3 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Не переписывать; провести visual/state audit по prototype v2. |
| SCR-012 | Client Mobile | Избранное | /catalog/favorites | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Не переписывать; провести visual/state audit по prototype v2. |
| SCR-013 | Client Mobile | Каталог | /catalog | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Не переписывать; провести visual/state audit по prototype v2. |
| SCR-014 | Client Mobile | Консультации | /consultations | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Не переписывать; провести visual/state audit по prototype v2. |
| SCR-015 | Client Mobile | Материалы | /materials | R3 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Не переписывать; провести visual/state audit по prototype v2. |
| SCR-016 | Client Mobile | Медитации | /materials?kind=MEDITATION | R3 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Не переписывать; провести visual/state audit по prototype v2. |
| SCR-017 | Client Mobile | Мои жалобы | /complaints | R2 | PARTIAL_OR_NEEDS_CONTRACT_CHECK | Сверить реальный API и довести states/visual parity. |
| SCR-018 | Client Mobile | Онбординг | /onboarding | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Не переписывать; провести visual/state audit по prototype v2. |
| SCR-019 | Client Mobile | Оценка | /review/:consultationId | R2 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Не переписывать; провести visual/state audit по prototype v2. |
| SCR-020 | Client Mobile | Подать жалобу | /complaints/new?consultationId=:id | R2 | PARTIAL_OR_NEEDS_CONTRACT_CHECK | Сверить реальный API и довести states/visual parity. |
| SCR-021 | Client Mobile | Поиск специалиста | /search/:requestId | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Не переписывать; провести visual/state audit по prototype v2. |
| SCR-022 | Client Mobile | Полезные статьи | /materials?kind=ARTICLE | R3 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Не переписывать; провести visual/state audit по prototype v2. |
| SCR-023 | Deck/Overview | Презентация | reference-only | REFERENCE | REFERENCE_ONLY | Не реализовывать как runtime-экран; использовать как evidence. |
| SCR-024 | Prototype Overview | Прототип | reference-only | REFERENCE | REFERENCE_ONLY | Не реализовывать как runtime-экран; использовать как evidence. |
| SCR-025 | Client Mobile | Профиль психолога | /catalog/expert/:id | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Не переписывать; провести visual/state audit по prototype v2. |
| SCR-026 | Client Mobile | Профиль | /profile | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Не переписывать; провести visual/state audit по prototype v2. |
| SCR-027 | Client Mobile | Разрешения | /permissions | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Не переписывать; провести visual/state audit по prototype v2. |
| SCR-028 | Client Mobile | Расслабляющая музыка | /materials?kind=MUSIC | R3 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Не переписывать; провести visual/state audit по prototype v2. |
| SCR-029 | Client Mobile | Регистрация | /auth/phone | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Не переписывать; провести visual/state audit по prototype v2. |
| SCR-030 | Client Mobile | Специалист найден | /found/:requestId | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Не переписывать; провести visual/state audit по prototype v2. |
| SCR-031 | Client Mobile | Сплэш | /splash | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Не переписывать; провести visual/state audit по prototype v2. |
| SCR-032 | Client Mobile | Способы оплаты | /cards | R2 | PARTIAL_OR_NEEDS_CONTRACT_CHECK | Сверить реальный API и довести states/visual parity. |
| SCR-033 | Client Mobile | Уведомления | /notifications | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Не переписывать; провести visual/state audit по prototype v2. |
| SCR-034 | Client Mobile | Чат | /session/:consultationId | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Не переписывать; провести visual/state audit по prototype v2. |
| SCR-035 | Client Mobile | Экстренный поиск | /sos/search | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Не переписывать; провести visual/state audit по prototype v2. |
| SCR-036 | Admin Web | B2B | /b2b | R4 | PROTOTYPE_OR_BACKEND_GAP | Не рисовать fake data; реализовать после API/operating rules. |
| SCR-037 | Admin Web | B2G | /b2g | R5 | PROTOTYPE_OR_BACKEND_GAP | Не рисовать fake data; реализовать после API/operating rules. |
| SCR-038 | Admin Web | Верификация | /verification | R2 | IMPLEMENTED_OR_PARTIAL | Сверить route/role/evidence. |
| SCR-039 | Admin Web | Дашборд | /dashboard | R3 | PROTOTYPE_OR_BACKEND_GAP | Не рисовать fake data; реализовать после API/operating rules. |
| SCR-040 | Admin Web | Жалобы | /complaints | R2 | IMPLEMENTED_OR_PARTIAL | Сверить route/role/evidence. |
| SCR-041 | Admin Web | Клиенты | /clients | R3 | PROTOTYPE_OR_BACKEND_GAP | Не рисовать fake data; реализовать после API/operating rules. |
| SCR-042 | Admin Web | Настройки | /settings | R3 | PARTIAL_BACKEND_GAPS | Settings shell есть; dictionaries/versioning требуют API. |
| SCR-043 | Admin Web | Рассылки | /broadcasts | R3 | PROTOTYPE_OR_BACKEND_GAP | Не рисовать fake data; реализовать после API/operating rules. |
| SCR-044 | Admin Web | Специалисты | /experts | R2 | IMPLEMENTED_OR_PARTIAL | Сверить route/role/evidence. |
| SCR-045 | Admin Web | Финансы | /finance | R2 | PARTIAL_PAYOUTS_ONLY | Добавить ledger/refunds/adjustments только после контрактов. |
| SCR-046 | Expert Mobile | Аудиозвонок (эксперт) | /call/:id?format=audio | R2 | IMPLEMENTED_HEADLESS_DEVICE_NOT_VERIFIED | Провести реальные device tests. |
| SCR-047 | Expert Mobile | Верификация | /verification | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-048 | Expert Mobile | Видеозвонок (эксперт) | /call/:id?format=video | R2 | IMPLEMENTED_HEADLESS_DEVICE_NOT_VERIFIED | Провести реальные device tests. |
| SCR-049 | Expert Mobile | Входящий запрос | /offers/:id | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-050 | Expert Mobile | Выплаты | /payouts | R2 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-051 | Expert Mobile | Главная | /home | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-052 | Expert Mobile | Добро пожаловать | /welcome | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-053 | Expert Mobile | Документы | /verification/documents | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-054 | Expert Mobile | Доступность | /availability | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-055 | Expert Mobile | Доход | /earnings | R2 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-056 | Expert Mobile | Жалоба на вас | /complaints/:id | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-057 | Expert Mobile | Завершение | /consultations/:id/complete | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-058 | Expert Mobile | Заметки | /consultations/:id/note | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-059 | Expert Mobile | Заявка | /offers/:id/details | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-060 | Expert Mobile | Заявки | /offers | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-061 | Expert Mobile | Клиент | /clients/:id | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-062 | Expert Mobile | Консультации | /consultations | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-063 | Expert Mobile | Консультация | /consultations/:id | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-064 | Expert Mobile | Мои жалобы и споры | /complaints | R2 | IMPLEMENTED_OR_PARTIAL | Сверить backend contract и визуальную полноту. |
| SCR-065 | Expert Mobile | Настройки | /settings | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-066 | Expert Mobile | Онбординг | /onboarding | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-067 | Expert Mobile | Поддержка | /support | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-068 | Expert Mobile | Профессиональный профиль | /profile/professional | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-069 | Expert Mobile | Профиль | /profile | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-070 | Expert Mobile | Расписание | /schedule | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-071 | Expert Mobile | Регистрация | /auth/phone | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-072 | Expert Mobile | Редактирование профиля | /profile/edit | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-073 | Expert Mobile | Рейтинг | /reviews | R2 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-074 | Expert Mobile | Сплэш | /splash | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-075 | Expert Mobile | Статус верификации | /verification/status | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-076 | Expert Mobile | Тарифы | /tariffs | R2 | IMPLEMENTED_OR_PARTIAL | Сверить backend contract и визуальную полноту. |
| SCR-077 | Expert Mobile | Уведомления | /notifications | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-078 | Expert Mobile | Чат (эксперт) | /session/:id | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить; role flow и visual review. |
| SCR-079 | Expert Web | Видеоконсультация | /[locale]/expert/consultations/:id/call | R2 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сверить с mobile ownership, убрать независимую бизнес-логику. |
| SCR-080 | Expert Web | Главная | /[locale]/expert | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сверить с mobile ownership, убрать независимую бизнес-логику. |
| SCR-081 | Expert Web | Доход | /[locale]/expert/earnings | R2 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сверить с mobile ownership, убрать независимую бизнес-логику. |
| SCR-082 | Expert Web | Заявки | /[locale]/expert/offers | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сверить с mobile ownership, убрать независимую бизнес-логику. |
| SCR-083 | Expert Web | Клиенты | /[locale]/expert/clients | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сверить с mobile ownership, убрать независимую бизнес-логику. |
| SCR-084 | Expert Web | Консультации | /[locale]/expert/consultations | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сверить с mobile ownership, убрать независимую бизнес-логику. |
| SCR-085 | Expert Web | Поддержка | /[locale]/expert/support | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сверить с mobile ownership, убрать независимую бизнес-логику. |
| SCR-086 | Expert Web | Профиль | /[locale]/expert/profile | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сверить с mobile ownership, убрать независимую бизнес-логику. |
| SCR-087 | Expert Web | Расписание | /[locale]/expert/schedule | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сверить с mobile ownership, убрать независимую бизнес-логику. |
| SCR-088 | Expert Web | Рейтинг | /[locale]/expert/reviews | R2 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сверить с mobile ownership, убрать независимую бизнес-логику. |
| SCR-089 | Expert Web | Уведомления | /[locale]/expert/notifications | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сверить с mobile ownership, убрать независимую бизнес-логику. |
| SCR-090 | Expert Web | Чаты | /[locale]/expert/chats | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сверить с mobile ownership, убрать независимую бизнес-логику. |
| SCR-091 | Public Web | CookieBanner | global component | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить SEO/SSR; привести тексты и layout к канону. |
| SCR-092 | Public Web | LangSwitch | global component | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить SEO/SSR; привести тексты и layout к канону. |
| SCR-093 | Public Web | Premium | /[locale]/premium | R3 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить SEO/SSR; привести тексты и layout к канону. |
| SCR-094 | Public Web | Выбор темы | /[locale]/match | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить SEO/SSR; привести тексты и layout к канону. |
| SCR-095 | Public Web | Для бизнеса | /[locale]/business | R4 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить SEO/SSR; привести тексты и layout к канону. |
| SCR-096 | Public Web | Для вузов | /[locale]/universities | R5 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить SEO/SSR; привести тексты и layout к канону. |
| SCR-097 | Public Web | Каталог | /[locale]/catalog | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить SEO/SSR; привести тексты и layout к канону. |
| SCR-098 | Public Web | Материалы | /[locale]/materials | R3 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить SEO/SSR; привести тексты и layout к канону. |
| SCR-099 | Public Web | О нас | /[locale]/about | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить SEO/SSR; привести тексты и layout к канону. |
| SCR-100 | Public Web | Поддержка | /[locale]/support | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить SEO/SSR; привести тексты и layout к канону. |
| SCR-101 | Public Web | Поиск специалиста | /[locale]/match/search | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить SEO/SSR; привести тексты и layout к канону. |
| SCR-102 | Public Web | Политика конфиденциальности | /[locale]/legal/privacy | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить SEO/SSR; привести тексты и layout к канону. |
| SCR-103 | Public Web | Пользовательское соглашение | /[locale]/legal/terms | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить SEO/SSR; привести тексты и layout к канону. |
| SCR-104 | Public Web | Профиль психолога | /[locale]/experts/:id | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить SEO/SSR; привести тексты и layout к канону. |
| SCR-105 | Public Web | Стать психологом | /[locale]/become-expert | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить SEO/SSR; привести тексты и layout к канону. |
| SCR-106 | Public Web | Prototype Overview | /[locale]/prototype-overview | R1 | IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN | Сохранить SEO/SSR; привести тексты и layout к канону. |

## 4. Приоритет visual audit

### P0 — core flow

1. Client: Welcome/Auth → Home → Topic → Search → Found → Session → Complete/Review.
2. Expert: Auth/Verification → Home → Incoming offer → Session → Complete.
3. Admin: Login → Verification/Complaint/Payout decision.
4. Public: Home → Catalog → Profile → Start flow.

### P1 — transaction/reliability

- booking/reschedule/cancel;
- payment/refund;
- audio/video/reconnect;
- support/complaints;
- schedule/earnings;
- Premium entitlement/content.

### P2 — expansion

- admin dashboard/settings/mailings;
- B2B/B2G;
- wearables analysis;
- investor/storytelling artifacts.

## 5. Definition of visual parity

Экран считается aligned, если:

- пользовательская цель и информационная иерархия совпадают с утверждённой screen spec;
- prototype composition узнаваема, но business copy каноничен;
- token diff объясним;
- все data states реализованы;
- screenshot tests проходят на утверждённых viewports;
- keyboard/screen-reader/touch acceptance проходит;
- нет hardcoded demo data в production route;
- отличие записано в visual changelog.
