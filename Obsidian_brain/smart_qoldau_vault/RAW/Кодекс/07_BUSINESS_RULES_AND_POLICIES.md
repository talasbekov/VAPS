# 07. Бизнес-правила и политики

**Всего правил:** 100.  
Статус `RECOMMENDED/REQUIRED` означает целевую норму blueprint; `IMPLEMENTED` — подтверждённое текущее направление; `LEGAL_REVIEW` и `DECISION_REQUIRED` блокируют публичное обещание до подтверждения.

| ID | Категория | Правило | Статус | Owner | Severity |
| --- | --- | --- | --- | --- | --- |
| BR-ID-001 | Identity | Внутренняя идентичность | RECOMMENDED | Privacy Owner | HIGH |
| BR-ID-002 | Identity | Guest history | RECOMMENDED | Product Owner | HIGH |
| BR-ID-003 | Identity | OTP limits | IMPLEMENTED_OR_REQUIRED | Security Owner | HIGH |
| BR-ID-004 | Identity | Consent versioning | RECOMMENDED | Legal | HIGH |
| BR-ID-005 | Identity | Возраст | DECISION_REQUIRED | Legal | HIGH |
| BR-ID-006 | Identity | Session revocation | REQUIRED | Security Owner | HIGH |
| BR-ID-007 | Identity | Deletion/export | RECOMMENDED | Privacy Owner | HIGH |
| BR-ID-008 | Identity | Locale | IMPLEMENTED | Localization Owner | HIGH |
| BR-SAFE-001 | Safety | Не экстренная служба | REQUIRED | Safety Owner | HIGH |
| BR-SAFE-002 | Safety | Непосредственная угроза | REQUIRED | Safety Owner | HIGH |
| BR-SAFE-003 | Safety | Без диагноза | REQUIRED | Clinical Owner | HIGH |
| BR-SAFE-004 | Safety | Тяжёлые темы | RECOMMENDED | Clinical Owner | HIGH |
| BR-SAFE-005 | Safety | Safety copy review | REQUIRED | Safety Owner | HIGH |
| BR-DISC-001 | Discovery | Единый каталог тем | REQUIRED | Product Owner | HIGH |
| BR-DISC-002 | Discovery | Форматы | IMPLEMENTED | Product Owner | HIGH |
| BR-DISC-003 | Discovery | Цена | RECOMMENDED | Commercial Owner | HIGH |
| BR-DISC-004 | Discovery | Price snapshot | CANON_PROPOSED | Finance Owner | HIGH |
| BR-DISC-005 | Discovery | Публичность специалиста | IMPLEMENTED | Verification Owner | HIGH |
| BR-DISC-006 | Discovery | Модерация фото/about | IMPLEMENTED | Verification Owner | HIGH |
| BR-DISC-007 | Discovery | Matching claim | RECOMMENDED | Product Owner | HIGH |
| BR-DISC-008 | Discovery | Directed booking | IMPLEMENTED_OR_REQUIRED | Product Owner | HIGH |
| BR-DISC-009 | Discovery | No experts | REQUIRED | Product Owner | HIGH |
| BR-MATCH-001 | Matching | Один победитель | IMPLEMENTED | Backend Lead | HIGH |
| BR-MATCH-002 | Matching | Offer deadline | IMPLEMENTED | Backend Lead | HIGH |
| BR-MATCH-003 | Matching | Emergency broadcast | IMPLEMENTED | Backend Lead | HIGH |
| BR-MATCH-004 | Matching | Eligibility | REQUIRED | Backend Lead | HIGH |
| BR-MATCH-005 | Matching | Fairness | RECOMMENDED | Marketplace Owner | HIGH |
| BR-BOOK-001 | Booking | Time zone | IMPLEMENTED | Product Owner | HIGH |
| BR-BOOK-002 | Booking | Double booking | REQUIRED | Backend Lead | HIGH |
| BR-BOOK-003 | Booking | Reschedule | RECOMMENDED | Backend Lead | HIGH |
| BR-PAY-001 | Payment | Money units | IMPLEMENTED_OR_REQUIRED | Finance Owner | HIGH |
| BR-PAY-002 | Payment | Idempotency | REQUIRED | Finance Owner | HIGH |
| BR-PAY-003 | Payment | Provider webhook | REQUIRED | Finance Owner | HIGH |
| BR-PAY-004 | Payment | Reconciliation | REQUIRED | Finance Owner | HIGH |
| BR-PAY-005 | Payment | Cancellation >2h | LEGAL_REVIEW | Finance Owner | HIGH |
| BR-PAY-006 | Payment | Cancellation <2h | LEGAL_REVIEW | Finance Owner | HIGH |
| BR-PAY-007 | Payment | Expert no-show | RECOMMENDED | Quality Lead | HIGH |
| BR-PAY-008 | Payment | Client no-show | LEGAL_REVIEW | Finance Owner | HIGH |
| BR-PAY-009 | Payment | Platform tech issue | RECOMMENDED | Quality Lead | HIGH |
| BR-PAY-010 | Payment | Receipt | REQUIRED | Finance Owner | HIGH |
| BR-PAY-011 | Payment | Payout availability | RECOMMENDED | Finance Owner | HIGH |
| BR-PAY-012 | Payment | Manual adjustments | RECOMMENDED | Finance Owner | HIGH |
| BR-SES-001 | Session | Authorization | IMPLEMENTED_OR_REQUIRED | Security Owner | HIGH |
| BR-SES-002 | Session | Chat privacy | REQUIRED | Privacy Owner | HIGH |
| BR-SES-003 | Session | Encryption wording | REQUIRED | Security Owner | HIGH |
| BR-SES-004 | Session | Reconnection | REQUIRED | Frontend Lead | HIGH |
| BR-SES-005 | Session | Format escalation | RECOMMENDED | Product Owner | HIGH |
| BR-SES-006 | Session | Completion | REQUIRED | Backend Lead | HIGH |
| BR-SES-007 | Session | Expert notes | IMPLEMENTED | Privacy Owner | HIGH |
| BR-SES-008 | Session | Grace period | RECOMMENDED | Product Owner | HIGH |
| BR-REV-001 | Reviews | Один отзыв | RECOMMENDED | Quality Lead | HIGH |
| BR-REV-002 | Reviews | Публичный текст | RECOMMENDED | Quality Lead | HIGH |
| BR-REV-003 | Reviews | Private feedback | RECOMMENDED | Quality Lead | HIGH |
| BR-COMP-001 | Complaints | Complaint window | RECOMMENDED | Quality Lead | HIGH |
| BR-COMP-002 | Complaints | Evidence minimization | RECOMMENDED | Privacy Owner | HIGH |
| BR-COMP-003 | Complaints | Decision separation | RECOMMENDED | Quality Lead | HIGH |
| BR-COMP-004 | Complaints | Right to respond | RECOMMENDED | Quality Lead | HIGH |
| BR-COMP-005 | Complaints | Strike policy | RECOMMENDED | Quality Lead | HIGH |
| BR-VER-001 | Verification | SLA 24h | IMPLEMENTED | Verification Owner | HIGH |
| BR-VER-002 | Verification | Document privacy | IMPLEMENTED | Security Owner | HIGH |
| BR-VER-003 | Verification | File validation | IMPLEMENTED_OR_REQUIRED | Security Owner | HIGH |
| BR-VER-004 | Verification | Reupload | IMPLEMENTED_OR_REQUIRED | Verification Owner | HIGH |
| BR-VER-005 | Verification | Duplicate identity | RECOMMENDED | Verification Owner | HIGH |
| BR-EXP-001 | Expert | Availability | REQUIRED | Marketplace Owner | HIGH |
| BR-EXP-002 | Expert | Schedule exceptions | RECOMMENDED | Product Owner | HIGH |
| BR-EXP-003 | Expert | Tariff visibility | RECOMMENDED | Commercial Owner | HIGH |
| BR-EXP-004 | Expert | Payout transparency | RECOMMENDED | Finance Owner | HIGH |
| BR-PREM-001 | Premium | Canonical price | CANON_PROPOSED | Commercial Owner | HIGH |
| BR-PREM-002 | Premium | No free sessions | CANON_PROPOSED | Commercial Owner | HIGH |
| BR-PREM-003 | Premium | Server entitlement | IMPLEMENTED | Security Owner | HIGH |
| BR-PREM-004 | Premium | Cancellation | RECOMMENDED | Commercial Owner | HIGH |
| BR-CONT-001 | Content | Kinds | IMPLEMENTED_OR_REQUIRED | Content Owner | HIGH |
| BR-CONT-002 | Content | Language completeness | IMPLEMENTED | Localization Owner | HIGH |
| BR-CONT-003 | Content | Clinical review | RECOMMENDED | Safety Owner | HIGH |
| BR-CONT-004 | Content | Media URL TTL | IMPLEMENTED | Security Owner | HIGH |
| BR-B2B-001 | B2B | Aggregate only | RECOMMENDED | Privacy Owner | HIGH |
| BR-B2B-002 | B2B | Pool accounting | RECOMMENDED | B2B Owner | HIGH |
| BR-B2B-003 | B2B | Coverage disclosure | RECOMMENDED | B2B Owner | HIGH |
| BR-B2B-004 | B2B | Contract expiry | RECOMMENDED | B2B Owner | HIGH |
| BR-B2G-001 | B2G | Explicit intern consent | REQUIRED_FOR_B2G | B2G Owner | HIGH |
| BR-B2G-002 | B2G | Supervisor required | REQUIRED_FOR_B2G | B2G Owner | HIGH |
| BR-B2G-003 | B2G | Topic restrictions | REQUIRED_FOR_B2G | Safety Owner | HIGH |
| BR-B2G-004 | B2G | De-identification | REQUIRED_FOR_B2G | Privacy Owner | HIGH |
| BR-B2G-005 | B2G | Hours approval | REQUIRED_FOR_B2G | B2G Owner | HIGH |
| BR-ADM-001 | Admin | Least privilege | IMPLEMENTED_OR_REQUIRED | Security Owner | HIGH |
| BR-ADM-002 | Admin | 2FA | IMPLEMENTED_OR_REQUIRED | Security Owner | HIGH |
| BR-ADM-003 | Admin | Last superadmin | IMPLEMENTED | Security Owner | HIGH |
| BR-ADM-004 | Admin | Audit after commit | REQUIRED | Security Owner | HIGH |
| BR-ADM-005 | Admin | Sensitive search | RECOMMENDED | Privacy Owner | HIGH |
| BR-ADM-006 | Admin | Four-eyes | RECOMMENDED | Security Owner | HIGH |
| BR-OPS-001 | Operations | SLA ownership | REQUIRED | Operations Lead | HIGH |
| BR-OPS-002 | Operations | Notifications after commit | REQUIRED | Backend Lead | HIGH |
| BR-OPS-003 | Operations | Deep-link authorization | REQUIRED | Security Owner | HIGH |
| BR-OPS-004 | Operations | No fake success | REQUIRED | Frontend Lead | HIGH |
| BR-OPS-005 | Operations | Analytics minimization | IMPLEMENTED_OR_REQUIRED | Privacy Owner | HIGH |
| BR-UX-001 | UX | All states | REQUIRED | Frontend Lead | HIGH |
| BR-UX-002 | UX | No dead actions | REQUIRED | Product Owner | HIGH |
| BR-UX-003 | UX | Visual canon | REQUIRED | Design Lead | HIGH |
| BR-UX-004 | UX | Accessibility | REQUIRED | Frontend Lead | HIGH |
| BR-UX-005 | UX | Visual change log | REQUIRED | Design Lead | HIGH |

---

## BR-ID-001 — Внутренняя идентичность

**Категория:** Identity  
**Формулировка:** Каждая консультация имеет внутренний user identity; псевдоним скрывает личность от специалиста, но не отменяет security/audit.  
**Статус:** `RECOMMENDED`  
**Владелец:** Privacy Owner  
**Источник/основание:** PD-007  
**Критичность:** HIGH

## BR-ID-002 — Guest history

**Категория:** Identity  
**Формулировка:** Guest явно предупреждается, что история/восстановление могут быть ограничены; конвертация сохраняет разрешённые данные без дубля.  
**Статус:** `RECOMMENDED`  
**Владелец:** Product Owner  
**Источник/основание:** Prototype profile copy  
**Критичность:** HIGH

## BR-ID-003 — OTP limits

**Категория:** Identity  
**Формулировка:** SMS-коды имеют TTL, лимит попыток и resend rate limit; ошибки не раскрывают существование номера.  
**Статус:** `IMPLEMENTED_OR_REQUIRED`  
**Владелец:** Security Owner  
**Источник/основание:** Current auth API  
**Критичность:** HIGH

## BR-ID-004 — Consent versioning

**Категория:** Identity  
**Формулировка:** Согласие хранится с типом, версией документа, временем, locale и каналом.  
**Статус:** `RECOMMENDED`  
**Владелец:** Legal  
**Источник/основание:** Privacy requirement  
**Критичность:** HIGH

## BR-ID-005 — Возраст

**Категория:** Identity  
**Формулировка:** До отдельного решения консультации доступны только 18+.  
**Статус:** `DECISION_REQUIRED`  
**Владелец:** Legal  
**Источник/основание:** PD-014  
**Критичность:** HIGH

## BR-ID-006 — Session revocation

**Категория:** Identity  
**Формулировка:** Выход/компрометация отзывают refresh/session/device credentials.  
**Статус:** `REQUIRED`  
**Владелец:** Security Owner  
**Источник/основание:** Security baseline  
**Критичность:** HIGH

## BR-ID-007 — Deletion/export

**Категория:** Identity  
**Формулировка:** Запрос удаления/экспорта проходит управляемый workflow с исключениями по финансовому и юридическому retention.  
**Статус:** `RECOMMENDED`  
**Владелец:** Privacy Owner  
**Источник/основание:** Data subject rights  
**Критичность:** HIGH

## BR-ID-008 — Locale

**Категория:** Identity  
**Формулировка:** RU/KK preference хранится у пользователя и применяется к UI, уведомлениям и контенту.  
**Статус:** `IMPLEMENTED`  
**Владелец:** Localization Owner  
**Источник/основание:** Current apps  
**Критичность:** HIGH

## BR-SAFE-001 — Не экстренная служба

**Категория:** Safety  
**Формулировка:** На каждом кризисном экране прямо указано, что платформа не заменяет 102/103/экстренную помощь.  
**Статус:** `REQUIRED`  
**Владелец:** Safety Owner  
**Источник/основание:** PD-015  
**Критичность:** HIGH

## BR-SAFE-002 — Непосредственная угроза

**Категория:** Safety  
**Формулировка:** Положительный screening на непосредственную угрозу ведёт к 102/103/горячим линиям; обычный matching не показывается как единственное действие.  
**Статус:** `REQUIRED`  
**Владелец:** Safety Owner  
**Источник/основание:** Prototype emergency flow  
**Критичность:** HIGH

## BR-SAFE-003 — Без диагноза

**Категория:** Safety  
**Формулировка:** UI и контент не ставят диагноз и не обещают лечение/гарантированный результат.  
**Статус:** `REQUIRED`  
**Владелец:** Clinical Owner  
**Источник/основание:** Safety baseline  
**Критичность:** HIGH

## BR-SAFE-004 — Тяжёлые темы

**Категория:** Safety  
**Формулировка:** Практиканты исключаются из тяжёлых тем и кризисных обращений.  
**Статус:** `RECOMMENDED`  
**Владелец:** Clinical Owner  
**Источник/основание:** Prototype HEAVY_TOPICS  
**Критичность:** HIGH

## BR-SAFE-005 — Safety copy review

**Категория:** Safety  
**Формулировка:** Тексты SOS, no-show, complaint и self-help проходят review safety owner перед релизом.  
**Статус:** `REQUIRED`  
**Владелец:** Safety Owner  
**Источник/основание:** Governance  
**Критичность:** HIGH

## BR-DISC-001 — Единый каталог тем

**Категория:** Discovery  
**Формулировка:** Список тем — серверный справочник; mobile/web/admin не держат разные hardcoded наборы.  
**Статус:** `REQUIRED`  
**Владелец:** Product Owner  
**Источник/основание:** Prototype contradiction  
**Критичность:** HIGH

## BR-DISC-002 — Форматы

**Категория:** Discovery  
**Формулировка:** Чат/аудио/видео доступны только если поддерживаются специалистом и платформой.  
**Статус:** `IMPLEMENTED`  
**Владелец:** Product Owner  
**Источник/основание:** Backend expert formats  
**Критичность:** HIGH

## BR-DISC-003 — Цена

**Категория:** Discovery  
**Формулировка:** Показываемая цена — итог за сессию до скидок/coverage; все скидки объясняются отдельно.  
**Статус:** `RECOMMENDED`  
**Владелец:** Commercial Owner  
**Источник/основание:** PD-006  
**Критичность:** HIGH

## BR-DISC-004 — Price snapshot

**Категория:** Discovery  
**Формулировка:** При создании подтверждённой записи/консультации цена сохраняется snapshot и не меняется при редактировании профиля.  
**Статус:** `CANON_PROPOSED`  
**Владелец:** Finance Owner  
**Источник/основание:** Prototype dictionary  
**Критичность:** HIGH

## BR-DISC-005 — Публичность специалиста

**Категория:** Discovery  
**Формулировка:** В каталог попадает только VERIFIED, не blocked и с одобренными публичными полями специалист.  
**Статус:** `IMPLEMENTED`  
**Владелец:** Verification Owner  
**Источник/основание:** Current backend README  
**Критичность:** HIGH

## BR-DISC-006 — Модерация фото/about

**Категория:** Discovery  
**Формулировка:** Новое фото/about не заменяет опубликованное до решения оператора; отклонение требует комментария.  
**Статус:** `IMPLEMENTED`  
**Владелец:** Verification Owner  
**Источник/основание:** Current backend README  
**Критичность:** HIGH

## BR-DISC-007 — Matching claim

**Категория:** Discovery  
**Формулировка:** UI не показывает фиксированный SLA подбора без подтверждённого percentile metric.  
**Статус:** `RECOMMENDED`  
**Владелец:** Product Owner  
**Источник/основание:** PD-009  
**Критичность:** HIGH

## BR-DISC-008 — Directed booking

**Категория:** Discovery  
**Формулировка:** Клиент может выбрать конкретного специалиста; слот и format повторно валидируются при подтверждении.  
**Статус:** `IMPLEMENTED_OR_REQUIRED`  
**Владелец:** Product Owner  
**Источник/основание:** Client booking flow  
**Критичность:** HIGH

## BR-DISC-009 — No experts

**Категория:** Discovery  
**Формулировка:** Если кандидатов нет, система честно сообщает результат, предлагает изменить формат/время или callback; не показывает вечный spinner.  
**Статус:** `REQUIRED`  
**Владелец:** Product Owner  
**Источник/основание:** UX baseline  
**Критичность:** HIGH

## BR-MATCH-001 — Один победитель

**Категория:** Matching  
**Формулировка:** Одна заявка создаёт не более одной активной консультации; конкурентные accept атомарны.  
**Статус:** `IMPLEMENTED`  
**Владелец:** Backend Lead  
**Источник/основание:** Existing transaction/e2e  
**Критичность:** HIGH

## BR-MATCH-002 — Offer deadline

**Категория:** Matching  
**Формулировка:** Каждый оффер имеет deadline; timeout не принимается после истечения.  
**Статус:** `IMPLEMENTED`  
**Владелец:** Backend Lead  
**Источник/основание:** Existing matching  
**Критичность:** HIGH

## BR-MATCH-003 — Emergency broadcast

**Категория:** Matching  
**Формулировка:** Broadcast допускает несколько одновременных офферов разным специалистам, но первый подтверждённый матч отзывает остальные.  
**Статус:** `IMPLEMENTED`  
**Владелец:** Backend Lead  
**Источник/основание:** Existing matching  
**Критичность:** HIGH

## BR-MATCH-004 — Eligibility

**Категория:** Matching  
**Формулировка:** Кандидат фильтруется по verification, block, topic, format, schedule, work status, presence, conflict и intern limits.  
**Статус:** `REQUIRED`  
**Владелец:** Backend Lead  
**Источник/основание:** Domain rules  
**Критичность:** HIGH

## BR-MATCH-005 — Fairness

**Категория:** Matching  
**Формулировка:** Приоритет Premium/тарифа не может обходить eligibility и безопасность; формула и tie-break документируются.  
**Статус:** `RECOMMENDED`  
**Владелец:** Marketplace Owner  
**Источник/основание:** Trust requirement  
**Критичность:** HIGH

## BR-BOOK-001 — Time zone

**Категория:** Booking  
**Формулировка:** Слоты хранятся в UTC и показываются как Asia/Almaty с явной подписью.  
**Статус:** `IMPLEMENTED`  
**Владелец:** Product Owner  
**Источник/основание:** Current client README  
**Критичность:** HIGH

## BR-BOOK-002 — Double booking

**Категория:** Booking  
**Формулировка:** Пересекающиеся подтверждённые слоты одного специалиста запрещены на сервере.  
**Статус:** `REQUIRED`  
**Владелец:** Backend Lead  
**Источник/основание:** Scheduling invariant  
**Критичность:** HIGH

## BR-BOOK-003 — Reschedule

**Категория:** Booking  
**Формулировка:** Перенос создаёт подтверждённое новое время атомарно или оставляет старое; промежуточная потеря записи недопустима.  
**Статус:** `RECOMMENDED`  
**Владелец:** Backend Lead  
**Источник/основание:** Reliability  
**Критичность:** HIGH

## BR-PAY-001 — Money units

**Категория:** Payment  
**Формулировка:** Деньги хранятся в тиынах/целом minor unit, currency KZT.  
**Статус:** `IMPLEMENTED_OR_REQUIRED`  
**Владелец:** Finance Owner  
**Источник/основание:** Existing priceTiyn pattern  
**Критичность:** HIGH

## BR-PAY-002 — Idempotency

**Категория:** Payment  
**Формулировка:** Создание оплаты, capture, refund и payout идемпотентны по внутреннему ключу.  
**Статус:** `REQUIRED`  
**Владелец:** Finance Owner  
**Источник/основание:** Payment safety  
**Критичность:** HIGH

## BR-PAY-003 — Provider webhook

**Категория:** Payment  
**Формулировка:** Webhook проверяет подпись, повтор безопасен; fulfilment выполняется после durable commit.  
**Статус:** `REQUIRED`  
**Владелец:** Finance Owner  
**Источник/основание:** Fable payment methodology  
**Критичность:** HIGH

## BR-PAY-004 — Reconciliation

**Категория:** Payment  
**Формулировка:** Pending/stuck операции периодически сверяются с провайдером.  
**Статус:** `REQUIRED`  
**Владелец:** Finance Owner  
**Источник/основание:** Fable payment methodology  
**Критичность:** HIGH

## BR-PAY-005 — Cancellation >2h

**Категория:** Payment  
**Формулировка:** При отмене клиентом более чем за 2 часа — полный возврат.  
**Статус:** `LEGAL_REVIEW`  
**Владелец:** Finance Owner  
**Источник/основание:** Prototype dictionary  
**Критичность:** HIGH

## BR-PAY-006 — Cancellation <2h

**Категория:** Payment  
**Формулировка:** При отмене менее чем за 2 часа — 50% клиенту, 50% компенсация специалисту.  
**Статус:** `LEGAL_REVIEW`  
**Владелец:** Finance Owner  
**Источник/основание:** Prototype dictionary  
**Критичность:** HIGH

## BR-PAY-007 — Expert no-show

**Категория:** Payment  
**Формулировка:** No-show специалиста — полный возврат клиенту, инцидент качества и возможный strike.  
**Статус:** `RECOMMENDED`  
**Владелец:** Quality Lead  
**Источник/основание:** Prototype dictionary  
**Критичность:** HIGH

## BR-PAY-008 — Client no-show

**Категория:** Payment  
**Формулировка:** No-show клиента после grace period — компенсация специалисту по утверждённой политике.  
**Статус:** `LEGAL_REVIEW`  
**Владелец:** Finance Owner  
**Источник/основание:** Prototype dictionary  
**Критичность:** HIGH

## BR-PAY-009 — Platform tech issue

**Категория:** Payment  
**Формулировка:** Подтверждённая проблема платформы — полный возврат или бесплатный перенос; решение не возлагается на клиента.  
**Статус:** `RECOMMENDED`  
**Владелец:** Quality Lead  
**Источник/основание:** Trust baseline  
**Критичность:** HIGH

## BR-PAY-010 — Receipt

**Категория:** Payment  
**Формулировка:** После capture/refund пользователь получает понятный статус и чек/ссылку на чек по требованиям провайдера.  
**Статус:** `REQUIRED`  
**Владелец:** Finance Owner  
**Источник/основание:** Payment baseline  
**Критичность:** HIGH

## BR-PAY-011 — Payout availability

**Категория:** Payment  
**Формулировка:** Доход специалиста становится доступным к выводу только после завершения dispute window/финансового клиринга.  
**Статус:** `RECOMMENDED`  
**Владелец:** Finance Owner  
**Источник/основание:** Marketplace risk  
**Критичность:** HIGH

## BR-PAY-012 — Manual adjustments

**Категория:** Payment  
**Формулировка:** Ручная корректировка требует роли FINANCE_CONTROL, причины, four-eyes для крупной суммы и audit.  
**Статус:** `RECOMMENDED`  
**Владелец:** Finance Owner  
**Источник/основание:** Admin safety  
**Критичность:** HIGH

## BR-SES-001 — Authorization

**Категория:** Session  
**Формулировка:** К сессии допускаются только клиент и назначенный специалист; direct URL повторно проверяет право.  
**Статус:** `IMPLEMENTED_OR_REQUIRED`  
**Владелец:** Security Owner  
**Источник/основание:** Session access  
**Критичность:** HIGH

## BR-SES-002 — Chat privacy

**Категория:** Session  
**Формулировка:** Тексты сообщений не попадают в analytics, обычные логи и уведомления.  
**Статус:** `REQUIRED`  
**Владелец:** Privacy Owner  
**Источник/основание:** Current analytics invariant  
**Критичность:** HIGH

## BR-SES-003 — Encryption wording

**Категория:** Session  
**Формулировка:** Если сервер хранит ключ и расшифровывает сообщения, продукт не называет это end-to-end encryption.  
**Статус:** `REQUIRED`  
**Владелец:** Security Owner  
**Источник/основание:** Terminology  
**Критичность:** HIGH

## BR-SES-004 — Reconnection

**Категория:** Session  
**Формулировка:** После разрыва клиент видит reconnect state; повторный вход синхронизирует authoritative session state.  
**Статус:** `REQUIRED`  
**Владелец:** Frontend Lead  
**Источник/основание:** Prototype call screens  
**Критичность:** HIGH

## BR-SES-005 — Format escalation

**Категория:** Session  
**Формулировка:** Переход chat→audio→video требует согласия обоих и нового media token; downgrade всегда доступен.  
**Статус:** `RECOMMENDED`  
**Владелец:** Product Owner  
**Источник/основание:** Current LiveKit flow  
**Критичность:** HIGH

## BR-SES-006 — Completion

**Категория:** Session  
**Формулировка:** Завершение фиксирует outcome один раз; повторный запрос возвращает тот же результат.  
**Статус:** `REQUIRED`  
**Владелец:** Backend Lead  
**Источник/основание:** Idempotency  
**Критичность:** HIGH

## BR-SES-007 — Expert notes

**Категория:** Session  
**Формулировка:** Заметка специалиста приватна, не показывается клиенту и не попадает в audit plaintext.  
**Статус:** `IMPLEMENTED`  
**Владелец:** Privacy Owner  
**Источник/основание:** Existing encrypted notes  
**Критичность:** HIGH

## BR-SES-008 — Grace period

**Категория:** Session  
**Формулировка:** No-show определяется только после утверждённого grace period и проверок join/webhook.  
**Статус:** `RECOMMENDED`  
**Владелец:** Product Owner  
**Источник/основание:** No-show safety  
**Критичность:** HIGH

## BR-REV-001 — Один отзыв

**Категория:** Reviews  
**Формулировка:** Одна завершённая консультация — не более одного отзыва клиента; разрешено редактирование в установленное окно, если одобрено.  
**Статус:** `RECOMMENDED`  
**Владелец:** Quality Lead  
**Источник/основание:** Review model  
**Критичность:** HIGH

## BR-REV-002 — Публичный текст

**Категория:** Reviews  
**Формулировка:** Публичный текст проходит PII/sensitive-content moderation; оценка может быть опубликована отдельно.  
**Статус:** `RECOMMENDED`  
**Владелец:** Quality Lead  
**Источник/основание:** PD-008  
**Критичность:** HIGH

## BR-REV-003 — Private feedback

**Категория:** Reviews  
**Формулировка:** Приватная обратная связь не публикуется и видна только quality team по purpose.  
**Статус:** `RECOMMENDED`  
**Владелец:** Quality Lead  
**Источник/основание:** PD-008  
**Критичность:** HIGH

## BR-COMP-001 — Complaint window

**Категория:** Complaints  
**Формулировка:** Жалоба по консультации принимается до 48 часов после завершения; safety/abuse обращения могут приниматься вне окна.  
**Статус:** `RECOMMENDED`  
**Владелец:** Quality Lead  
**Источник/основание:** Prototype dictionary  
**Критичность:** HIGH

## BR-COMP-002 — Evidence minimization

**Категория:** Complaints  
**Формулировка:** Команда качества получает только необходимые evidence; полный чат не открывается автоматически.  
**Статус:** `RECOMMENDED`  
**Владелец:** Privacy Owner  
**Источник/основание:** Data minimization  
**Критичность:** HIGH

## BR-COMP-003 — Decision separation

**Категория:** Complaints  
**Формулировка:** Quality принимает решение, Finance исполняет финансовую часть; каждый шаг аудируется.  
**Статус:** `RECOMMENDED`  
**Владелец:** Quality Lead  
**Источник/основание:** Separation of duties  
**Критичность:** HIGH

## BR-COMP-004 — Right to respond

**Категория:** Complaints  
**Формулировка:** Специалист получает безопасное описание претензии и срок ответа, кроме случаев угрозы/злоупотребления.  
**Статус:** `RECOMMENDED`  
**Владелец:** Quality Lead  
**Источник/основание:** Fair process  
**Критичность:** HIGH

## BR-COMP-005 — Strike policy

**Категория:** Complaints  
**Формулировка:** Strike имеет причину, срок/уровень и appeal path; автоматическая permanent block без review запрещена.  
**Статус:** `RECOMMENDED`  
**Владелец:** Quality Lead  
**Источник/основание:** Governance  
**Критичность:** HIGH

## BR-VER-001 — SLA 24h

**Категория:** Verification  
**Формулировка:** Очередь показывает возраст заявки и просрочку 24 часа; auto-approval отсутствует.  
**Статус:** `IMPLEMENTED`  
**Владелец:** Verification Owner  
**Источник/основание:** Current admin README  
**Критичность:** HIGH

## BR-VER-002 — Document privacy

**Категория:** Verification  
**Формулировка:** Документы хранятся в закрытом bucket и выдаются короткоживущей signed URL уполномоченному оператору.  
**Статус:** `IMPLEMENTED`  
**Владелец:** Security Owner  
**Источник/основание:** Current backend README  
**Критичность:** HIGH

## BR-VER-003 — File validation

**Категория:** Verification  
**Формулировка:** Файл валидируется по magic bytes/фактическому содержимому, размеру и допустимому формату.  
**Статус:** `IMPLEMENTED_OR_REQUIRED`  
**Владелец:** Security Owner  
**Источник/основание:** Existing validator/avatar rules  
**Критичность:** HIGH

## BR-VER-004 — Reupload

**Категория:** Verification  
**Формулировка:** REUPLOAD_REQUIRED возвращает только конкретные документы/поля с комментарием; старая опубликованная информация не исчезает без причины.  
**Статус:** `IMPLEMENTED_OR_REQUIRED`  
**Владелец:** Verification Owner  
**Источник/основание:** Current moderation model  
**Критичность:** HIGH

## BR-VER-005 — Duplicate identity

**Категория:** Verification  
**Формулировка:** Duplicate IIN/identity требует ручного review и не раскрывается кандидату как чужая запись.  
**Статус:** `RECOMMENDED`  
**Владелец:** Verification Owner  
**Источник/основание:** Prototype dictionary  
**Критичность:** HIGH

## BR-EXP-001 — Availability

**Категория:** Expert  
**Формулировка:** Work status и presence — разные сигналы; offline heartbeat не меняет вручную заданный статус навсегда.  
**Статус:** `REQUIRED`  
**Владелец:** Marketplace Owner  
**Источник/основание:** Presence domain  
**Критичность:** HIGH

## BR-EXP-002 — Schedule exceptions

**Категория:** Expert  
**Формулировка:** Исключение конкретного дня имеет приоритет над недельным расписанием.  
**Статус:** `RECOMMENDED`  
**Владелец:** Product Owner  
**Источник/основание:** Scheduling  
**Критичность:** HIGH

## BR-EXP-003 — Tariff visibility

**Категория:** Expert  
**Формулировка:** Тариф влияет на комиссию/visibility только после eligibility; UI показывает точную ставку и дату изменения.  
**Статус:** `RECOMMENDED`  
**Владелец:** Commercial Owner  
**Источник/основание:** Prototype tariffs  
**Критичность:** HIGH

## BR-EXP-004 — Payout transparency

**Категория:** Expert  
**Формулировка:** Доход показывает gross, commission, net, статус и source consultation без раскрытия клиента.  
**Статус:** `RECOMMENDED`  
**Владелец:** Finance Owner  
**Источник/основание:** Expert web prototype  
**Критичность:** HIGH

## BR-PREM-001 — Canonical price

**Категория:** Premium  
**Формулировка:** Premium: 2 990 ₸/мес или 23 900 ₸/год до нового коммерческого решения.  
**Статус:** `CANON_PROPOSED`  
**Владелец:** Commercial Owner  
**Источник/основание:** PD-005  
**Критичность:** HIGH

## BR-PREM-002 — No free sessions

**Категория:** Premium  
**Формулировка:** Premium не включает стоимость консультаций.  
**Статус:** `CANON_PROPOSED`  
**Владелец:** Commercial Owner  
**Источник/основание:** User agreement prototype/current web  
**Критичность:** HIGH

## BR-PREM-003 — Server entitlement

**Категория:** Premium  
**Формулировка:** Доступ к premium media проверяется сервером; визуальный замок не является контролем доступа.  
**Статус:** `IMPLEMENTED`  
**Владелец:** Security Owner  
**Источник/основание:** Current backend README  
**Критичность:** HIGH

## BR-PREM-004 — Cancellation

**Категория:** Premium  
**Формулировка:** Отмена отключает renewal, но entitlement действует до конца оплаченного периода, если иное не требуется законом.  
**Статус:** `RECOMMENDED`  
**Владелец:** Commercial Owner  
**Источник/основание:** Subscription norm  
**Критичность:** HIGH

## BR-CONT-001 — Kinds

**Категория:** Content  
**Формулировка:** Контент имеет тип ARTICLE/MEDITATION/MUSIC/BREATHING и единый lifecycle draft→review→published→archived.  
**Статус:** `IMPLEMENTED_OR_REQUIRED`  
**Владелец:** Content Owner  
**Источник/основание:** Current backend README  
**Критичность:** HIGH

## BR-CONT-002 — Language completeness

**Категория:** Content  
**Формулировка:** Материал публикуется для locale только при наличии утверждённого перевода этой locale.  
**Статус:** `IMPLEMENTED`  
**Владелец:** Localization Owner  
**Источник/основание:** Current backend README  
**Критичность:** HIGH

## BR-CONT-003 — Clinical review

**Категория:** Content  
**Формулировка:** Материал с психологическими рекомендациями требует expert/safety review.  
**Статус:** `RECOMMENDED`  
**Владелец:** Safety Owner  
**Источник/основание:** Content safety  
**Критичность:** HIGH

## BR-CONT-004 — Media URL TTL

**Категория:** Content  
**Формулировка:** Приватное аудио выдаётся signed URL с коротким TTL после entitlement check.  
**Статус:** `IMPLEMENTED`  
**Владелец:** Security Owner  
**Источник/основание:** Current backend README  
**Критичность:** HIGH

## BR-B2B-001 — Aggregate only

**Категория:** B2B  
**Формулировка:** Организация не получает индивидуальные данные обращений; minimum cohort threshold применяется к статистике.  
**Статус:** `RECOMMENDED`  
**Владелец:** Privacy Owner  
**Источник/основание:** PD-016  
**Критичность:** HIGH

## BR-B2B-002 — Pool accounting

**Категория:** B2B  
**Формулировка:** Сессия резервирует единицу пула при подтверждении и окончательно списывает по settlement policy; rollback возвращает резерв.  
**Статус:** `RECOMMENDED`  
**Владелец:** B2B Owner  
**Источник/основание:** Entitlement accounting  
**Критичность:** HIGH

## BR-B2B-003 — Coverage disclosure

**Категория:** B2B  
**Формулировка:** Клиент до подтверждения видит, что покрывает договор, остаток и возможную доплату.  
**Статус:** `RECOMMENDED`  
**Владелец:** B2B Owner  
**Источник/основание:** UX trust  
**Критичность:** HIGH

## BR-B2B-004 — Contract expiry

**Категория:** B2B  
**Формулировка:** Истечение договора не раскрывает историю организации и не прекращает активную оплаченную сессию; новый booking требует нового entitlement.  
**Статус:** `RECOMMENDED`  
**Владелец:** B2B Owner  
**Источник/основание:** Contract lifecycle  
**Критичность:** HIGH

## BR-B2G-001 — Explicit intern consent

**Категория:** B2G  
**Формулировка:** До матча клиент явно видит статус практиканта, supervisor model и цену и подтверждает согласие.  
**Статус:** `REQUIRED_FOR_B2G`  
**Владелец:** B2G Owner  
**Источник/основание:** PD-017  
**Критичность:** HIGH

## BR-B2G-002 — Supervisor required

**Категория:** B2G  
**Формулировка:** Практикант не активируется без действующего supervisor assignment.  
**Статус:** `REQUIRED_FOR_B2G`  
**Владелец:** B2G Owner  
**Источник/основание:** PD-017  
**Критичность:** HIGH

## BR-B2G-003 — Topic restrictions

**Категория:** B2G  
**Формулировка:** Практикант не получает heavy/crisis topics; список централизован и auditable.  
**Статус:** `REQUIRED_FOR_B2G`  
**Владелец:** Safety Owner  
**Источник/основание:** BR-SAFE-004  
**Критичность:** HIGH

## BR-B2G-004 — De-identification

**Категория:** B2G  
**Формулировка:** Супервайзер получает минимально необходимое обезличенное case summary, а не полный чат по умолчанию.  
**Статус:** `REQUIRED_FOR_B2G`  
**Владелец:** Privacy Owner  
**Источник/основание:** Data minimization  
**Критичность:** HIGH

## BR-B2G-005 — Hours approval

**Категория:** B2G  
**Формулировка:** Часы засчитываются только по completed/approved session и подтверждению supervisor; корректировка аудируется.  
**Статус:** `REQUIRED_FOR_B2G`  
**Владелец:** B2G Owner  
**Источник/основание:** Training governance  
**Критичность:** HIGH

## BR-ADM-001 — Least privilege

**Категория:** Admin  
**Формулировка:** Меню скрывает недоступные модули, но сервер повторно проверяет роль и scope на каждом endpoint.  
**Статус:** `IMPLEMENTED_OR_REQUIRED`  
**Владелец:** Security Owner  
**Источник/основание:** Current admin RBAC  
**Критичность:** HIGH

## BR-ADM-002 — 2FA

**Категория:** Admin  
**Формулировка:** SUPERADMIN и чувствительные финансовые роли используют 2FA; recovery аудируется.  
**Статус:** `IMPLEMENTED_OR_REQUIRED`  
**Владелец:** Security Owner  
**Источник/основание:** Current backend README  
**Критичность:** HIGH

## BR-ADM-003 — Last superadmin

**Категория:** Admin  
**Формулировка:** Нельзя деактивировать или разжаловать последнего активного SUPERADMIN.  
**Статус:** `IMPLEMENTED`  
**Владелец:** Security Owner  
**Источник/основание:** Current backend README  
**Критичность:** HIGH

## BR-ADM-004 — Audit after commit

**Категория:** Admin  
**Формулировка:** Успешный audit/notification создаётся только после commit; failed validation не выглядит как success.  
**Статус:** `REQUIRED`  
**Владелец:** Security Owner  
**Источник/основание:** Fable methodology  
**Критичность:** HIGH

## BR-ADM-005 — Sensitive search

**Категория:** Admin  
**Формулировка:** Поиск клиентов/специалистов журналируется и ограничивается purpose/role.  
**Статус:** `RECOMMENDED`  
**Владелец:** Privacy Owner  
**Источник/основание:** Admin privacy  
**Критичность:** HIGH

## BR-ADM-006 — Four-eyes

**Категория:** Admin  
**Формулировка:** Крупный refund, ручная корректировка и permanent block требуют второго подтверждения по настроенному порогу.  
**Статус:** `RECOMMENDED`  
**Владелец:** Security Owner  
**Источник/основание:** Separation of duties  
**Критичность:** HIGH

## BR-OPS-001 — SLA ownership

**Категория:** Operations  
**Формулировка:** У каждой очереди есть owner, SLA, escalation и dashboard aging; SLA без owner запрещён.  
**Статус:** `REQUIRED`  
**Владелец:** Operations Lead  
**Источник/основание:** Operating model  
**Критичность:** HIGH

## BR-OPS-002 — Notifications after commit

**Категория:** Operations  
**Формулировка:** Push/email отправляются только после durable business state; повтор события дедуплицируется.  
**Статус:** `REQUIRED`  
**Владелец:** Backend Lead  
**Источник/основание:** Fable methodology  
**Критичность:** HIGH

## BR-OPS-003 — Deep-link authorization

**Категория:** Operations  
**Формулировка:** Уведомление содержит deep link, но экран повторно проверяет session, role и ownership.  
**Статус:** `REQUIRED`  
**Владелец:** Security Owner  
**Источник/основание:** Fable methodology  
**Критичность:** HIGH

## BR-OPS-004 — No fake success

**Категория:** Operations  
**Формулировка:** Timeout/unknown response не показывает success и не создаёт выдуманный ID; UI предлагает проверить состояние.  
**Статус:** `REQUIRED`  
**Владелец:** Frontend Lead  
**Источник/основание:** Fable methodology  
**Критичность:** HIGH

## BR-OPS-005 — Analytics minimization

**Категория:** Operations  
**Формулировка:** Analytics не содержит телефон, имя специалиста, текст сообщения/отзыва, карту или complaint description.  
**Статус:** `IMPLEMENTED_OR_REQUIRED`  
**Владелец:** Privacy Owner  
**Источник/основание:** Current client README  
**Критичность:** HIGH

## BR-UX-001 — All states

**Категория:** UX  
**Формулировка:** Каждый data screen имеет loading, empty, error, offline/reconnect, forbidden и success/partial states по применимости.  
**Статус:** `REQUIRED`  
**Владелец:** Frontend Lead  
**Источник/основание:** Master prompt  
**Критичность:** HIGH

## BR-UX-002 — No dead actions

**Категория:** UX  
**Формулировка:** Кнопка либо приводит к проверяемому результату, либо отсутствует/помечена «скоро» только вне critical flow.  
**Статус:** `REQUIRED`  
**Владелец:** Product Owner  
**Источник/основание:** Master prompt  
**Критичность:** HIGH

## BR-UX-003 — Visual canon

**Категория:** UX  
**Формулировка:** Цвета, радиусы, типографика и композиция берутся из prototype tokens; arbitrary hex запрещён вне token layer.  
**Статус:** `REQUIRED`  
**Владелец:** Design Lead  
**Источник/основание:** PD-020  
**Критичность:** HIGH

## BR-UX-004 — Accessibility

**Категория:** UX  
**Формулировка:** Touch target ≥44px, keyboard/focus для web, contrast, screen-reader labels, reduced motion.  
**Статус:** `REQUIRED`  
**Владелец:** Frontend Lead  
**Источник/основание:** Accessibility baseline  
**Критичность:** HIGH

## BR-UX-005 — Visual change log

**Категория:** UX  
**Формулировка:** Осознанное отличие от prototype v2 имеет запись: screen, before, after, reason, approver.  
**Статус:** `REQUIRED`  
**Владелец:** Design Lead  
**Источник/основание:** Fable governance  
**Критичность:** HIGH
