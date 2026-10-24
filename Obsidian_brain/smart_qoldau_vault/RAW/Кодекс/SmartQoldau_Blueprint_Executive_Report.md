# SmartQoldau — итоговый отчёт бизнес- и frontend-blueprint

**Дата:** 2026-09-13  
**Репозиторий:** `main@7cc08784`  
**Код изменён:** нет.

## 1. Главный диагноз

Проект уже содержит значительную реализацию Fable, поэтому главная угроза срокам — не нехватка кода, а расхождение бизнес-канона, прототипа и четырёх frontend-поверхностей.

Критические источники будущих переделок:

1. конфликт цены и преимуществ Premium;
2. маркетинговое обещание подключения за 1–2 минуты;
3. «полная анонимность» вместо псевдонимности;
4. публичный отзыв и приватная оценка качества смешаны;
5. cancellation/no-show/payment модель не утверждена как единый канон;
6. Expert Mobile и Expert Web пересекаются без явного primary ownership;
7. B2B/B2G прототип выглядит готовым, но операционная и backend-модель неполны;
8. visual parity v2 не доказана системными screenshot/device tests;
9. часть planning Fable находится в недоступном локальном SmartQoldau Obsidian;
10. admin prototype содержит модули, для которых README отмечает backend gaps.

## 2. Что сохранить

- текущую модульную backend-реализацию и тестовые инварианты;
- Flutter client/expert apps и общий пакет;
- Next.js SSR/BFF/httpOnly архитектуру;
- admin RBAC/TOTP/operational queues;
- profile moderation и private/public storage separation;
- Premium content entitlement на сервере;
- атомарный matching и realtime foundation;
- визуальный язык prototype v2;
- методологию Fable: source hierarchy, plan-before-code, click-map, decision log, GO/NO-GO.

## 3. Что утвердить до следующего coding release

- PD-001…PD-020;
- psychology-only MVP;
- Premium 2 990/23 900 без бесплатных консультаций;
- pseudonymous client model;
- Expert Mobile/Web ownership;
- cancellation/no-show/provider model;
- 18+ и crisis copy;
- RU/KK locale convention;
- один канонический screen registry.

## 4. Рекомендуемая последовательность

1. **R0:** сверка с локальным Obsidian, решения, visual baselines.
2. **R1:** закончить и доказать core client/expert/admin/public flow.
3. **R2:** деньги, звонки на устройствах, complaints/refunds, admin operations.
4. **R3:** Premium, контент, reviews, privacy operations и метрики.
5. **R4:** B2B pilot.
6. **R5:** B2G pilot.
7. **R6:** legal/wearables/AI как отдельные исследования.

## 5. Масштаб blueprint

| Артефакт | Количество |
| --- | --- |
| Роли | 19 |
| Use cases | 112 |
| Бизнес-процессы | 28 |
| Бизнес-правила | 100 |
| State machines | 15 |
| Prototype screens | 106 |
| Epics | 17 |
| Stories | 95 |

## 6. Следующая практическая команда Fable

```text
Прочитай docs/product-blueprint/00_INDEX.md и 23_IMPLEMENTATION_OPERATING_RULES.md.
Сверь этот пакет с локальным smart_qoldau_vault/WIKI/planning.
Не меняй код. Подготовь один reconciliation report: совпадения, конфликты,
уникальные утверждённые решения и предлагаемая каноническая версия.
Заверши строкой R0 RECONCILIATION READY — CODE NOT CHANGED.
```

После утверждения reconciliation:

```text
BUSINESS AND FRONTEND CANON APPROVED — START R1 DELTA IMPLEMENTATION
```
