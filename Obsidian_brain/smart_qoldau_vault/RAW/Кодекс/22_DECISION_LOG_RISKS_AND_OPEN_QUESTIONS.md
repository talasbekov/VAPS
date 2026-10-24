# 22. Decision log, риски и открытые вопросы

## 1. Decision log

| ID | Решение | Статус | Owner |
| --- | --- | --- | --- |
| PD-001 | Вертикаль MVP | RECOMMENDED_FOR_APPROVAL | Product Owner |
| PD-002 | Продуктовые поверхности | APPROVE_AS_CANON | Product Owner |
| PD-003 | Граница Expert Mobile / Expert Web | RECOMMENDED_FOR_APPROVAL | Product Owner + UX Lead |
| PD-004 | Граница Client Mobile / Client Web | RECOMMENDED_FOR_APPROVAL | Product Owner + UX Lead |
| PD-005 | Premium | RECOMMENDED_FOR_APPROVAL | Commercial Owner |
| PD-006 | Цена консультации | RECOMMENDED_FOR_APPROVAL | Commercial Owner |
| PD-007 | Анонимность | RECOMMENDED_FOR_APPROVAL | Privacy Owner + Legal |
| PD-008 | Отзывы и качество | RECOMMENDED_FOR_APPROVAL | Quality Lead |
| PD-009 | Обещание скорости подбора | RECOMMENDED_FOR_APPROVAL | Product Owner + Marketing |
| PD-010 | Отмена и no-show | REQUIRES_LEGAL_VALIDATION | Legal + Finance |
| PD-011 | Модель оплаты | REQUIRES_PROVIDER_VALIDATION | Finance + Backend Lead |
| PD-012 | Время | APPROVE_AS_CANON | Product Owner |
| PD-013 | Языки запуска | RECOMMENDED_FOR_APPROVAL | Product Owner + Localization Owner |
| PD-014 | Несовершеннолетние | REQUIRES_LEGAL_VALIDATION | Legal |
| PD-015 | Кризисный сценарий | REQUIRES_SAFETY_REVIEW | Clinical/Safety Owner |
| PD-016 | B2B-конфиденциальность | RECOMMENDED_FOR_APPROVAL | Privacy Owner + B2B Owner |
| PD-017 | B2G и практиканты | DEFER_TO_RELEASE_5 | Product Owner + University Partner |
| PD-018 | Wearables/AI-анализ | DEFER_TO_RESEARCH | Product Owner + Safety Owner |
| PD-019 | Admin RBAC | RECOMMENDED_FOR_APPROVAL | Security Owner |
| PD-020 | Канон frontend | APPROVE_AS_CANON | Product Owner + Design Lead |

Подробные формулировки — `02_EXECUTIVE_PRODUCT_DECISIONS.md`.

## 2. Risk register

| ID | Риск | Severity | Mitigation |
| --- | --- | --- | --- |
| RISK-001 | Два параллельных planning vault | High | Сверить локальный SmartQoldau Obsidian и этот пакет в R0; выбрать один канон. |
| RISK-002 | Прототип воспринимается как business truth | Critical | PD-020, server-owned config, review copy/price/status. |
| RISK-003 | Visual drift четырёх frontend поверхностей | High | tokens + screen registry + golden tests + visual changelog. |
| RISK-004 | Дублирование Expert Mobile/Web | High | primary ownership matrix; один contract/state model. |
| RISK-005 | Звонки не проверены на устройстве | Critical R2 | JDK/device lab, real network interruption, permission tests. |
| RISK-006 | Killed-state offer не гарантирован | High | truthful copy, push architecture decision, no false SLA. |
| RISK-007 | Payment provider contract не заморожен | Critical | ADR, idempotency, webhook, reconciliation before R2. |
| RISK-008 | Отмена/no-show юридически не утверждены | Critical | legal/finance approval and terms before public release. |
| RISK-009 | «Полная анонимность» вводит в заблуждение | Critical | pseudonymity copy and privacy model. |
| RISK-010 | SOS воспринимается как экстренная служба | Critical | safety review and offline emergency resources. |
| RISK-011 | Admin fake dashboards из прототипа | High | no release without metrics API; explicit empty/gap. |
| RISK-012 | Sensitive PII в analytics/logs | Critical | closed event schema, tests, redaction. |
| RISK-013 | B2B re-identification | Critical | cohort threshold and forbidden dimensions. |
| RISK-014 | Практикант получает тяжёлый кейс | Critical | central eligibility, supervisor, client consent. |
| RISK-015 | RU/KK semantic drift | High | key parity + visual text expansion + terminology glossary. |
| RISK-016 | Hardcoded темы/тарифы расходятся | High | server-owned dictionaries/versioning. |
| RISK-017 | Refund/payout manual actions без ledger | Critical | immutable ledger + four-eyes + audit. |
| RISK-018 | Shared package становится связанным с client DTO | Medium | bounded shared primitives and adapters. |
| RISK-019 | Backend README/документация устарели | Medium | current architecture/runbook docs in repo; generated OpenAPI. |
| RISK-020 | Big-bang visual rewrite | High | screen-by-screen delta, vertical stories, keep working code. |
| RISK-021 | Неопределённый result показывает success | Critical | unknown state UX + status query/reconciliation. |
| RISK-022 | Premium цена/benefits расходятся | High | server plans + PD-005 + contract tests. |
| RISK-023 | Retention/deletion не утверждены | High | legal retention matrix before privacy feature release. |
| RISK-024 | Content содержит clinical claims | High | safety review lifecycle. |
| RISK-025 | Market expansion legal vertical слишком рано | High | separate R6 discovery; no shared taxonomy shortcut. |

## 3. Открытые вопросы

| ID | Вопрос | Owner | Gate | Рекомендация |
| --- | --- | --- | --- | --- |
| Q-001 | Утвердить психологию-only MVP? | Product Owner | R0 | Рекомендация: да; legal vertical R6. |
| Q-002 | Утвердить 2 990/23 900 Premium и no-free-sessions? | Commercial Owner | R0 | Рекомендация: да. |
| Q-003 | Top tariff 10% или 11%? | Commercial/Finance | R0/R2 | Выбрать одно значение server-side. |
| Q-004 | Точная provider/hold/capture модель? | Finance | R0/R2 | ADR до payment implementation. |
| Q-005 | Cancellation/no-show terms legal-approved? | Legal/Finance | R2 | Подтвердить суммы, grace period, commission. |
| Q-006 | 18+ до отдельной модели minors? | Legal | R0 | Рекомендация: да. |
| Q-007 | Какие горячие линии кроме 102/103 утверждены? | Safety/Legal | R1 | Список по региону и языку. |
| Q-008 | Retention сроки для чата/notes/docs/complaints? | Privacy/Legal | R2/R3 | Создать matrix. |
| Q-009 | Expert Mobile/Web primary ownership утверждено? | Product/UX | R0 | Рекомендация PD-003. |
| Q-010 | Guest может начинать платную consultation без phone? | Security/Product | R0/R1 | Рекомендация: только при безопасной recoverable identity/provider compatibility. |
| Q-011 | Public review edit window и expert reply moderation? | Quality | R3 | Утвердить policy. |
| Q-012 | Minimum B2B cohort threshold? | Privacy/B2B | R4 | Утвердить с DPO/legal. |
| Q-013 | B2G supervisor qualification/capacity/payment? | B2G Owner | R5 | Pilot policy. |
| Q-014 | Recording calls allowed? | Privacy/Legal | R0 | Рекомендация: нет по умолчанию. |
| Q-015 | Production push/VoIP expectation? | Product/Platform | R2 | Не обещать killed-state real-time alert без platform solution. |

## 4. Формат новой записи решения

```text
ID:
Дата:
Контекст:
Источники:
Варианты:
Выбранный вариант:
Почему:
Последствия:
Затронутые use cases/screens/API:
Owner/approver:
Дата пересмотра:
```

## 5. Правило молчаливых предположений

Если решение влияет на деньги, безопасность, privacy, роль, статус, SLA, публичное обещание или B2B/B2G reporting, ИИ/разработчик не выбирает его молча. Он использует утверждённый default этого blueprint либо создаёт decision record и останавливает только затронутую story, не весь проект.
