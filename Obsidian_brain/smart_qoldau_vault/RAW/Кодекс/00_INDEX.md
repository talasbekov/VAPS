# 00. Индекс blueprint

**Продукт:** SmartQoldau  
**Дата:** 2026-09-13  
**Кодовая точка:** `7cc08784eca34402f4b9a8ade42d858724fbeb8d`  
**Статус:** `BLUEPRINT COMPLETE — CODE NOT CHANGED`

## Документы

| Файл | Назначение | Статус |
| --- | --- | --- |
| 01_SOURCE_MAP_AND_FABLE_WORK_REVIEW.md | Источники, текущее состояние и использованные методы Fable. | READY |
| 02_EXECUTIVE_PRODUCT_DECISIONS.md | 20 рекомендуемых канонических решений. | READY |
| 03_PRODUCT_SCOPE_AND_BUSINESS_MODEL.md | Продукт, value, scope и revenue model. | READY |
| 04_ROLES_PERMISSIONS_JTBD.md | 19 ролей и permission boundaries. | READY |
| 05_USE_CASE_CATALOG.md | 112 подробных use cases. | READY |
| 06_BUSINESS_PROCESS_CATALOG.md | 28 сквозных бизнес-процессов. | READY |
| 07_BUSINESS_RULES_AND_POLICIES.md | 100 правил. | READY |
| 08_STATES_LIFECYCLES_AND_RACI.md | 15 state machines и RACI. | READY |
| 09_MONETIZATION_AND_UNIT_ECONOMICS.md | Формулы, settlement и коммерческие решения. | READY |
| 10_B2B_B2G_OPERATING_MODEL.md | Контракты, privacy, entitlement и supervision. | READY |
| 11_SAFETY_PRIVACY_AND_TRUST.md | Safety boundary, data classes и threat model. | READY |
| 12_METRICS_AND_OPERATIONS.md | North Star, funnels, queues и SLA. | READY |
| 13_FRONTEND_INFORMATION_ARCHITECTURE.md | IA всех поверхностей и границы mobile/web. | READY |
| 14_SCREEN_REGISTRY_AND_FRONTEND_DELTA.md | Реестр 106 экранов и current delta. | READY |
| 15_SCREEN_SPECIFICATIONS.md | Исполнимые specs каждого prototype screen. | READY |
| 16_DESIGN_SYSTEM_AND_VISUAL_CONTRACT.md | Токены, компоненты и visual acceptance. | READY |
| 17_RESPONSIVE_STATES_CONTENT_I18N.md | Responsive, states, copy, RU/KK. | READY |
| 18_BACKEND_SUPPORT_AND_GAP_MATRIX.md | Что поддержано и где API gaps. | READY |
| 19_RELEASE_PLAN_AND_BACKLOG.md | 17 epics и 95 stories. | READY |
| 20_QA_ACCEPTANCE_AND_CLICK_MAP.md | Testing, click-map, GO/NO-GO. | READY |
| 21_TRACEABILITY_MATRIX.md | Use case→rules→screens→release→epic. | READY |
| 22_DECISION_LOG_RISKS_AND_OPEN_QUESTIONS.md | Риски и блокирующие вопросы. | READY |
| 23_IMPLEMENTATION_OPERATING_RULES.md | Правила последующей AI-разработки. | READY |

## Machine-readable

- `machine/product-manifest.yaml`
- `machine/roles.yaml`
- `machine/use-cases.yaml`
- `machine/business-processes.yaml`
- `machine/business-rules.yaml`
- `machine/state-catalog.yaml`
- `machine/screen-manifest.yaml`
- `machine/route-manifest.yaml`
- `machine/traceability.yaml`
- `machine/epics.yaml`
- `machine/decisions.yaml`
- `machine/risks.yaml`
- `machine/open-questions.yaml`
- `machine/frontend-delta.yaml`

## Порядок исполнения

1. Сверить пакет с недоступным локальным SmartQoldau Obsidian vault.
2. Утвердить решения из документа 02.
3. Зафиксировать visual baselines по документам 14–17.
4. Исполнять backlog 19 по правилам 23.
5. Каждый релиз принимать через документ 20.
