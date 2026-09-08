# UC-EXP-003. Собрать суточную сводку, увидеть светофор и обойти блокировку на завтра

| Поле | Значение |
|---|---|
| Модуль | Ежедневный расход |
| Актор | DEPARTMENT_EXPENSE_OFFICER, DUTY_OFFICER, HEAD_DEPARTMENT_LINE, FORCES_GATHERING_OFFICER (сборка сводки); DUTY_OFFICER (обход блокировки); роли со `status.view` (светофор); ADMIN |
| Статус | Partial |
| Основание | `apps/operations/summary_service.py` (`assemble_summary`, `summary_freshness`, `rebuild_summary`), `apps/operations/traffic_light.py` (`division_traffic_light`, `traffic_light_tree`), `apps/operations/tomorrow_block.py`, `apps/operations/tomorrow_gate.py` (`resolve_block`, `assert_tomorrow_not_blocked`), `apps/operations/block_override.py`, `apps/operations/models_submission.py` (`OpsTomorrowBlockOverride`, `OpsSubmissionControlSettings.required_division_ids`), `apps/operations/api/views.py::DailySummaryViewSet` (`POST /api/operations/daily-summaries/`, `/rebuild/`, `GET /freshness/`, `/export/`), `TrafficLightViewSet` (`GET /api/operations/traffic-light/tree/`, `/{division_id}/`), `TomorrowBlockViewSet` (`GET /api/operations/tomorrow-block/`, `POST /override/`), `StrengthReportViewSet.list` (гейт 422 `TOMORROW_BLOCKED`); FRONT `features/daily-expense/ui/SummaryVersions.tsx`, `hooks/use-daily-summary-write.ts`, `hooks/use-strength-report.ts::useTrafficLightTree`, `features/command-expense/ui/ExpenseTrafficCard.tsx` (`app/security-ops/command-center`), `app/security-ops/analytics/page.tsx` (`DaySubmissionSection`), `app/dashboard/page.tsx` (`useAbsenceStatistics` → `/api/statuses/statuses/absence_statistics/`) |
| Дата актуализации | 2026-09-08 |

## Цель
Сводящий за департамент фиксирует сводку дня из сдач управлений, дежурный видит по светофору, кто сдал и кому верить, и при отставании «необходимых управлений» осознанно открывает расход на завтра.

## Предусловия
- Управления департамента (прямые дети, у которых есть люди в поддереве) сдали день (UC-EXP-001).
- Для сборки: право `daily_report.generate` с областью, включающей департамент; дата в окне сегодня/завтра; сводка за день ещё не собрана.
- Для светофора: право `status.view`.
- Для обхода блокировки: право `daily_report.override_block`; дата — будущая, не дальше +7 дней (`MAX_OVERRIDE_HORIZON_DAYS`); список `required_division_ids` заполнен в `OpsSubmissionControlSettings` (иначе блокировки нет).

## Main Flow
1. Сводящий открывает «Ежедневный расход организации», блок «Суточный свод»; система выводит узел свода из дерева светофора (`GET /api/operations/traffic-light/tree/`) и показывает версии свода (`GET /api/ops/daily/daily-submissions/?division_id=&business_date=`).
2. Сводящий нажимает «Собрать и отправить свод».
3. Система проверяет право и область, существование подразделения, окно дат, отсутствие сдачи за день, наличие детей, сдачи всех обязанных детей.
4. Система собирает снимок своего уровня, добавляет `sources` — пины действующих сдач прямых детей (division_id, submission_id, version), определяет событие (`CHANGED`/`CONFIRMED_NO_CHANGES` с учётом пинов) и отметку опоздания; создаёт `OpsDailySubmission` версии 1 и пишет `DAILY_SUMMARY_ASSEMBLED`.
5. Экран перечитывает версии свода; по кнопке «Открыть» показывает снимок версии («В списке N, отклонений M · причина · санкция»).
6. Дежурный открывает «Командный центр» (карточка «Расход дня: светофор сдачи») или «Аналитику службы» (секция «Сдача дня»); система по `traffic-light/tree` показывает контрольный час и корзины «Сдано / Не сдано / Просрочено» с отстающими подразделениями.
7. Точечный запрос `GET /api/operations/traffic-light/{division_id}/` отдаёт цвет узла и поимённое расхождение (`drift`) для жёлтого.
8. При запросе живого расхода на будущую дату (`GET /api/operations/strength-report/?business_date=<завтра>`) система проверяет блокировку: есть «необходимые управления» без действующей сдачи → 422 `TOMORROW_BLOCKED` со списком отстающих.
9. Дежурный записывает обход `POST /api/operations/tomorrow-block/override/ {business_date, reason}`; система создаёт `OpsTomorrowBlockOverride` и пишет `TOMORROW_BLOCK_OVERRIDDEN`.
10. После обхода расход на эту дату формируется; `GET /api/operations/tomorrow-block/` отвечает `blocked=false, overridden=true`, отстающие остаются в списке.

## Alternative Flow
- **AF1. Не все дети сдали**: шаг 3 → 422 `SUMMARY_CHILDREN_NOT_SUBMITTED` с `details.laggards`; экран: «Свод не собран: не сдали <имена>».
- **AF2. Свод за день уже собран**: шаг 3 → 409 `DAY_ALREADY_SUBMITTED`; экран: «Свод за этот день уже собран — исправление отдельным действием».
- **AF3. Нет права/области**: 403; экран: «Свод не собран: нет права собирать свод за это подразделение».
- **AF4. Подразделение-лист**: 400 `VALIDATION_ERROR` («Сводка собирается только для подразделения с детьми»).
- **AF5. Дата вне окна**: 422 `BUSINESS_DATE_OUT_OF_WINDOW`; подразделение не найдено: 404.
- **AF6. Узел свода не выводится из дерева** (нет кандидатов / неоднозначность): экран показывает честную строку, при неоднозначности даёт выбрать кандидата; запрос версий не уходит.
- **AF7. Пересборка сводки «взамен»** (`POST /daily-summaries/rebuild/`, право `daily_report.correct`, обязательны reason/sanction): 422 `NO_SUBMISSION_TO_AMEND` если дня нет, 400 если голова цепочки — обычная сдача, 422 если дети не сдали. UI для пересборки отсутствует.
- **AF8. Свежесть сводки** (`GET /daily-summaries/freshness/`): `STALE` при `superseded`/`missing`/`unpinned`, `None` если сводки нет. UI отсутствует.
- **AF9. Обход: дата не в будущем**: 400 «Обойти можно только блокировку будущей даты.»; дальше +7 дней: 400 «…проверьте год»; повтор на ту же дату: 409 `TOMORROW_BLOCK_ALREADY_OVERRIDDEN`; пустая причина: 400.
- **AF10. Светофор: чужой корень** → 403; несуществующий → 404; сломанный справочник статусов в точечном чтении → ошибка, в дереве узел `UNKNOWN`.
- **AF11. Сдачи за день нет** — расход «не сдан» (`DAY_NOT_SUBMITTED`) и блокировка не мешают чтению за сегодня и прошлое: гейт только на будущих датах.

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `ops_daily_submissions` | create | сводка: строка составного подразделения, `snapshot.sources` — пины детей |
| `ops_daily_submissions` | update/create | пересборка: гашение `is_current`, новая версия `AMENDED` |
| `ops_audit_log` | create | `DAILY_SUMMARY_ASSEMBLED`, `DAILY_SUMMARY_REBUILT` (с компактными пинами), `TOMORROW_BLOCK_OVERRIDDEN` |
| `ops_tomorrow_block_overrides` | create | одна строка на дату: `reason`, `overridden_by`; неотзывна |
| `ops_submission_control_settings` | read | `required_division_ids`, `control_hour` |
| светофор, блокировка, свежесть | read | вывод на чтении, не хранится |
| HTTP-аудит | create | CREATE на POST сборки/пересборки/обхода |

## Бизнес-требования (BR)
- **BR1.** Сводка — та же сущность, что сдача (`OpsDailySubmission`), отличается ключом снимка `sources`; снимок — строго свой уровень, не объединение детских.
- **BR2.** Сводка собирается только для подразделения с детьми и только когда сдали все дети, у которых в поддереве есть занятые штатные слоты.
- **BR3.** Пересборка — новая версия с обязательными причиной и санкцией; обычную сдачу пересборкой в сводку превратить нельзя.
- **BR4.** Свежесть выводится на чтении: `STALE`, если ребёнок поправил день, потерял действующую версию или появился обязанный ребёнок без пина.
- **BR5.** Светофор: RED — есть кого сдавать и сдачи нет; NEUTRAL — сдавать некого; YELLOW — сдача есть, победители дня разошлись с живыми; GREEN — совпали; свод поднимает худший цвет, `late` — снизу.
- **BR6.** Блокировка завтра: любое подразделение из `required_division_ids` без действующей сдачи блокирует; пустой список — блокировки нет; действует только на будущие даты; гейт стоит на живом расходе (`strength-report/list`), сданный расход не гейтится.
- **BR7.** Обход — одна неотзывная строка на дату с ответственным и причиной; дата строго в будущем и не дальше +7 дней; области у обхода нет.
- **BR8.** Права различны: сборка — `daily_report.generate`; пересборка — `daily_report.correct`; свежесть/светофор/экспорт/состояние блокировки — `status.view`; обход — `daily_report.override_block`.
- **BR9.** Порядок гардов: право → существование → окно → повтор → лист → сдачи детей.

## Требования к логированию
- Журнал раздела: `DAILY_SUMMARY_ASSEMBLED`, `DAILY_SUMMARY_REBUILT` (old/new + `sources` без submission_id), `TOMORROW_BLOCK_OVERRIDDEN` (override_id, business_date, overridden_by, reason).
- HTTP-аудит `AuditMiddleware` на успешные POST.
- Console-логгеров в `summary_service`, `traffic_light`, `tomorrow_block`, `block_override` нет.
- Логирование отказов 422 `TOMORROW_BLOCKED` (кто пытался открыть завтра) — `Не реализовано в коде`.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| ADMIN | полный | `*` |
| DEPARTMENT_EXPENSE_OFFICER, DUTY_OFFICER, HEAD_DEPARTMENT_LINE, FORCES_GATHERING_OFFICER | сборка сводки в области | `daily_report.generate` — `DailySummaryViewSet.permission_map["create"]` + `_assert_division_in_scope` |
| DIRECTORATE_HEAD | пересборка сводки | `daily_report.correct` — `permission_map["rebuild"]` |
| DUTY_OFFICER | обход блокировки | `daily_report.override_block` — `TomorrowBlockViewSet.permission_map["override"]`, без области |
| Роли со `status.view` (см. UC-EXP-001) | чтение светофора, свежести, состояния блокировки, экспорта сводки | `status.view`; чужой корень дерева — 403 |
| Остальные | нет | — |

## Требования к UX/UI
- «Ежедневный расход организации» (`/employees`) → блок «Суточный свод» (`SummaryVersions`): кнопка «Собрать и отправить свод» (видна при `daily_report.generate` и определённом узле; «Отправляем…» в процессе), список версий с «Открыть/Свернуть» и снимком версии, тексты отказов (см. AF1–AF3), выбор кандидата при неоднозначности узла.
- «Командный центр» (`/security-ops/command-center`) → карточка «Расход дня: светофор сдачи» (`ExpenseTrafficCard`): контрольный час, счётчики «Сдано / Не сдано / Просрочено», список отстающих (ограничен `LAGGING_VISIBLE_LIMIT`); состояния «Загрузка светофора…», «Светофор сейчас недоступен.»; без права `status.view` карточка не рисуется.
- «Аналитика службы» (`/security-ops/analytics`) → секции «Сдача дня» и «Актуальность ежедневного расхода»: те же корзины на дереве светофора, ссылка «Открыть расход».
- Дашборд (`/dashboard`) показывает статистику отсутствий (`/api/statuses/statuses/absence_statistics/`), не светофор.
- Обход блокировки, пересборка сводки, свежесть сводки, точечный `drift` узла — `Нет пользовательского интерфейса`.

## Открытые вопросы
- Обход блокировки завтрашнего дня (`POST /tomorrow-block/override/`) и её состояние (`GET /tomorrow-block/`) не читаются ни одним экраном; на клиенте нет обработки 422 `TOMORROW_BLOCKED` в `useStrengthReport`/`app/reports` — дежурный увидит только текст ошибки.
- Пересборка сводки (`/daily-summaries/rebuild/`) и свежесть (`/daily-summaries/freshness/`) — бэкенд без UI; экран говорит «исправление отдельным действием», но действия не даёт.
- Точечный светофор с `drift` (`GET /traffic-light/{id}/`) на экранах не используется — жёлтый цвет показан без ответа «кого проверять».
- `required_division_ids` и контрольный час правятся только в Django Admin (`apps/operations/admin.py`), API/экрана настроек нет.
- Экран `SummaryVersions` выводит узел свода эвристикой по дереву (родитель — корень, максимум управлений борда) — контракт «узел свода» сервером не задан.
