# 15. Спецификации экранов

Этот документ делает prototype исполнимым: каждый экран имеет цель, route, release, состояние текущей реализации и acceptance. Prototype buttons/inputs перечислены как evidence, но не становятся автоматическим product requirement.

## SCR-001 — Client Mobile / ER-схема

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - ER-схема.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `reference-only` |
| Release | `REFERENCE` |
| Current status | `REFERENCE_ONLY` |
| Use cases | reference / уточнить в R0 |

**Цель:** Реализовать назначение экрана «ER-схема» для поверхности Client Mobile по связанным use cases.

**Рекомендуемое действие:** Не реализовывать как runtime-экран; использовать как evidence.

### Действия из прототипа
- Определяется связанными use cases; demo-only CTA не переносится автоматически.

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- Нет прямых prototype targets или это reference-only artifact.

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-002 — Deck/Overview / Investor Deck

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Investor Deck.dc.html` |
| Viewport hint | `100%,100%` |
| Canonical route | `reference-only` |
| Release | `REFERENCE` |
| Current status | `REFERENCE_ONLY` |
| Use cases | reference / уточнить в R0 |

**Цель:** Реализовать назначение экрана «Investor Deck» для поверхности Deck/Overview по связанным use cases.

**Рекомендуемое действие:** Не реализовывать как runtime-экран; использовать как evidence.

### Действия из прототипа
- Определяется связанными use cases; demo-only CTA не переносится автоматически.

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- Нет прямых prototype targets или это reference-only artifact.

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-003 — Client Mobile / Premium

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Premium.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/premium` |
| Release | `R3` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-PREM-001, UC-PREM-002, UC-PREM-003 |

**Цель:** Показать канонические планы и приобрести/управлять подпиской.

**Рекомендуемое действие:** Не переписывать; провести visual/state audit по prototype v2.

### Действия из прототипа
- Оформить подписку

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau - Профиль.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-004 — Client Mobile / Анализ

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Анализ.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/analysis` |
| Release | `R6` |
| Current status | `DEFERRED_RESEARCH` |
| Use cases | reference / уточнить в R0 |

**Цель:** Экспериментальный wearable insight; не релизный MVP.

**Рекомендуемое действие:** Не переносить в релиз до privacy/clinical discovery.

### Действия из прототипа
- Подышать
- Поговорить

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau - Главная.dc.html
- ./SmartQoldau - Дыхательное упражнение.dc.html
- ./SmartQoldau - Выбор темы.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-005 — Client Mobile / Аудиозвонок

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Аудиозвонок.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/call/:id?format=audio` |
| Release | `R2` |
| Current status | `IMPLEMENTED_HEADLESS_DEVICE_NOT_VERIFIED` |
| Use cases | UC-SAFE-004, UC-SES-003, UC-SES-005, UC-SES-006, UC-SES-010 |

**Цель:** Провести аудиосессию с controls/reconnect/fallback.

**Рекомендуемое действие:** Сохранить код; обязательна device acceptance.

### Действия из прототипа
- 🤍 Мне трудно говорить

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau - Чат.dc.html
- ./SmartQoldau - Видеозвонок.dc.html
- ./SmartQoldau - Оценка.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-006 — Client Mobile / Видеозвонок

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Видеозвонок.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/call/:id?format=video` |
| Release | `R2` |
| Current status | `IMPLEMENTED_HEADLESS_DEVICE_NOT_VERIFIED` |
| Use cases | UC-SAFE-004, UC-SES-004, UC-SES-005, UC-SES-006, UC-SES-010 |

**Цель:** Провести видеосессию с controls/reconnect/fallback.

**Рекомендуемое действие:** Сохранить код; обязательна device acceptance.

### Действия из прототипа
- Переподключиться
- Завершить звонок

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau - Оценка.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-007 — Client Mobile / Выбор темы

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Выбор темы.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/topic` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-PUB-004, UC-DISC-001, UC-DISC-002, UC-DISC-006 |

**Цель:** Выбрать потребность и формат для подбора.

**Рекомендуемое действие:** Не переписывать; провести visual/state audit по prototype v2.

### Действия из прототипа
- Продолжить

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau - Поиск специалиста.dc.html?format=
- ./SmartQoldau - Главная.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-008 — Client Mobile / Главная

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Главная.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/home` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-SAFE-001, UC-POST-006 |

**Цель:** Дать роли главный следующий шаг и статус незавершённых процессов.

**Рекомендуемое действие:** Не переписывать; провести visual/state audit по prototype v2.

### Действия из прототипа
- Мне нужна помощь сейчас Среднее время подключения — до 2 минут
- 102 · Полиция
- 103 · Скорая
- Нет, но нужна поддержка сейчас

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- tel:102
- tel:103
- ./SmartQoldau - Каталог.dc.html?topic=
- ./SmartQoldau - Уведомления.dc.html
- ./SmartQoldau - Premium.dc.html
- ./SmartQoldau - Экстренный поиск.dc.html?format=audio
- ./SmartQoldau - Выбор темы.dc.html
- ./SmartQoldau - Каталог.dc.html?new=1
- ./SmartQoldau - Выбор темы.dc.html?format=chat
- ./SmartQoldau - Выбор темы.dc.html?format=audio
- ./SmartQoldau - Выбор темы.dc.html?format=video
- ./SmartQoldau - Выбор темы.dc.html
- ./SmartQoldau - Анализ.dc.html
- ./SmartQoldau - Дыхательное упражнение.dc.html
- ./SmartQoldau - Расслабляющая музыка.dc.html
- ./SmartQoldau - Полезные статьи.dc.html
- ./SmartQoldau - Медитации.dc.html
- ./SmartQoldau - Консультации.dc.html
- ./SmartQoldau - Избранное.dc.html
- ./SmartQoldau - Материалы.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-009 — Client Mobile / Добавить карту

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Добавить карту.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/cards/add` |
| Release | `R2` |
| Current status | `PARTIAL_OR_NEEDS_CONTRACT_CHECK` |
| Use cases | UC-PAY-001 |

**Цель:** Реализовать назначение экрана «Добавить карту» для поверхности Client Mobile по связанным use cases.

**Рекомендуемое действие:** Сверить реальный API и довести states/visual parity.

### Действия из прототипа
- Привязать карту
- Попробовать снова

### Поля из прототипа
- 0000 0000 0000 0000
- ММ/ГГ
- 123
- IVAN IVANOV

### Prototype transitions
- ./SmartQoldau - Способы оплаты.dc.html
- ./SmartQoldau - Способы оплаты.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-010 — Client Mobile / Добро пожаловать

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Добро пожаловать.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/welcome` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-ID-001 |

**Цель:** Объяснить ценность, конфиденциальность и варианты входа.

**Рекомендуемое действие:** Не переписывать; провести visual/state audit по prototype v2.

### Действия из прототипа
- Продолжить с номером телефона
- Продолжить анонимно

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau - Регистрация.dc.html
- ./SmartQoldau - Главная.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-011 — Client Mobile / Дыхательное упражнение

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Дыхательное упражнение.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/materials/:id (kind=BREATHING)` |
| Release | `R3` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-CONT-004 |

**Цель:** Реализовать назначение экрана «Дыхательное упражнение» для поверхности Client Mobile по связанным use cases.

**Рекомендуемое действие:** Не переписывать; провести visual/state audit по prototype v2.

### Действия из прототипа
- Начать
- Отмена
- Завершить
- Готово

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau - Выбор темы.dc.html
- ./SmartQoldau - Главная.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-012 — Client Mobile / Избранное

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Избранное.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/catalog/favorites` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-DISC-005, UC-POST-003 |

**Цель:** Реализовать назначение экрана «Избранное» для поверхности Client Mobile по связанным use cases.

**Рекомендуемое действие:** Не переписывать; провести visual/state audit по prototype v2.

### Действия из прототипа
- Записаться снова
- Профиль

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau - Специалист найден.dc.html
- ./SmartQoldau - Профиль психолога.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-013 — Client Mobile / Каталог

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Каталог.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/catalog` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-DISC-003, UC-B2G-004 |

**Цель:** Просмотреть и отфильтровать публичных специалистов.

**Рекомендуемое действие:** Не переписывать; провести visual/state audit по prototype v2.

### Действия из прототипа
- Записаться
- Профиль

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau - Специалист найден.dc.html?format=audio
- ./SmartQoldau - Профиль психолога.dc.html
- ./SmartQoldau - Главная.dc.html
- ./SmartQoldau - Выбор темы.dc.html?topic=

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-014 — Client Mobile / Консультации

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Консультации.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/consultations` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-BOOK-003, UC-PAY-004, UC-PAY-005, UC-PAY-007, UC-SES-001, UC-SES-009, UC-SES-011, UC-SES-012 |

**Цель:** Управлять активными, плановыми и завершёнными консультациями.

**Рекомендуемое действие:** Не переписывать; провести visual/state audit по prototype v2.

### Действия из прототипа
- Новая консультация Выберите тему и формат общения
- Присоединиться
- Перенести
- Отменить
- Да, отменить
- Оставить запись

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau - Выбор темы.dc.html
- ./SmartQoldau - Видеозвонок.dc.html
- ./SmartQoldau - Подать жалобу.dc.html?session=
- ./SmartQoldau - Главная.dc.html
- ./SmartQoldau - Избранное.dc.html
- ./SmartQoldau - Материалы.dc.html
- ./SmartQoldau - Профиль.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-015 — Client Mobile / Материалы

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Материалы.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/materials` |
| Release | `R3` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-CONT-001, UC-CONT-002, UC-CONT-005 |

**Цель:** Дать доступ к библиотеке самопомощи.

**Рекомендуемое действие:** Не переписывать; провести visual/state audit по prototype v2.

### Действия из прототипа
- Определяется связанными use cases; demo-only CTA не переносится автоматически.

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau - Дыхательное упражнение.dc.html
- ./SmartQoldau - Расслабляющая музыка.dc.html
- ./SmartQoldau - Полезные статьи.dc.html
- ./SmartQoldau - Медитации.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-016 — Client Mobile / Медитации

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Медитации.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/materials?kind=MEDITATION` |
| Release | `R3` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-CONT-003 |

**Цель:** Реализовать назначение экрана «Медитации» для поверхности Client Mobile по связанным use cases.

**Рекомендуемое действие:** Не переписывать; провести visual/state audit по prototype v2.

### Действия из прототипа
- −15
- +15
- Заново
- Следующая

### Поля из прототипа
- range

### Prototype transitions
- Нет прямых prototype targets или это reference-only artifact.

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-017 — Client Mobile / Мои жалобы

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Мои жалобы.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/complaints` |
| Release | `R2` |
| Current status | `PARTIAL_OR_NEEDS_CONTRACT_CHECK` |
| Use cases | UC-PAY-006, UC-SES-009, UC-POST-005 |

**Цель:** Показать статусы и решения жалоб.

**Рекомендуемое действие:** Сверить реальный API и довести states/visual parity.

### Действия из прототипа
- Определяется связанными use cases; demo-only CTA не переносится автоматически.

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- Нет прямых prototype targets или это reference-only artifact.

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-018 — Client Mobile / Онбординг

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Онбординг.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/onboarding` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-ID-004 |

**Цель:** Собрать минимальные настройки и объяснить правила.

**Рекомендуемое действие:** Не переписывать; провести visual/state audit по prototype v2.

### Действия из прототипа
- {{ nextLabel }}

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau - Добро пожаловать.dc.html
- ./SmartQoldau - Добро пожаловать.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-019 — Client Mobile / Оценка

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Оценка.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/review/:consultationId` |
| Release | `R2` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-POST-001, UC-POST-002, UC-POST-003 |

**Цель:** Собрать post-session rating, public/private feedback.

**Рекомендуемое действие:** Не переписывать; провести visual/state audit по prototype v2.

### Действия из прототипа
- Пропустить
- Завершить
- Продолжить с тем же психологом

### Поля из прототипа
- Ваш отзыв (необязательно)

### Prototype transitions
- ./SmartQoldau - Главная.dc.html
- ./SmartQoldau - Главная.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-020 — Client Mobile / Подать жалобу

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Подать жалобу.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/complaints/new?consultationId=:id` |
| Release | `R2` |
| Current status | `PARTIAL_OR_NEEDS_CONTRACT_CHECK` |
| Use cases | UC-SAFE-004, UC-POST-004 |

**Цель:** Создать complaint с минимальными evidence.

**Рекомендуемое действие:** Сверить реальный API и довести states/visual parity.

### Действия из прототипа
- Отправить жалобу
- Мои жалобы

### Поля из прототипа
- Опишите, что произошло

### Prototype transitions
- ./SmartQoldau - Мои жалобы.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-021 — Client Mobile / Поиск специалиста

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Поиск специалиста.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/search/:requestId` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-PUB-004, UC-SAFE-003, UC-DISC-006, UC-DISC-007, UC-DISC-008, UC-DISC-009 |

**Цель:** Показать authoritative progress matching без ложного SLA.

**Рекомендуемое действие:** Не переписывать; провести visual/state audit по prototype v2.

### Действия из прототипа
- Попробовать снова
- На главную
- Отменить поиск
- Да, отменить
- Продолжить ожидание

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau - Специалист найден.dc.html?format=
- ./SmartQoldau - Главная.dc.html
- ./SmartQoldau - Главная.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-022 — Client Mobile / Полезные статьи

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Полезные статьи.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/materials?kind=ARTICLE` |
| Release | `R3` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-CONT-002 |

**Цель:** Реализовать назначение экрана «Полезные статьи» для поверхности Client Mobile по связанным use cases.

**Рекомендуемое действие:** Не переписывать; провести visual/state audit по prototype v2.

### Действия из прототипа
- Определяется связанными use cases; demo-only CTA не переносится автоматически.

### Поля из прототипа
- Искать по статьям

### Prototype transitions
- Нет прямых prototype targets или это reference-only artifact.

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-023 — Deck/Overview / Презентация

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Презентация.dc.html` |
| Viewport hint | `100%,100%` |
| Canonical route | `reference-only` |
| Release | `REFERENCE` |
| Current status | `REFERENCE_ONLY` |
| Use cases | reference / уточнить в R0 |

**Цель:** Реализовать назначение экрана «Презентация» для поверхности Deck/Overview по связанным use cases.

**Рекомендуемое действие:** Не реализовывать как runtime-экран; использовать как evidence.

### Действия из прототипа
- Определяется связанными use cases; demo-only CTA не переносится автоматически.

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- Нет прямых prototype targets или это reference-only artifact.

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-024 — Prototype Overview / Прототип

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Прототип.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `reference-only` |
| Release | `REFERENCE` |
| Current status | `REFERENCE_ONLY` |
| Use cases | reference / уточнить в R0 |

**Цель:** Реализовать назначение экрана «Прототип» для поверхности Prototype Overview по связанным use cases.

**Рекомендуемое действие:** Не реализовывать как runtime-экран; использовать как evidence.

### Действия из прототипа
- 01 Сплэш
- 02 Добро пожаловать
- 03 Онбординг
- 04 Разрешения
- 05 Регистрация
- 06 Главная
- 07 Выбор темы
- 08 Поиск специалиста
- 09 Экстренный поиск
- 10 Специалист найден
- 11 Профиль психолога
- 12 Каталог

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau - Сплэш.dc.html
- ./SmartQoldau - Добро пожаловать.dc.html
- ./SmartQoldau - Онбординг.dc.html
- ./SmartQoldau - Разрешения.dc.html
- ./SmartQoldau - Регистрация.dc.html
- ./SmartQoldau - Главная.dc.html
- ./SmartQoldau - Выбор темы.dc.html
- ./SmartQoldau - Поиск специалиста.dc.html
- ./SmartQoldau - Экстренный поиск.dc.html
- ./SmartQoldau - Специалист найден.dc.html
- ./SmartQoldau - Профиль психолога.dc.html
- ./SmartQoldau - Каталог.dc.html
- ./SmartQoldau - Чат.dc.html
- ./SmartQoldau - Аудиозвонок.dc.html
- ./SmartQoldau - Видеозвонок.dc.html
- ./SmartQoldau - Оценка.dc.html
- ./SmartQoldau - Консультации.dc.html
- ./SmartQoldau - Материалы.dc.html
- ./SmartQoldau - Полезные статьи.dc.html
- ./SmartQoldau - Медитации.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-025 — Client Mobile / Профиль психолога

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Профиль психолога.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/catalog/expert/:id` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-ID-001, UC-ID-005, UC-ID-006, UC-ID-007, UC-ID-008, UC-DISC-004, UC-DISC-005, UC-BOOK-001, UC-PAY-003, UC-PREM-002, UC-B2B-003, UC-B2B-004, UC-B2G-004 |

**Цель:** Показать проверенный публичный профиль и условия записи.

**Рекомендуемое действие:** Не переписывать; провести visual/state audit по prototype v2.

### Действия из прототипа
- Начать консультацию

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau - Выбор темы.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-026 — Client Mobile / Профиль

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Профиль.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/profile` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-ID-001, UC-ID-005, UC-ID-006, UC-ID-007, UC-ID-008, UC-DISC-004, UC-DISC-005, UC-BOOK-001, UC-PAY-003, UC-POST-006, UC-PREM-002, UC-B2B-003, UC-B2B-004, UC-B2G-004 |

**Цель:** Управлять данными и разрешёнными действиями роли на поверхности Client Mobile.

**Рекомендуемое действие:** Не переписывать; провести visual/state audit по prototype v2.

### Действия из прототипа
- Создать аккаунт или войти
- 102 · Полиция
- 103 · Скорая
- {{ logoutLabel }}
- Выйти
- Остаться
- Удалить навсегда
- Отмена

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- tel:102
- tel:103
- ./SmartQoldau - Регистрация.dc.html
- ./SmartQoldau - Premium.dc.html
- ./SmartQoldau - Регистрация.dc.html
- ./SmartQoldau - Добро пожаловать.dc.html
- ./SmartQoldau - Добро пожаловать.dc.html
- ./SmartQoldau - Способы оплаты.dc.html
- ./SmartQoldau - Мои жалобы.dc.html
- ./SmartQoldau - Главная.dc.html
- ./SmartQoldau - Консультации.dc.html
- ./SmartQoldau - Избранное.dc.html
- ./SmartQoldau - Материалы.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-027 — Client Mobile / Разрешения

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Разрешения.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/permissions` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-ID-004 |

**Цель:** Запросить системные permissions в контексте и без блокировки продукта.

**Рекомендуемое действие:** Не переписывать; провести visual/state audit по prototype v2.

### Действия из прототипа
- Продолжить

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau - Главная.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-028 — Client Mobile / Расслабляющая музыка

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Расслабляющая музыка.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/materials?kind=MUSIC` |
| Release | `R3` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-CONT-003 |

**Цель:** Реализовать назначение экрана «Расслабляющая музыка» для поверхности Client Mobile по связанным use cases.

**Рекомендуемое действие:** Не переписывать; провести visual/state audit по prototype v2.

### Действия из прототипа
- {{ sleepLabel }}

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- Нет прямых prototype targets или это reference-only artifact.

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-029 — Client Mobile / Регистрация

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Регистрация.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/auth/phone` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-ID-002, UC-ID-003, UC-ID-005 |

**Цель:** Создать/восстановить учётную запись через телефон.

**Рекомендуемое действие:** Не переписывать; провести visual/state audit по prototype v2.

### Действия из прототипа
- Получить код
- Продолжить с Google
- Продолжить с Apple
- Подтвердить код
- Понятно, продолжить
- Подтвердить
- Войти
- Отмена

### Поля из прототипа
- 701 123 45 67
- Например, SQ-KMS-2026
- ••••

### Prototype transitions
- ./SmartQoldau - Главная.dc.html
- ./SmartQoldau - Главная.dc.html
- ./SmartQoldau - Добро пожаловать.dc.html
- ./SmartQoldau - Главная.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-030 — Client Mobile / Специалист найден

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Специалист найден.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/found/:requestId` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-DISC-007, UC-BOOK-002, UC-PAY-002 |

**Цель:** Подтвердить match, специалиста, цену и следующий шаг.

**Рекомендуемое действие:** Не переписывать; провести visual/state audit по prototype v2.

### Действия из прототипа
- Начать консультацию
- Продолжить
- Apple Pay
- Kaspi Pay
- Оплатить {{ price }}

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau - Профиль психолога.dc.html
- ./SmartQoldau - Поиск специалиста.dc.html
- ./SmartQoldau - Premium.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-031 — Client Mobile / Сплэш

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Сплэш.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/splash` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-ID-003 |

**Цель:** Реализовать назначение экрана «Сплэш» для поверхности Client Mobile по связанным use cases.

**Рекомендуемое действие:** Не переписывать; провести visual/state audit по prototype v2.

### Действия из прототипа
- Определяется связанными use cases; demo-only CTA не переносится автоматически.

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau - Онбординг.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-032 — Client Mobile / Способы оплаты

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Способы оплаты.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/cards` |
| Release | `R2` |
| Current status | `PARTIAL_OR_NEEDS_CONTRACT_CHECK` |
| Use cases | UC-PAY-001, UC-PAY-002, UC-PAY-003, UC-PAY-007, UC-PAY-008 |

**Цель:** Реализовать назначение экрана «Способы оплаты» для поверхности Client Mobile по связанным use cases.

**Рекомендуемое действие:** Сверить реальный API и довести states/visual parity.

### Действия из прототипа
- + Добавить карту

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau - Профиль.dc.html
- ./SmartQoldau - Добавить карту.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-033 — Client Mobile / Уведомления

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Уведомления.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/notifications` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-PREM-003 |

**Цель:** Показать события с безопасными deep links и read state.

**Рекомендуемое действие:** Не переписывать; провести visual/state audit по prototype v2.

### Действия из прототипа
- Определяется связанными use cases; demo-only CTA не переносится автоматически.

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau - Главная.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-034 — Client Mobile / Чат

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Чат.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/session/:consultationId` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-SAFE-004, UC-SES-002, UC-SES-005, UC-SES-006, UC-SES-007, UC-SES-010 |

**Цель:** Провести текстовую консультацию с reconnect и безопасными states.

**Рекомендуемое действие:** Не переписывать; провести visual/state audit по prototype v2.

### Действия из прототипа
- Определяется связанными use cases; demo-only CTA не переносится автоматически.

### Поля из прототипа
- Напишите сообщение...

### Prototype transitions
- ./SmartQoldau - Главная.dc.html
- ./SmartQoldau - Аудиозвонок.dc.html
- ./SmartQoldau - Видеозвонок.dc.html
- ./SmartQoldau - Оценка.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-035 — Client Mobile / Экстренный поиск

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau - Экстренный поиск.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/sos/search` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-SAFE-001, UC-SAFE-002, UC-SAFE-003 |

**Цель:** Реализовать назначение экрана «Экстренный поиск» для поверхности Client Mobile по связанным use cases.

**Рекомендуемое действие:** Не переписывать; провести visual/state audit по prototype v2.

### Действия из прототипа
- Позвонить 103 / 112
- Отменить поиск
- Да, отменить
- Продолжить ожидание

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau - Специалист найден.dc.html?format=
- ./SmartQoldau - Главная.dc.html
- tel:103

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-036 — Admin Web / B2B

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Admin - B2B.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `/b2b` |
| Release | `R4` |
| Current status | `PROTOTYPE_OR_BACKEND_GAP` |
| Use cases | UC-B2B-001, UC-B2B-002, UC-B2B-005, UC-B2B-006 |

**Цель:** Управлять корпоративными договорами и агрегированной отчётностью.

**Рекомендуемое действие:** Не рисовать fake data; реализовать после API/operating rules.

### Действия из прототипа
- Переключиться на супер-админа (демо)
- + Создать контракт
- ✕
- Продлить контракт
- Приостановить
- Создать
- Отмена
- Готово
- Отправить

### Поля из прототипа
- Название компании
- Контактное лицо
- date
- 200
- 10%
- aliya@company.kz
marat@company.kz

### Prototype transitions
- Нет прямых prototype targets или это reference-only artifact.

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-037 — Admin Web / B2G

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Admin - B2G.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `/b2g` |
| Release | `R5` |
| Current status | `PROTOTYPE_OR_BACKEND_GAP` |
| Use cases | UC-B2G-002, UC-B2G-003, UC-B2G-007, UC-B2G-008, UC-B2G-009 |

**Цель:** Управлять программой практикантов и супервизии.

**Рекомендуемое действие:** Не рисовать fake data; реализовать после API/operating rules.

### Действия из прототипа
- Переключиться на супер-админа (демо)
- + Создать контракт
- ✕
- Продлить контракт
- Приостановить
- Создать
- Отмена
- Готово

### Поля из прототипа
- Название вуза / ведомства
- Контактное лицо
- Должность
- Номер госконтракта / соглашения (опционально)
- date
- 20

### Prototype transitions
- Нет прямых prototype targets или это reference-only artifact.

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-038 — Admin Web / Верификация

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Admin - Верификация.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `/verification` |
| Release | `R2` |
| Current status | `IMPLEMENTED_OR_PARTIAL` |
| Use cases | UC-EXP-004, UC-ADM-002, UC-B2G-002 |

**Цель:** Обработать заявки специалистов по checklist и SLA.

**Рекомендуемое действие:** Сверить route/role/evidence.

### Действия из прототипа
- ✕
- Одобрить
- Отклонить
- Подтвердить отказ
- Назад

### Поля из прототипа
- ФИО супервайзера
- Например: документы нечитаемы, требуется повторная загрузка

### Prototype transitions
- Нет прямых prototype targets или это reference-only artifact.

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-039 — Admin Web / Дашборд

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Admin - Дашборд.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `/dashboard` |
| Release | `R3` |
| Current status | `PROTOTYPE_OR_BACKEND_GAP` |
| Use cases | UC-POST-006, UC-ADM-001, UC-ADM-004, UC-ADM-014, UC-ADM-015 |

**Цель:** Показать operational queues и SLA, а не vanity metrics.

**Рекомендуемое действие:** Не рисовать fake data; реализовать после API/operating rules.

### Действия из прототипа
- Подробнее в разделе «Финансы» →

### Поля из прототипа
- Поиск по платформе...

### Prototype transitions
- ./SmartQoldau Admin - Финансы.dc.html
- ./SmartQoldau Admin - Верификация.dc.html
- ./SmartQoldau Admin - Жалобы.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-040 — Admin Web / Жалобы

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Admin - Жалобы.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `/complaints` |
| Release | `R2` |
| Current status | `IMPLEMENTED_OR_PARTIAL` |
| Use cases | UC-PAY-006, UC-SES-009, UC-EXP-016, UC-ADM-005, UC-ADM-006, UC-ADM-007 |

**Цель:** Рассмотреть complaints/споры по RBAC.

**Рекомендуемое действие:** Сверить route/role/evidence.

### Действия из прототипа
- ✕
- Закрыть жалобу

### Поля из прототипа
- Комментарий к решению (внутренний)

### Prototype transitions
- Нет прямых prototype targets или это reference-only artifact.

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-041 — Admin Web / Клиенты

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Admin - Клиенты.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `/clients` |
| Release | `R3` |
| Current status | `PROTOTYPE_OR_BACKEND_GAP` |
| Use cases | UC-ADM-011 |

**Цель:** Реализовать назначение экрана «Клиенты» для поверхности Admin Web по связанным use cases.

**Рекомендуемое действие:** Не рисовать fake data; реализовать после API/operating rules.

### Действия из прототипа
- ✕
- Заблокировать клиента
- Заблокировать
- Отмена

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- Нет прямых prototype targets или это reference-only artifact.

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-042 — Admin Web / Настройки

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Admin - Настройки.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `/settings` |
| Release | `R3` |
| Current status | `PARTIAL_BACKEND_GAPS` |
| Use cases | UC-ADM-009, UC-ADM-012, UC-ADM-013 |

**Цель:** Реализовать назначение экрана «Настройки» для поверхности Admin Web по связанным use cases.

**Рекомендуемое действие:** Settings shell есть; dictionaries/versioning требуют API.

### Действия из прототипа
- Переключиться на супер-админа (демо)
- Сохранить
- Добавить
- + Добавить материал

### Поля из прототипа
- Новая тема...

### Prototype transitions
- Нет прямых prototype targets или это reference-only artifact.

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-043 — Admin Web / Рассылки

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Admin - Рассылки.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `/broadcasts` |
| Release | `R3` |
| Current status | `PROTOTYPE_OR_BACKEND_GAP` |
| Use cases | UC-ADM-015 |

**Цель:** Реализовать назначение экрана «Рассылки» для поверхности Admin Web по связанным use cases.

**Рекомендуемое действие:** Не рисовать fake data; реализовать после API/operating rules.

### Действия из прототипа
- Отправить сейчас
- Запланировать

### Поля из прототипа
- Например: Новые специалисты со скидкой 15%
- Текст рассылки...

### Prototype transitions
- Нет прямых prototype targets или это reference-only artifact.

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-044 — Admin Web / Специалисты

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Admin - Специалисты.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `/experts` |
| Release | `R2` |
| Current status | `IMPLEMENTED_OR_PARTIAL` |
| Use cases | UC-ADM-003, UC-ADM-010 |

**Цель:** Реализовать назначение экрана «Специалисты» для поверхности Admin Web по связанным use cases.

**Рекомендуемое действие:** Сверить route/role/evidence.

### Действия из прототипа
- ✕
- Заблокировать специалиста
- Заблокировать
- Отмена

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- Нет прямых prototype targets или это reference-only artifact.

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-045 — Admin Web / Финансы

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Admin - Финансы.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `/finance` |
| Release | `R2` |
| Current status | `PARTIAL_PAYOUTS_ONLY` |
| Use cases | UC-PAY-006, UC-ADM-007, UC-ADM-008 |

**Цель:** Сверять выплаты, возвраты и ledger.

**Рекомендуемое действие:** Добавить ledger/refunds/adjustments только после контрактов.

### Действия из прототипа
- Переключиться на супер-админа (демо)
- Экспортировать CSV

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- Нет прямых prototype targets или это reference-only artifact.

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-046 — Expert Mobile / Аудиозвонок (эксперт)

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Аудиозвонок (эксперт).dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/call/:id?format=audio` |
| Release | `R2` |
| Current status | `IMPLEMENTED_HEADLESS_DEVICE_NOT_VERIFIED` |
| Use cases | UC-SES-003, UC-SES-005, UC-SES-006, UC-SES-010 |

**Цель:** Провести аудиосессию со стороны специалиста.

**Рекомендуемое действие:** Провести реальные device tests.

### Действия из прототипа
- Переподключиться
- Завершить звонок

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert - Завершение.dc.html?format=audio

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-047 — Expert Mobile / Верификация

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Верификация.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/verification` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-EXP-004 |

**Цель:** Обработать заявки специалистов по checklist и SLA.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Демо: имитировать одобрение
- Перейти в приложение

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert - Главная.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-048 — Expert Mobile / Видеозвонок (эксперт)

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Видеозвонок (эксперт).dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/call/:id?format=video` |
| Release | `R2` |
| Current status | `IMPLEMENTED_HEADLESS_DEVICE_NOT_VERIFIED` |
| Use cases | UC-SES-004, UC-SES-005, UC-SES-006, UC-SES-010 |

**Цель:** Провести видеосессию со стороны специалиста.

**Рекомендуемое действие:** Провести реальные device tests.

### Действия из прототипа
- Подождать ещё
- Завершить консультацию

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert - Завершение.dc.html?format=video

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-049 — Expert Mobile / Входящий запрос

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Входящий запрос.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/offers/:id` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-EXP-011, UC-EXP-012, UC-EXP-013 |

**Цель:** Реализовать назначение экрана «Входящий запрос» для поверхности Expert Mobile по связанным use cases.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Отклонить
- Принять

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert - Заявки.dc.html
- ./SmartQoldau Expert - Главная.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-050 — Expert Mobile / Выплаты

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Выплаты.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/payouts` |
| Release | `R2` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-EXP-015 |

**Цель:** Показать прозрачные финансовые начисления и действия.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Вывести средства

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- Нет прямых prototype targets или это reference-only artifact.

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-051 — Expert Mobile / Главная

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Главная.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/home` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-EXP-010 |

**Цель:** Дать роли главный следующий шаг и статус незавершённых процессов.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Принять
- Отклонить
- Подготовиться

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert - Входящий запрос.dc.html?emergency=1
- ./SmartQoldau Expert - Уведомления.dc.html
- ./SmartQoldau Expert - Заявка.dc.html?format=video&status=accepted
- ./SmartQoldau Expert - Консультация.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-052 — Expert Mobile / Добро пожаловать

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Добро пожаловать.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/welcome` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-EXP-001 |

**Цель:** Объяснить ценность, конфиденциальность и варианты входа.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Продолжить с номером телефона
- Условия для специалистов
- Политику конфиденциальности

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- #
- #
- ./SmartQoldau Expert - Регистрация.dc.html
- ./SmartQoldau - Добро пожаловать.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-053 — Expert Mobile / Документы

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Документы.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/verification/documents` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-EXP-003, UC-EXP-005 |

**Цель:** Реализовать назначение экрана «Документы» для поверхности Expert Mobile по связанным use cases.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Отправить на проверку
- Продолжить

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert - Верификация.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-054 — Expert Mobile / Доступность

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Доступность.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/availability` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-EXP-010 |

**Цель:** Реализовать назначение экрана «Доступность» для поверхности Expert Mobile по связанным use cases.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Сохранить

### Поля из прототипа
- time

### Prototype transitions
- ./SmartQoldau Expert - Расписание.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-055 — Expert Mobile / Доход

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Доход.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/earnings` |
| Release | `R2` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-EXP-015 |

**Цель:** Показать прозрачные финансовые начисления и действия.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Определяется связанными use cases; demo-only CTA не переносится автоматически.

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert - Выплаты.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-056 — Expert Mobile / Жалоба на вас

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Жалоба на вас.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/complaints/:id` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-SES-008 |

**Цель:** Реализовать назначение экрана «Жалоба на вас» для поверхности Expert Mobile по связанным use cases.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Отправить объяснение

### Поля из прототипа
- Опишите вашу версию произошедшего

### Prototype transitions
- Нет прямых prototype targets или это reference-only artifact.

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-057 — Expert Mobile / Завершение

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Завершение.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/consultations/:id/complete` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-SES-008 |

**Цель:** Реализовать назначение экрана «Завершение» для поверхности Expert Mobile по связанным use cases.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Добавить заметку
- Готово

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert - Заметки.dc.html
- ./SmartQoldau Expert - Главная.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-058 — Expert Mobile / Заметки

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Заметки.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/consultations/:id/note` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-EXP-014 |

**Цель:** Реализовать назначение экрана «Заметки» для поверхности Expert Mobile по связанным use cases.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Сохранить

### Поля из прототипа
- Добавьте профессиональные заметки по консультации...

### Prototype transitions
- ./SmartQoldau Expert - Главная.dc.html
- ./SmartQoldau Expert - Главная.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-059 — Expert Mobile / Заявка

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Заявка.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/offers/:id/details` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-EXP-011, UC-EXP-012, UC-EXP-013 |

**Цель:** Реализовать назначение экрана «Заявка» для поверхности Expert Mobile по связанным use cases.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Принять консультацию
- Отклонить
- Начать консультацию
- Перейти в расписание

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert - Заявка.dc.html?format=
- ./SmartQoldau Expert - Заявки.dc.html
- ./SmartQoldau Expert - Консультации.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-060 — Expert Mobile / Заявки

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Заявки.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/offers` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-EXP-011 |

**Цель:** Реализовать назначение экрана «Заявки» для поверхности Expert Mobile по связанным use cases.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Принять
- Отклонить

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert - Заявка.dc.html?id=
- ./SmartQoldau Expert - Заявка.dc.html?id=

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-061 — Expert Mobile / Клиент

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Клиент.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/clients/:id` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | reference / уточнить в R0 |

**Цель:** Реализовать назначение экрана «Клиент» для поверхности Expert Mobile по связанным use cases.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Начать консультацию

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- Нет прямых prototype targets или это reference-only artifact.

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-062 — Expert Mobile / Консультации

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Консультации.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/consultations` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-BOOK-003, UC-PAY-004, UC-PAY-005 |

**Цель:** Управлять активными, плановыми и завершёнными консультациями.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Определяется связанными use cases; demo-only CTA не переносится автоматически.

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert - Консультация.dc.html?id=

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-063 — Expert Mobile / Консультация

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Консультация.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/consultations/:id` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-SES-004, UC-EXP-014, UC-B2G-005 |

**Цель:** Реализовать назначение экрана «Консультация» для поверхности Expert Mobile по связанным use cases.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Начать консультацию
- Перенести
- Отменить
- Готово
- Да, отменить
- Оставить запись

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert - Клиент.dc.html?format=
- ./SmartQoldau Expert - Консультации.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-064 — Expert Mobile / Мои жалобы и споры

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Мои жалобы и споры.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/complaints` |
| Release | `R2` |
| Current status | `IMPLEMENTED_OR_PARTIAL` |
| Use cases | UC-EXP-016 |

**Цель:** Реализовать назначение экрана «Мои жалобы и споры» для поверхности Expert Mobile по связанным use cases.

**Рекомендуемое действие:** Сверить backend contract и визуальную полноту.

### Действия из прототипа
- Определяется связанными use cases; demo-only CTA не переносится автоматически.

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert - Жалоба на вас.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-065 — Expert Mobile / Настройки

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Настройки.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/settings` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | reference / уточнить в R0 |

**Цель:** Реализовать назначение экрана «Настройки» для поверхности Expert Mobile по связанным use cases.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Определяется связанными use cases; demo-only CTA не переносится автоматически.

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert - Статус верификации.dc.html
- ./SmartQoldau Expert - Поддержка.dc.html
- ./SmartQoldau Expert - Добро пожаловать.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-066 — Expert Mobile / Онбординг

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Онбординг.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/onboarding` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-EXP-002, UC-B2G-001 |

**Цель:** Собрать минимальные настройки и объяснить правила.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- {{ nextLabel }}

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert - Добро пожаловать.dc.html
- ./SmartQoldau Expert - Добро пожаловать.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-067 — Expert Mobile / Поддержка

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Поддержка.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/support` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-SES-010 |

**Цель:** Создать/отследить support ticket без раскрытия лишних данных.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Связаться с поддержкой

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- Нет прямых prototype targets или это reference-only artifact.

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-068 — Expert Mobile / Профессиональный профиль

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Профессиональный профиль.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/profile/professional` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-EXP-002, UC-EXP-006 |

**Цель:** Реализовать назначение экрана «Профессиональный профиль» для поверхности Expert Mobile по связанным use cases.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Продолжить

### Поля из прототипа
- КазНУ им. Аль-Фараби, психология
- 18500

### Prototype transitions
- ./SmartQoldau Expert - Документы.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-069 — Expert Mobile / Профиль

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Профиль.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/profile` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-EXP-002, UC-EXP-006 |

**Цель:** Управлять данными и разрешёнными действиями роли на поверхности Expert Mobile.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Выйти из аккаунта
- Выйти
- Остаться

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert - Добро пожаловать.dc.html
- ./SmartQoldau Expert - Статус верификации.dc.html
- ./SmartQoldau Expert - Тарифы.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-070 — Expert Mobile / Расписание

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Расписание.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/schedule` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-BOOK-003, UC-EXP-008, UC-EXP-009 |

**Цель:** Управлять слотами, исключениями и timezone.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Определяется связанными use cases; demo-only CTA не переносится автоматически.

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert - Консультация.dc.html
- ./SmartQoldau Expert - Доступность.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-071 — Expert Mobile / Регистрация

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Регистрация.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/auth/phone` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-ID-002, UC-ID-003, UC-EXP-001 |

**Цель:** Создать/восстановить учётную запись через телефон.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Получить код
- Подтвердить

### Поля из прототипа
- 701 123 45 67
- ••••

### Prototype transitions
- ./SmartQoldau Expert - Главная.dc.html
- ./SmartQoldau Expert - Профессиональный профиль.dc.html
- ./SmartQoldau Expert - Добро пожаловать.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-072 — Expert Mobile / Редактирование профиля

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Редактирование профиля.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/profile/edit` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-EXP-006 |

**Цель:** Реализовать назначение экрана «Редактирование профиля» для поверхности Expert Mobile по связанным use cases.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Сохранить изменения

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert - Профиль.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-073 — Expert Mobile / Рейтинг

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Рейтинг.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/reviews` |
| Release | `R2` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-EXP-016 |

**Цель:** Реализовать назначение экрана «Рейтинг» для поверхности Expert Mobile по связанным use cases.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Определяется связанными use cases; demo-only CTA не переносится автоматически.

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- Нет прямых prototype targets или это reference-only artifact.

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-074 — Expert Mobile / Сплэш

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Сплэш.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/splash` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-ID-003 |

**Цель:** Реализовать назначение экрана «Сплэш» для поверхности Expert Mobile по связанным use cases.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Определяется связанными use cases; demo-only CTA не переносится автоматически.

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert - Онбординг.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-075 — Expert Mobile / Статус верификации

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Статус верификации.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/verification/status` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-EXP-004, UC-EXP-005 |

**Цель:** Реализовать назначение экрана «Статус верификации» для поверхности Expert Mobile по связанным use cases.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Определяется связанными use cases; demo-only CTA не переносится автоматически.

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- Нет прямых prototype targets или это reference-only artifact.

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-076 — Expert Mobile / Тарифы

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Тарифы.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/tariffs` |
| Release | `R2` |
| Current status | `IMPLEMENTED_OR_PARTIAL` |
| Use cases | UC-EXP-007 |

**Цель:** Реализовать назначение экрана «Тарифы» для поверхности Expert Mobile по связанным use cases.

**Рекомендуемое действие:** Сверить backend contract и визуальную полноту.

### Действия из прототипа
- Перейти на «{{ p.name }}»

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- Нет прямых prototype targets или это reference-only artifact.

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-077 — Expert Mobile / Уведомления

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Уведомления.dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/notifications` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | reference / уточнить в R0 |

**Цель:** Показать события с безопасными deep links и read state.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Определяется связанными use cases; demo-only CTA не переносится автоматически.

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- Нет прямых prototype targets или это reference-only artifact.

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-078 — Expert Mobile / Чат (эксперт)

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert - Чат (эксперт).dc.html` |
| Viewport hint | `390,844` |
| Canonical route | `/session/:id` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-SES-002, UC-SES-005, UC-SES-006, UC-SES-010, UC-EXP-014, UC-B2G-005 |

**Цель:** Провести текстовую консультацию со стороны специалиста.

**Рекомендуемое действие:** Сохранить; role flow и visual review.

### Действия из прототипа
- Определяется связанными use cases; demo-only CTA не переносится автоматически.

### Поля из прототипа
- Напишите ответ...

### Prototype transitions
- ./SmartQoldau Expert - Главная.dc.html
- ./SmartQoldau Expert - Завершение.dc.html?format=chat

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-079 — Expert Web / Видеоконсультация

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert Web - Видеоконсультация.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `/[locale]/expert/consultations/:id/call` |
| Release | `R2` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-SES-004, UC-EXP-014, UC-B2G-005 |

**Цель:** Реализовать назначение экрана «Видеоконсультация» для поверхности Expert Web по связанным use cases.

**Рекомендуемое действие:** Сверить с mobile ownership, убрать независимую бизнес-логику.

### Действия из прототипа
- Определяется связанными use cases; demo-only CTA не переносится автоматически.

### Поля из прототипа
- Написать в чат...

### Prototype transitions
- ./SmartQoldau Expert Web - Консультации.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-080 — Expert Web / Главная

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert Web - Главная.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `/[locale]/expert` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-EXP-010 |

**Цель:** Дать роли главный следующий шаг и статус незавершённых процессов.

**Рекомендуемое действие:** Сверить с mobile ownership, убрать независимую бизнес-логику.

### Действия из прототипа
- Настроить доступность
- Принять
- Отклонить
- Открыть консультацию

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert Web - Уведомления.dc.html
- ./SmartQoldau Expert Web - Поддержка.dc.html
- ./SmartQoldau Expert Web - Расписание.dc.html
- ./SmartQoldau Expert Web - Консультации.dc.html
- ./SmartQoldau Expert Web - Консультации.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-081 — Expert Web / Доход

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert Web - Доход.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `/[locale]/expert/earnings` |
| Release | `R2` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-EXP-015 |

**Цель:** Показать прозрачные финансовые начисления и действия.

**Рекомендуемое действие:** Сверить с mobile ownership, убрать независимую бизнес-логику.

### Действия из прототипа
- Вывести средства

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert Web - Уведомления.dc.html
- ./SmartQoldau Expert Web - Поддержка.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-082 — Expert Web / Заявки

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert Web - Заявки.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `/[locale]/expert/offers` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-EXP-011 |

**Цель:** Реализовать назначение экрана «Заявки» для поверхности Expert Web по связанным use cases.

**Рекомендуемое действие:** Сверить с mobile ownership, убрать независимую бизнес-логику.

### Действия из прототипа
- Принять
- Отклонить

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert Web - Консультации.dc.html
- ./SmartQoldau Expert Web - Уведомления.dc.html
- ./SmartQoldau Expert Web - Поддержка.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-083 — Expert Web / Клиенты

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert Web - Клиенты.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `/[locale]/expert/clients` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-B2G-006 |

**Цель:** Реализовать назначение экрана «Клиенты» для поверхности Expert Web по связанным use cases.

**Рекомендуемое действие:** Сверить с mobile ownership, убрать независимую бизнес-логику.

### Действия из прототипа
- Открыть

### Поля из прототипа
- Поиск по теме или клиенту

### Prototype transitions
- ./SmartQoldau Expert Web - Уведомления.dc.html
- ./SmartQoldau Expert Web - Поддержка.dc.html
- ./SmartQoldau Expert Web - Чаты.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-084 — Expert Web / Консультации

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert Web - Консультации.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `/[locale]/expert/consultations` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-BOOK-003, UC-PAY-004, UC-PAY-005 |

**Цель:** Управлять активными, плановыми и завершёнными консультациями.

**Рекомендуемое действие:** Сверить с mobile ownership, убрать независимую бизнес-логику.

### Действия из прототипа
- Начать консультацию

### Поля из прототипа
- Поиск по клиенту или теме

### Prototype transitions
- ./SmartQoldau Expert Web - Видеоконсультация.dc.html
- ./SmartQoldau Expert Web - Уведомления.dc.html
- ./SmartQoldau Expert Web - Поддержка.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-085 — Expert Web / Поддержка

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert Web - Поддержка.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `/[locale]/expert/support` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-SES-010 |

**Цель:** Создать/отследить support ticket без раскрытия лишних данных.

**Рекомендуемое действие:** Сверить с mobile ownership, убрать независимую бизнес-логику.

### Действия из прототипа
- Написать в поддержку

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert Web - Уведомления.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-086 — Expert Web / Профиль

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert Web - Профиль.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `/[locale]/expert/profile` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-EXP-002, UC-EXP-006 |

**Цель:** Управлять данными и разрешёнными действиями роли на поверхности Expert Web.

**Рекомендуемое действие:** Сверить с mobile ownership, убрать независимую бизнес-логику.

### Действия из прототипа
- Редактировать профиль
- Изменить тариф

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert - Тарифы.dc.html
- ./SmartQoldau Expert - Тарифы.dc.html
- ./SmartQoldau Expert Web - Уведомления.dc.html
- ./SmartQoldau Expert Web - Поддержка.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-087 — Expert Web / Расписание

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert Web - Расписание.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `/[locale]/expert/schedule` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-BOOK-003, UC-EXP-008, UC-EXP-009 |

**Цель:** Управлять слотами, исключениями и timezone.

**Рекомендуемое действие:** Сверить с mobile ownership, убрать независимую бизнес-логику.

### Действия из прототипа
- Настроить расписание
- Сохранить

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert Web - Уведомления.dc.html
- ./SmartQoldau Expert Web - Поддержка.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-088 — Expert Web / Рейтинг

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert Web - Рейтинг.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `/[locale]/expert/reviews` |
| Release | `R2` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-EXP-016 |

**Цель:** Реализовать назначение экрана «Рейтинг» для поверхности Expert Web по связанным use cases.

**Рекомендуемое действие:** Сверить с mobile ownership, убрать независимую бизнес-логику.

### Действия из прототипа
- Отправить ответ
- Отмена

### Поля из прототипа
- Напишите публичный ответ клиенту...

### Prototype transitions
- ./SmartQoldau Expert Web - Уведомления.dc.html
- ./SmartQoldau Expert Web - Поддержка.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-089 — Expert Web / Уведомления

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert Web - Уведомления.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `/[locale]/expert/notifications` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | reference / уточнить в R0 |

**Цель:** Показать события с безопасными deep links и read state.

**Рекомендуемое действие:** Сверить с mobile ownership, убрать независимую бизнес-логику.

### Действия из прототипа
- Определяется связанными use cases; demo-only CTA не переносится автоматически.

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Expert Web - Поддержка.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-090 — Expert Web / Чаты

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Expert Web - Чаты.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `/[locale]/expert/chats` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-SES-002, UC-SES-005, UC-SES-006, UC-SES-010 |

**Цель:** Реализовать назначение экрана «Чаты» для поверхности Expert Web по связанным use cases.

**Рекомендуемое действие:** Сверить с mobile ownership, убрать независимую бизнес-логику.

### Действия из прототипа
- Начать аудио
- Начать видео

### Поля из прототипа
- Напишите сообщение...

### Prototype transitions
- ./SmartQoldau Expert Web - Уведомления.dc.html
- ./SmartQoldau Expert Web - Поддержка.dc.html
- ./SmartQoldau Expert Web - Видеоконсультация.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-091 — Public Web / CookieBanner

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Web - CookieBanner.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `global component` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | reference / уточнить в R0 |

**Цель:** Реализовать назначение экрана «CookieBanner» для поверхности Public Web по связанным use cases.

**Рекомендуемое действие:** Сохранить SEO/SSR; привести тексты и layout к канону.

### Действия из прототипа
- Политикой конфиденциальности
- Принять

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau Web - Политика конфиденциальности.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-092 — Public Web / LangSwitch

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Web - LangSwitch.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `global component` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-PUB-002 |

**Цель:** Реализовать назначение экрана «LangSwitch» для поверхности Public Web по связанным use cases.

**Рекомендуемое действие:** Сохранить SEO/SSR; привести тексты и layout к канону.

### Действия из прототипа
- Определяется связанными use cases; demo-only CTA не переносится автоматически.

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- Нет прямых prototype targets или это reference-only artifact.

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-093 — Public Web / Premium

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Web - Premium.dc.html` |
| Viewport hint | `100%,0` |
| Canonical route | `/[locale]/premium` |
| Release | `R3` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-PUB-005, UC-PREM-001 |

**Цель:** Показать канонические планы и приобрести/управлять подпиской.

**Рекомендуемое действие:** Сохранить SEO/SSR; привести тексты и layout к канону.

### Действия из прототипа
- SmartQoldau
- ← На главную
- Подключить Premium

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau.kz.dc.html
- ./SmartQoldau.kz.dc.html
- ./SmartQoldau - Регистрация.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-094 — Public Web / Выбор темы

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Web - Выбор темы.dc.html` |
| Viewport hint | `100%,0` |
| Canonical route | `/[locale]/match` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-PUB-004, UC-DISC-001 |

**Цель:** Выбрать потребность и формат для подбора.

**Рекомендуемое действие:** Сохранить SEO/SSR; привести тексты и layout к канону.

### Действия из прототипа
- SmartQoldau
- ← На главную
- Подобрать специалиста

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau.kz.dc.html
- ./SmartQoldau.kz.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-095 — Public Web / Для бизнеса

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Web - Для бизнеса.dc.html` |
| Viewport hint | `100%,0` |
| Canonical route | `/[locale]/business` |
| Release | `R4` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-PUB-006 |

**Цель:** Реализовать назначение экрана «Для бизнеса» для поверхности Public Web по связанным use cases.

**Рекомендуемое действие:** Сохранить SEO/SSR; привести тексты и layout к канону.

### Действия из прототипа
- SmartQoldau
- ← На главную
- Оставить заявку

### Поля из прототипа
- Название компании
- Контактное лицо
- Email
- Телефон
- Примерное количество сотрудников
- Комментарий (необязательно)

### Prototype transitions
- ./SmartQoldau.kz.dc.html
- ./SmartQoldau.kz.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-096 — Public Web / Для вузов

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Web - Для вузов.dc.html` |
| Viewport hint | `100%,0` |
| Canonical route | `/[locale]/universities` |
| Release | `R5` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-PUB-007 |

**Цель:** Реализовать назначение экрана «Для вузов» для поверхности Public Web по связанным use cases.

**Рекомендуемое действие:** Сохранить SEO/SSR; привести тексты и layout к канону.

### Действия из прототипа
- SmartQoldau
- ← На главную
- Оставить заявку на партнёрство

### Поля из прототипа
- Название вуза
- Контактное лицо
- Должность (декан / зав. кафедрой / куратор)
- Email
- Телефон
- Примерное количество студентов для программы
- Комментарий (необязательно)

### Prototype transitions
- ./SmartQoldau.kz.dc.html
- ./SmartQoldau.kz.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-097 — Public Web / Каталог

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Web - Каталог.dc.html` |
| Viewport hint | `100%,0` |
| Canonical route | `/[locale]/catalog` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-PUB-003, UC-DISC-003 |

**Цель:** Просмотреть и отфильтровать публичных специалистов.

**Рекомендуемое действие:** Сохранить SEO/SSR; привести тексты и layout к канону.

### Действия из прототипа
- SmartQoldau
- Войти
- Мне нужна помощь
- Смотреть профиль →

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau.kz.dc.html
- ./SmartQoldau - Регистрация.dc.html
- ./SmartQoldau Web - Выбор темы.dc.html
- {{ p.href }}

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-098 — Public Web / Материалы

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Web - Материалы.dc.html` |
| Viewport hint | `100%,0` |
| Canonical route | `/[locale]/materials` |
| Release | `R3` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-CONT-001, UC-CONT-002 |

**Цель:** Дать доступ к библиотеке самопомощи.

**Рекомендуемое действие:** Сохранить SEO/SSR; привести тексты и layout к канону.

### Действия из прототипа
- SmartQoldau
- ← На главную
- {{ m.title }} {{ m.text }}

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau.kz.dc.html
- ./SmartQoldau.kz.dc.html
- {{ m.href }}

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-099 — Public Web / О нас

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Web - О нас.dc.html` |
| Viewport hint | `100%,0` |
| Canonical route | `/[locale]/about` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-PUB-001 |

**Цель:** Реализовать назначение экрана «О нас» для поверхности Public Web по связанным use cases.

**Рекомендуемое действие:** Сохранить SEO/SSR; привести тексты и layout к канону.

### Действия из прототипа
- SmartQoldau
- ← На главную
- Связаться с поддержкой

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau.kz.dc.html
- ./SmartQoldau.kz.dc.html
- ./SmartQoldau Web - Поддержка.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-100 — Public Web / Поддержка

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Web - Поддержка.dc.html` |
| Viewport hint | `100%,0` |
| Canonical route | `/[locale]/support` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | reference / уточнить в R0 |

**Цель:** Создать/отследить support ticket без раскрытия лишних данных.

**Рекомендуемое действие:** Сохранить SEO/SSR; привести тексты и layout к канону.

### Действия из прототипа
- SmartQoldau
- ← На главную
- {{ submitLabel }}

### Поля из прототипа
- Ваше имя
- Email или телефон
- Опишите вопрос

### Prototype transitions
- ./SmartQoldau.kz.dc.html
- ./SmartQoldau.kz.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-101 — Public Web / Поиск специалиста

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Web - Поиск специалиста.dc.html` |
| Viewport hint | `not specified` |
| Canonical route | `/[locale]/match/search` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-PUB-004 |

**Цель:** Показать authoritative progress matching без ложного SLA.

**Рекомендуемое действие:** Сохранить SEO/SSR; привести тексты и layout к канону.

### Действия из прототипа
- Отменить поиск

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau.kz.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-102 — Public Web / Политика конфиденциальности

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Web - Политика конфиденциальности.dc.html` |
| Viewport hint | `100%,0` |
| Canonical route | `/[locale]/legal/privacy` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | reference / уточнить в R0 |

**Цель:** Реализовать назначение экрана «Политика конфиденциальности» для поверхности Public Web по связанным use cases.

**Рекомендуемое действие:** Сохранить SEO/SSR; привести тексты и layout к канону.

### Действия из прототипа
- SmartQoldau
- ← На главную

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau.kz.dc.html
- ./SmartQoldau.kz.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-103 — Public Web / Пользовательское соглашение

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Web - Пользовательское соглашение.dc.html` |
| Viewport hint | `100%,0` |
| Canonical route | `/[locale]/legal/terms` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | reference / уточнить в R0 |

**Цель:** Реализовать назначение экрана «Пользовательское соглашение» для поверхности Public Web по связанным use cases.

**Рекомендуемое действие:** Сохранить SEO/SSR; привести тексты и layout к канону.

### Действия из прототипа
- SmartQoldau
- ← На главную

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau.kz.dc.html
- ./SmartQoldau.kz.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-104 — Public Web / Профиль психолога

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Web - Профиль психолога.dc.html` |
| Viewport hint | `100%,0` |
| Canonical route | `/[locale]/experts/:id` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-PUB-003, UC-DISC-004 |

**Цель:** Показать проверенный публичный профиль и условия записи.

**Рекомендуемое действие:** Сохранить SEO/SSR; привести тексты и layout к канону.

### Действия из прототипа
- SmartQoldau
- ← Все специалисты

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau.kz.dc.html
- ./SmartQoldau Web - Каталог.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-105 — Public Web / Стать психологом

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau Web - Стать психологом.dc.html` |
| Viewport hint | `100%,0` |
| Canonical route | `/[locale]/become-expert` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | UC-PUB-008 |

**Цель:** Реализовать назначение экрана «Стать психологом» для поверхности Public Web по связанным use cases.

**Рекомендуемое действие:** Сохранить SEO/SSR; привести тексты и layout к канону.

### Действия из прототипа
- SmartQoldau
- Уже специалист? Войти
- Оставить заявку

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- ./SmartQoldau.kz.dc.html
- ./SmartQoldau Expert Web - Главная.dc.html
- ./SmartQoldau Expert - Регистрация.dc.html
- ./SmartQoldau Expert - Регистрация.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
## SCR-106 — Public Web / Prototype Overview

| Поле | Значение |
| --- | --- |
| Prototype | `SmartQoldau.kz.dc.html` |
| Viewport hint | `100%,0` |
| Canonical route | `/[locale]/prototype-overview` |
| Release | `R1` |
| Current status | `IMPLEMENTED_CLAIMED_VISUAL_PARITY_UNKNOWN` |
| Use cases | reference / уточнить в R0 |

**Цель:** Реализовать назначение экрана «Prototype Overview» для поверхности Public Web по связанным use cases.

**Рекомендуемое действие:** Сохранить SEO/SSR; привести тексты и layout к канону.

### Действия из прототипа
- {{ l.label }}
- Войти
- SOS
- Найти специалиста
- {{ t.label }}
- Смотреть профиль
- Все специалисты →
- Смотреть все материалы
- Стать специалистом
- Узнать больше
- Узнать про B2B →
- Узнать про партнёрство →

### Поля из прототипа
- Нет полей ввода либо поля создаются только по каноническому контракту.

### Prototype transitions
- {{ l.href }}
- {{ loginHref }}
- tel:103
- {{ catalogHref }}
- {{ t.href }}
- {{ p.href }}
- {{ catalogHref }}
- {{ materialsHref }}
- {{ expertHref }}
- {{ expertHref }}
- {{ b2bHref }}
- {{ b2gHref }}
- {{ catalogHref }}
- {{ l.href }}
- tel:102
- tel:103
- ./SmartQoldau Web - Выбор темы.dc.html

### Обязательные состояния
- default
- loading
- empty (если применимо)
- error
- offline/reconnect (если применимо)
- forbidden (protected routes)
- success/confirmation
- destructive confirmation (если применимо)

### Frontend acceptance
- [ ] Композиция, иерархия и эмоциональный тон соответствуют prototype v2.
- [ ] Все цвета идут через semantic tokens.
- [ ] На mobile tap target ≥44px; на web виден keyboard focus.
- [ ] Нет demo-only цифр, fake success и мёртвых CTA.
- [ ] Business copy не противоречит PD-001…PD-020.
- [ ] Route восстанавливается после refresh/deep link.
- [ ] Mutation имеет disabled/pending/retry/unknown-result поведение.
- [ ] RU/KK layout выдерживает расширение текста без обрезания смысла.
- [ ] Analytics события не содержат чувствительный текст.
