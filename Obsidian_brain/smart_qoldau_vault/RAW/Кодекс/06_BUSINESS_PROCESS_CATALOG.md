# 06. Каталог бизнес-процессов

| ID | Процесс | Owner | Trigger | SLA/SLO |
| --- | --- | --- | --- | --- |
| BP-001 | Публичное знакомство и переход в продукт | Product/Growth | Посетитель открывает public web | Страница LCP ≤2.5s p75; переход без тупика |
| BP-002 | Регистрация клиента и гостевой вход | Identity | Пользователь выбирает способ входа | OTP ≤60s при доступности провайдера |
| BP-003 | Кризисный screening и перенаправление | Safety | SOS/«нужна помощь сейчас» | Немедленно, без ожидания matching |
| BP-004 | Выбор темы и формата | Product | Начат подбор | ≤90 секунд до создания запроса |
| BP-005 | Мгновенный matching | Marketplace | Создан instant request | Метрика p50/p90; не маркетинговая гарантия |
| BP-006 | Каталог и направленная запись | Marketplace | Клиент выбирает специалиста | Слоты актуальны на момент подтверждения |
| BP-007 | Подготовка оплаты и coverage | Finance | Подтверждение платной записи | Ответ провайдера по договору |
| BP-008 | Оффер специалисту | Marketplace | Matching выбрал кандидата | Deadline оффера конфигурируем |
| BP-009 | Консультация в чате | Consultation | Началась ACTIVE консультация | Realtime delivery + resync |
| BP-010 | Аудио/видеоконсультация | Consultation | Формат audio/video или escalation | Join/reconnect SLO определяется после нагрузочного теста |
| BP-011 | Завершение, no-show и technical issue | Quality/Finance | End action/timer/incident | Outcome фиксируется сразу; спор — по SLA жалоб |
| BP-012 | Оценка, отзыв и избранное | Quality | COMPLETED consultation | Модерация flagged content ≤24h |
| BP-013 | Жалоба и спор | Quality | Жалоба в разрешённое окно или safety report | Acknowledgement ≤4h; решение целевое ≤3 рабочих дней |
| BP-014 | Верификация специалиста | Verification | Кандидат submit application | Решение ≤24h целевое |
| BP-015 | Публичный профиль специалиста | Verification/Marketplace | Эксперт меняет photo/about | Модерация изменений ≤24h |
| BP-016 | Расписание и доступность специалиста | Marketplace | Изменение weekly schedule/exception/status | Изменение применяется до следующего matching |
| BP-017 | Доход и выплата специалисту | Finance | Settled consultation / payout request | По утверждённому payout calendar |
| BP-018 | Premium subscription | Commercial/Finance | Subscribe/renew/cancel | Entitlement после подтверждённой оплаты |
| BP-019 | Жизненный цикл контента | Content/Safety | Создание/изменение content item | Review зависит от типа, фиксируется в очереди |
| BP-020 | Поддержка и тикеты | Support | Создан тикет | P1 safety немедленно; P2 ≤4h; P3 ≤1 рабочий день |
| BP-021 | Admin access и RBAC | Security | Admin login/action | Immediate enforcement |
| BP-022 | B2B lead-to-contract | B2B Sales | Форма для бизнеса | Lead acknowledgement ≤1 рабочий день |
| BP-023 | B2B entitlement и отчётность | B2B Operations | Activation/booking/report period | Usage near real time, report monthly |
| BP-024 | B2G onboarding практиканта | B2G Operations | Студент вводит B2G code | По договору, целевое ≤3 рабочих дней |
| BP-025 | Супервизия и учёт часов | B2G Operations | Completed intern session | Review case/часов ≤5 рабочих дней |
| BP-026 | Инцидент и коммуникация | Operations/Security | Platform/security/provider incident | По severity matrix |
| BP-027 | Удаление/экспорт данных | Privacy | Data subject request | По применимому праву и внутренней политике |
| BP-028 | Release acceptance frontend | Frontend/QA | Release candidate | До каждого production release |

---

## BP-001 — Публичное знакомство и переход в продукт

**Владелец:** Product/Growth  
**Акторы:** PUBLIC_VISITOR, SYSTEM_ACTOR  
**Триггер:** Посетитель открывает public web  
**SLA/SLO:** Страница LCP ≤2.5s p75; переход без тупика  
**Связанные use cases:** UC-PUB-001, UC-PUB-002, UC-PUB-003, UC-PUB-004, UC-PUB-005, UC-PUB-006, UC-PUB-007, UC-PUB-008

### Основной поток
1. Показать ясное ценностное предложение и границы сервиса
2. Предложить каталог, темы или безопасный вход
3. Сохранить locale/cookie consent
4. Передать deep link в client surface или продолжить в web

### Исключения
- API каталога недоступен — показать честное пустое/ошибочное состояние
- Неизвестный deep link — главная без потери locale

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-002 — Регистрация клиента и гостевой вход

**Владелец:** Identity  
**Акторы:** GUEST_CLIENT, REGISTERED_CLIENT, SYSTEM_ACTOR  
**Триггер:** Пользователь выбирает способ входа  
**SLA/SLO:** OTP ≤60s при доступности провайдера  
**Связанные use cases:** UC-ID-001, UC-ID-002, UC-ID-003, UC-ID-004, UC-ID-005, UC-ID-006, UC-ID-007, UC-ID-008

### Основной поток
1. Показать различия гостя и аккаунта
2. Получить consent/age acknowledgement
3. Создать guest identity или OTP challenge
4. Выдать session и провести onboarding
5. Сохранить locale/permissions choice

### Исключения
- SMS rate limit
- Неверный/просроченный код
- Guest conversion conflict

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-003 — Кризисный screening и перенаправление

**Владелец:** Safety  
**Акторы:** GUEST_CLIENT, REGISTERED_CLIENT, SYSTEM_ACTOR  
**Триггер:** SOS/«нужна помощь сейчас»  
**SLA/SLO:** Немедленно, без ожидания matching  
**Связанные use cases:** UC-SAFE-001, UC-SAFE-002, UC-SAFE-003, UC-SAFE-004

### Основной поток
1. Задать минимальный safety question
2. При непосредственной угрозе показать 102/103/hotlines
3. При отсутствии угрозы предложить urgent matching и self-help
4. Зафиксировать только минимальный safety event без чувствительного текста

### Исключения
- Нет сети — номера экстренных служб доступны локально
- Пользователь отказывается отвечать — всё равно показать emergency resources

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-004 — Выбор темы и формата

**Владелец:** Product  
**Акторы:** GUEST_CLIENT, REGISTERED_CLIENT  
**Триггер:** Начат подбор  
**SLA/SLO:** ≤90 секунд до создания запроса  
**Связанные use cases:** UC-DISC-001, UC-DISC-002, UC-DISC-003, UC-DISC-004, UC-DISC-005

### Основной поток
1. Загрузить серверный справочник тем
2. Выбрать одну тему и формат
3. Показать цену/coverage и ограничения
4. Подтвердить запрос

### Исключения
- Тема/формат деактивированы
- Практикант недоступен для тяжёлой темы

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-005 — Мгновенный matching

**Владелец:** Marketplace  
**Акторы:** REGISTERED_CLIENT, VERIFIED_EXPERT, SYSTEM_ACTOR  
**Триггер:** Создан instant request  
**SLA/SLO:** Метрика p50/p90; не маркетинговая гарантия  
**Связанные use cases:** UC-DISC-006, UC-DISC-007, UC-DISC-008, UC-DISC-009

### Основной поток
1. Проверить eligibility/coverage/payment readiness
2. Скорить кандидатов
3. Отправлять офферы с deadline
4. Первый атомарный accept создаёт консультацию
5. Отозвать остальные офферы и уведомить клиента

### Исключения
- Нет экспертов — изменить формат/время/callback
- Timeout — следующий кандидат
- Гонка accept — один победитель

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-006 — Каталог и направленная запись

**Владелец:** Marketplace  
**Акторы:** REGISTERED_CLIENT, VERIFIED_EXPERT  
**Триггер:** Клиент выбирает специалиста  
**SLA/SLO:** Слоты актуальны на момент подтверждения  
**Связанные use cases:** UC-BOOK-001, UC-BOOK-002, UC-BOOK-003

### Основной поток
1. Фильтровать публичных специалистов
2. Открыть профиль
3. Выбрать формат/тему/слот
4. Проверить слот повторно
5. Зафиксировать цену и запись

### Исключения
- Слот занят параллельно
- Специалист стал недоступен
- Coverage не покрывает цену

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-007 — Подготовка оплаты и coverage

**Владелец:** Finance  
**Акторы:** REGISTERED_CLIENT, CORPORATE_BENEFICIARY, SYSTEM_ACTOR  
**Триггер:** Подтверждение платной записи  
**SLA/SLO:** Ответ провайдера по договору  
**Связанные use cases:** UC-PAY-001, UC-PAY-002, UC-PAY-003, UC-PAY-004, UC-PAY-005, UC-PAY-006, UC-PAY-007, UC-PAY-008

### Основной поток
1. Рассчитать price snapshot/скидку/coverage
2. Показать итог до действия
3. Создать idempotent payment intent/hold или reserve pool
4. Подтвердить запись только при успешном результате
5. Выдать чек/статус

### Исключения
- Payment failed
- Webhook delayed
- Corporate pool exhausted
- Double click

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-008 — Оффер специалисту

**Владелец:** Marketplace  
**Акторы:** VERIFIED_EXPERT, INTERN_EXPERT, SYSTEM_ACTOR  
**Триггер:** Matching выбрал кандидата  
**SLA/SLO:** Deadline оффера конфигурируем  
**Связанные use cases:** UC-EXP-011, UC-EXP-012, UC-EXP-013

### Основной поток
1. Показать безопасные данные заявки
2. Запустить таймер
3. Accept/decline одним действием
4. Сервер повторно валидирует eligibility
5. Обновить клиента и очереди

### Исключения
- Оффер истёк
- Другой эксперт уже принял
- Эксперт потерял сеть

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-009 — Консультация в чате

**Владелец:** Consultation  
**Акторы:** REGISTERED_CLIENT, VERIFIED_EXPERT  
**Триггер:** Началась ACTIVE консультация  
**SLA/SLO:** Realtime delivery + resync  
**Связанные use cases:** UC-SES-001, UC-SES-002, UC-SES-011, UC-SES-012, UC-EXP-014

### Основной поток
1. Проверить участников
2. Открыть session state
3. Обмениваться сообщениями без PII analytics
4. Обрабатывать reconnect/resync
5. Завершить с outcome

### Исключения
- Неавторизованный direct URL
- Duplicate message
- Connection loss
- Report issue

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-010 — Аудио/видеоконсультация

**Владелец:** Consultation  
**Акторы:** REGISTERED_CLIENT, VERIFIED_EXPERT, SYSTEM_ACTOR  
**Триггер:** Формат audio/video или escalation  
**SLA/SLO:** Join/reconnect SLO определяется после нагрузочного теста  
**Связанные use cases:** UC-SES-003, UC-SES-004, UC-SES-005, UC-SES-006

### Основной поток
1. Получить короткоживущий media token
2. Запросить permissions
3. Войти в комнату
4. Обработать join/leave webhook
5. Показать reconnect и fallback в chat
6. Завершить с outcome

### Исключения
- Permission denied
- Media server unavailable
- Один участник не вошёл
- Webhook delayed

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-011 — Завершение, no-show и technical issue

**Владелец:** Quality/Finance  
**Акторы:** REGISTERED_CLIENT, VERIFIED_EXPERT, QUALITY_TEAM, SYSTEM_ACTOR  
**Триггер:** End action/timer/incident  
**SLA/SLO:** Outcome фиксируется сразу; спор — по SLA жалоб  
**Связанные use cases:** UC-SES-007, UC-SES-008, UC-SES-009, UC-SES-010

### Основной поток
1. Определить допустимый outcome
2. Сохранить один canonical outcome
3. Рассчитать settlement
4. Создать уведомления после commit
5. Открыть окно оценки/жалобы

### Исключения
- Обе стороны спорят о no-show
- Platform incident
- Повторный complete

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-012 — Оценка, отзыв и избранное

**Владелец:** Quality  
**Акторы:** REGISTERED_CLIENT, VERIFIED_EXPERT, QUALITY_TEAM  
**Триггер:** COMPLETED consultation  
**SLA/SLO:** Модерация flagged content ≤24h  
**Связанные use cases:** UC-POST-001, UC-POST-002, UC-POST-003, UC-POST-006, UC-EXP-016

### Основной поток
1. Собрать rating и необязательные тексты
2. Разделить public/private feedback
3. Провести автоматические/ручные проверки
4. Опубликовать допустимую часть
5. Обновить rating агрегат и favorite

### Исключения
- PII/оскорбление
- Повторный отзыв
- Expert reply/complaint

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-013 — Жалоба и спор

**Владелец:** Quality  
**Акторы:** REGISTERED_CLIENT, VERIFIED_EXPERT, QUALITY_TEAM, FINANCE_CONTROL  
**Триггер:** Жалоба в разрешённое окно или safety report  
**SLA/SLO:** Acknowledgement ≤4h; решение целевое ≤3 рабочих дней  
**Связанные use cases:** UC-POST-004, UC-POST-005, UC-ADM-005, UC-ADM-006, UC-ADM-010, UC-ADM-011

### Основной поток
1. Классифицировать reason/severity
2. Собрать минимальные evidence
3. Запросить ответ другой стороны
4. Quality фиксирует решение
5. Finance исполняет refund/adjustment
6. Уведомить стороны и закрыть

### Исключения
- Safety escalation
- Недостаточно evidence
- Appeal
- Просроченное обычное обращение

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-014 — Верификация специалиста

**Владелец:** Verification  
**Акторы:** EXPERT_APPLICANT, VERIFICATION_OPERATOR  
**Триггер:** Кандидат submit application  
**SLA/SLO:** Решение ≤24h целевое  
**Связанные use cases:** UC-EXP-001, UC-EXP-002, UC-EXP-003, UC-EXP-004, UC-EXP-005, UC-ADM-002

### Основной поток
1. Проверить completeness/file signatures
2. Поставить в очередь по submittedAt
3. Оператор проверяет identity/qualification/duplicates
4. Approve/reject/reupload с причиной
5. Уведомить кандидата

### Исключения
- Duplicate IIN
- Документ повреждён
- SLA overdue
- Конкурентное решение двух операторов

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-015 — Публичный профиль специалиста

**Владелец:** Verification/Marketplace  
**Акторы:** VERIFIED_EXPERT, VERIFICATION_OPERATOR  
**Триггер:** Эксперт меняет photo/about  
**SLA/SLO:** Модерация изменений ≤24h  
**Связанные use cases:** UC-EXP-006, UC-ADM-003

### Основной поток
1. Сохранить pending version
2. Проверить изображение/текст
3. Оператор approve/reject
4. До решения показывать старую версию
5. После approve обновить каталог

### Исключения
- Unsafe/PII content
- Image invalid
- Повторное изменение во время review

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-016 — Расписание и доступность специалиста

**Владелец:** Marketplace  
**Акторы:** VERIFIED_EXPERT, SYSTEM_ACTOR  
**Триггер:** Изменение weekly schedule/exception/status  
**SLA/SLO:** Изменение применяется до следующего matching  
**Связанные use cases:** UC-EXP-008, UC-EXP-009, UC-EXP-010

### Основной поток
1. Редактировать weekly schedule
2. Добавить исключения
3. Проверить пересечения с консультациями
4. Обновить work status/presence
5. Пересчитать eligibility

### Исключения
- Конфликт с подтверждённой записью
- Heartbeat lost
- Timezone boundary

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-017 — Доход и выплата специалисту

**Владелец:** Finance  
**Акторы:** VERIFIED_EXPERT, FINANCE_CONTROL, SYSTEM_ACTOR  
**Триггер:** Settled consultation / payout request  
**SLA/SLO:** По утверждённому payout calendar  
**Связанные use cases:** UC-EXP-015, UC-ADM-007, UC-ADM-008

### Основной поток
1. Рассчитать gross/commission/net
2. Выдержать dispute/clearing window
3. Создать payout request
4. Проверить реквизиты/risk
5. Отправить провайдеру и сверить
6. Показать историю

### Исключения
- Rejected payout
- Provider timeout
- Manual hold
- Refund after settlement

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-018 — Premium subscription

**Владелец:** Commercial/Finance  
**Акторы:** REGISTERED_CLIENT, PREMIUM_CLIENT, SYSTEM_ACTOR  
**Триггер:** Subscribe/renew/cancel  
**SLA/SLO:** Entitlement после подтверждённой оплаты  
**Связанные use cases:** UC-PREM-001, UC-PREM-002, UC-PREM-003, UC-EXP-007

### Основной поток
1. Показать канонические планы/benefits
2. Создать recurring/one-time payment согласно провайдеру
3. Активировать entitlement после подтверждения
4. Управлять renewal/cancel
5. Уведомлять о failed renewal/expiry

### Исключения
- Price mismatch client/server
- Failed renewal
- Refund/chargeback

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-019 — Жизненный цикл контента

**Владелец:** Content/Safety  
**Акторы:** CONTENT_MANAGER, QUALITY_TEAM, SYSTEM_ACTOR  
**Триггер:** Создание/изменение content item  
**SLA/SLO:** Review зависит от типа, фиксируется в очереди  
**Связанные use cases:** UC-CONT-001, UC-CONT-002, UC-CONT-003, UC-CONT-004, UC-CONT-005, UC-ADM-013

### Основной поток
1. Создать draft RU/KK
2. Провести editorial и safety review
3. Загрузить private media
4. Publish по locale
5. Собирать engagement без sensitive data
6. Archive без ломки истории

### Исключения
- Нет перевода
- Premium media leakage
- Clinical claim rejected

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-020 — Поддержка и тикеты

**Владелец:** Support  
**Акторы:** REGISTERED_CLIENT, VERIFIED_EXPERT, SUPPORT_OPERATOR  
**Триггер:** Создан тикет  
**SLA/SLO:** P1 safety немедленно; P2 ≤4h; P3 ≤1 рабочий день  
**Связанные use cases:** UC-ADM-004

### Основной поток
1. Выбрать категорию и related entity
2. Скрыть лишние чувствительные данные
3. Маршрутизировать по приоритету
4. Ответить/эскалировать
5. Закрыть с resolution code

### Исключения
- Safety issue routed to Quality
- Financial issue routed to Finance
- Duplicate tickets

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-021 — Admin access и RBAC

**Владелец:** Security  
**Акторы:** SUPERADMIN, VERIFICATION_OPERATOR, SUPPORT_OPERATOR, QUALITY_TEAM, FINANCE_CONTROL  
**Триггер:** Admin login/action  
**SLA/SLO:** Immediate enforcement  
**Связанные use cases:** UC-ADM-001, UC-ADM-009, UC-ADM-012, UC-ADM-014

### Основной поток
1. Пароль + 2FA policy
2. Выдать short session
3. Показать role-aware navigation
4. Проверить роль сервером
5. Записать audit после commit

### Исключения
- Lost 2FA recovery
- Last superadmin protection
- Forbidden direct URL

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-022 — B2B lead-to-contract

**Владелец:** B2B Sales  
**Акторы:** PUBLIC_VISITOR, B2B_MANAGER, ORGANIZATION_REP  
**Триггер:** Форма для бизнеса  
**SLA/SLO:** Lead acknowledgement ≤1 рабочий день  
**Связанные use cases:** UC-B2B-001, UC-B2B-002

### Основной поток
1. Принять и квалифицировать lead
2. Согласовать pool/price/privacy
3. Юридически оформить договор
4. Создать contract/code/invites
5. Передать account management

### Исключения
- Duplicate company
- Custom terms
- Rejected compliance

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-023 — B2B entitlement и отчётность

**Владелец:** B2B Operations  
**Акторы:** CORPORATE_BENEFICIARY, ORGANIZATION_REP, B2B_MANAGER  
**Триггер:** Activation/booking/report period  
**SLA/SLO:** Usage near real time, report monthly  
**Связанные use cases:** UC-B2B-003, UC-B2B-004, UC-B2B-005, UC-B2B-006

### Основной поток
1. Активировать entitlement
2. Показать coverage клиенту
3. Reserve/consume pool
4. Агрегировать без re-identification
5. Сформировать отчёт/renewal forecast

### Исключения
- Pool exhausted
- Contract expired
- Small cohort privacy suppression

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-024 — B2G onboarding практиканта

**Владелец:** B2G Operations  
**Акторы:** INTERN_EXPERT, B2G_COORDINATOR, VERIFICATION_OPERATOR, SUPERVISOR  
**Триггер:** Студент вводит B2G code  
**SLA/SLO:** По договору, целевое ≤3 рабочих дней  
**Связанные use cases:** UC-B2G-001, UC-B2G-002, UC-B2G-003

### Основной поток
1. Проверить contract/code
2. Собрать учебные документы
3. Верифицировать статус
4. Назначить supervisor
5. Активировать topic restrictions

### Исключения
- Нет supervisor capacity
- Contract expired
- Документы не подтверждены

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-025 — Супервизия и учёт часов

**Владелец:** B2G Operations  
**Акторы:** INTERN_EXPERT, SUPERVISOR, B2G_COORDINATOR  
**Триггер:** Completed intern session  
**SLA/SLO:** Review case/часов ≤5 рабочих дней  
**Связанные use cases:** UC-B2G-004, UC-B2G-005, UC-B2G-006, UC-B2G-007, UC-B2G-008, UC-B2G-009

### Основной поток
1. Создать de-identified summary
2. Супервайзер даёт feedback
3. Подтверждает/возвращает часы
4. Координатор видит агрегат
5. Эскалировать safety/quality issue

### Исключения
- Sensitive detail accidentally included
- Supervisor unavailable
- Disputed hours

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-026 — Инцидент и коммуникация

**Владелец:** Operations/Security  
**Акторы:** SUPERADMIN, SUPPORT_OPERATOR, SYSTEM_ACTOR  
**Триггер:** Platform/security/provider incident  
**SLA/SLO:** По severity matrix  
**Связанные use cases:** UC-ADM-015

### Основной поток
1. Классифицировать severity
2. Остановить опасное действие/feature flag
3. Сообщить затронутым без лишних данных
4. Восстановить и сверить state
5. Провести postmortem и corrective actions

### Исключения
- Payment inconsistency
- Message/media outage
- Data exposure suspicion

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-027 — Удаление/экспорт данных

**Владелец:** Privacy  
**Акторы:** REGISTERED_CLIENT, SUPERADMIN, SYSTEM_ACTOR  
**Триггер:** Data subject request  
**SLA/SLO:** По применимому праву и внутренней политике  
**Связанные use cases:** нет прямой привязки; process-level governance

### Основной поток
1. Подтвердить личность
2. Определить scope и retention exceptions
3. Сформировать export или выполнить staged deletion/anonymization
4. Записать audit без содержания
5. Уведомить пользователя

### Исключения
- Открытый финансовый спор
- Legal hold
- Невозможно подтвердить личность

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
## BP-028 — Release acceptance frontend

**Владелец:** Frontend/QA  
**Акторы:** SYSTEM_ACTOR, SUPERADMIN  
**Триггер:** Release candidate  
**SLA/SLO:** До каждого production release  
**Связанные use cases:** нет прямой привязки; process-level governance

### Основной поток
1. Сверить screen registry и approved decisions
2. Прогнать role-by-role click map
3. Выполнить functional/visual/a11y tests
4. Проверить mobile devices and browsers
5. Собрать evidence
6. GO/NO-GO decision

### Исключения
- Нет visual baseline
- Device flow не проверен
- P0/P1 defect

### Контрольные доказательства
- state transition и actor зафиксированы;
- success появляется только после commit;
- owner очереди и escalation известны;
- UI имеет loading/error/partial/offline state;
- audit не содержит лишний sensitive payload;
- процесс можно воспроизвести через role-by-role click map.
