# 13. Frontend information architecture

## 1. Целевые поверхности и ответственность

| Поверхность | Владелец | Основная роль | Базовый route | Правило |
| --- | --- | --- | --- | --- |
| Client Mobile | app_client (Flutter) | REGISTERED_CLIENT | native/web Flutter router | Критический client journey реализуется здесь первым; web parity следует тем же business contracts. |
| Expert Mobile | app_expert (Flutter) | VERIFIED_EXPERT | native/web Flutter router | Офферы, availability, notifications и live session — first-class. |
| Expert Web | web/(expert) (Next.js) | VERIFIED_EXPERT | /[locale]/expert/* | Основной desktop operations: профиль, документы, расписание, история, финансы. |
| Client Web | web/(client) (Next.js) | REGISTERED_CLIENT | /[locale]/client/* | Desktop parity критических client flows, без независимых бизнес-правил. |
| Public Web | web/(public) (Next.js) | PUBLIC_VISITOR | /[locale]/* | SSR/SEO, каталог, маркетинг, legal, B2B/B2G lead capture. |
| Admin Web | admin (React/Vite) | staff roles | /* behind admin origin | Internal operations by RBAC; no demo-only modules without backend. |

## 2. Решение по Expert Mobile / Expert Web

### Expert Mobile — «сейчас и рядом»

- входящий оффер и таймер;
- accept/decline;
- work status/availability;
- ближайшая консультация;
- push/deep link;
- чат/аудио/видео;
- завершение и короткая заметка;
- быстрый просмотр earnings/payout status;
- critical support.

### Expert Web — «планировать и управлять»

- полный профессиональный профиль;
- документы и verification history;
- недельное расписание и exceptions;
- список заявок и консультаций;
- клиенты в пределах разрешённого pseudonymous context;
- длинные заметки и история;
- income/transactions/payout details;
- reviews/complaints;
- support/settings.

### Допустимое пересечение

Профиль, расписание, доход и история могут быть доступны на обеих платформах, но:

1. используют один API и одинаковые статусы;
2. одна поверхность объявляется primary owner для новой функции;
3. copy и validation не расходятся;
4. acceptance проводится на обеих, если функция обещана обеим;
5. platform-specific UX не копируется механически.

## 3. Client Mobile navigation

```text
Splash / Welcome / Auth
└── Onboarding / Permissions
    └── Home
        ├── SOS
        ├── Select topic & format
        │   └── Search → Found → Payment/coverage → Session
        ├── Catalog
        │   └── Expert profile → Slot picker → Booking
        ├── Consultations
        │   ├── Upcoming/details/reschedule/cancel
        │   ├── Active chat/call
        │   └── History → Review/Complaint
        ├── Favorites
        ├── Materials
        │   ├── Articles
        │   ├── Meditation
        │   ├── Breathing
        │   └── Music
        ├── Notifications
        └── Profile
            ├── Premium
            ├── Payment methods
            ├── Complaints/Support
            ├── Locale/privacy
            └── Logout/data request
```

### Bottom navigation recommendation

- Главная;
- Каталог;
- Консультации;
- Материалы;
- Профиль.

SOS — persistent contextual CTA, но не отдельная обычная tab.

## 4. Expert Mobile navigation

```text
Splash / Auth
└── Applicant onboarding
    ├── Professional profile
    ├── Documents
    └── Verification status
        └── Verified Home
            ├── Availability
            ├── Incoming offer / Offers
            ├── Consultations
            │   ├── Client safe card
            │   ├── Chat/call
            │   ├── Note
            │   └── Complete/outcome
            ├── Schedule
            ├── Earnings/Payouts
            ├── Reviews/Complaints
            ├── Notifications
            └── Profile/Support/Settings
```

### Bottom navigation recommendation

- Главная;
- Заявки;
- Консультации;
- Доход;
- Профиль.

Incoming offer может открываться поверх текущего контекста, но route/state остаётся воспроизводимым.

## 5. Public Web sitemap

```text
/[locale]
├── /catalog
│   └── /experts/:id
├── /match
├── /materials
├── /premium
├── /business
├── /universities
├── /become-expert
├── /about
├── /support
└── /legal
    ├── /terms
    ├── /privacy
    └── /cookies (если отдельная политика утверждена)
```

Header не должен смешивать public marketing и authenticated cabinet navigation.

## 6. Client Web sitemap

```text
/[locale]/client
├── /home
├── /match
├── /catalog
├── /consultations
│   └── /:id
├── /session/:id
├── /materials
├── /notifications
├── /premium
├── /support
└── /profile
```

## 7. Expert Web sitemap

```text
/[locale]/expert
├── /offers
├── /consultations
│   └── /:id
├── /chats
├── /clients
├── /schedule
├── /earnings
├── /reviews
├── /notifications
├── /profile
└── /support
```

## 8. Admin navigation by role

| Модуль | Verification | Support | Quality | Finance | Content | B2B | Superadmin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Dashboard | scoped | scoped | scoped | scoped | scoped | scoped | full |
| Verification | yes | no | read/escalation | no | no | B2G status | yes |
| Profile moderation | yes | no | read | no | no | no | yes |
| Tickets | no | yes | escalated | finance escalated | content escalated | contract escalated | yes |
| Complaints/reviews | no | escalated | yes | financial action | no | aggregate only | yes |
| Payouts/ledger | no | no | outcome read | yes | no | contract finance | yes |
| Staff/RBAC | no | no | no | no | no | no | yes |
| Dictionaries | no | no | consult | no | content subset | contract subset | yes |
| B2B/B2G | B2G verification | support | quality aggregate | finance | no | yes | yes |
| Incident center | informed | operational | safety | money | content | contract | commander |

## 9. Navigation rules

- Недоступный модуль скрывается; direct URL возвращает 403.
- Badge показывает реальную очередь, не demo counter.
- Deep link сначала восстанавливает session, потом проверяет ownership/role.
- Back navigation не повторяет mutation.
- Critical pending state переживает reload/restart.
- Mobile sheet не используется для длинной формы, требующей клавиатуры и review.
- Web table имеет mobile alternative, но admin остаётся desktop-first.
