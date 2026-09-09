# UC-STS-004. Автоматически применять и закрывать статусы по расписанию

| Поле | Значение |
|---|---|
| Модуль | Статусы и дежурства |
| Актор | Система (Celery worker / beat, management-команды); администратор стенда — запуск команд вручную |
| Статус | Partial |
| Основание | `apps/statuses/tasks.py` (9 задач `statuses.*`), `apps/statuses/signals.py` (`close_statuses_on_dismissal`, `give_new_employee_a_status`, `log_status_change`), `apps/statuses/services.py` (`ensure_active_status`, `employees_without_active_status`), `apps/statuses/application/services.py` (`apply_planned_statuses`, `complete_expired_statuses`), `apps/statuses/management/commands/ensure_employee_statuses.py`, `apps/operations/catch_up.py` (`materialize_status_effects`, `EFFECT_MATERIALIZERS`), `apps/operations/management/commands/materialize_status_effects.py`, `apps/operations/lagging_check.py`, `apps/operations/clock.py`, `config/celery.py`, `config/settings/base.py` (`CELERY_*`), `config/settings/test.py` (`CELERY_TASK_ALWAYS_EAGER`), `docker-compose.yml` (`celery`, `celery-beat`), `apps/employees/tasks.py` (пять `pass`) |
| Дата актуализации | 2026-09-08 |

## Цель
Система без участия оператора вводит запланированные статусы в действие с даты начала, закрывает истёкшие, возвращает сотрудников «В строю», закрывает статусы уволенных и заводит статус новым сотрудникам.

## Предусловия
- Для задач Celery: подняты `redis`, `celery` worker и `celery-beat` (`docker-compose.yml`); `CELERY_BROKER_URL`/`CELERY_RESULT_BACKEND` заданы.
- Для сигналов: приложение `statuses` загружено (сигналы подключены при старте Django).
- Для команд: доступ к `manage.py`.

## Main Flow
1. Наступает новый день; планировщик запускает задачу `statuses.apply_planned_statuses`.
2. Система (`StatusApplicationService.apply_planned_statuses`) находит кадровые статусы `planned` с `start_date <= сегодня` (и `end_date >= сегодня` либо без конца), закрывает текущий активный статус сотрудника, переводит запланированный в `active`, ставит `auto_applied=True`, ставит в очередь `send_status_applied_notification` по каждому.
3. Планировщик запускает `statuses.complete_expired_statuses` — система находит `active` статусы с `end_date < сегодня`, переводит их в `completed`; если тип не «В строю», создаёт сотруднику «В строю» с `end_date + 1`; ставит в очередь `send_status_completed_notification`.
4. Планировщик запускает `statuses.send_upcoming_status_notifications` (за 7 дней до начала) и `statuses.send_ending_status_notifications` (за 3 дня до конца) — система создаёт записи `Notification` (`NotificationType.STATUS_CHANGE`) адресатам.
5. При приёме сотрудника (сигнал `post_save` на `Employee`, `created=True`) система после коммита заводит ему «В строю» (`ensure_active_status`), если он работает и активного статуса нет.
6. При увольнении (сигнал `pre_save` на `Employee`: `employment_status` стал `FIRED` или появилась `dismissal_date`) система завершает активные статусы датой увольнения с `early_termination_reason` «Автоматически завершен в связи с увольнением…» и отменяет запланированные.
7. Администратор запускает `manage.py ensure_employee_statuses [--dry-run]` — команда применяет запланированные, завершает истёкшие и заводит «В строю» всем работающим без активного статуса (`employees_without_active_status`).
8. Администратор запускает `manage.py materialize_status_effects` — движок `catch_up.materialize_status_effects` под замком двигает водяной знак по дням до `Clock.today_local()` и вызывает материализаторы из `EFFECT_MATERIALIZERS`.

## Alternative Flow
- **AF1. `ValidationError` при применении запланированного статуса** (пересечение, сотрудник не работает): шаг 2 → строка пропускается, ошибка в `logger.error`, остальные применяются.
- **AF2. Исключение в задаче**: `logger.error("Ошибка при …")`, задача завершается без повтора (retry не настроен).
- **AF3. Статус не найден при отправке уведомления**: `logger.error("Статус {id} не найден")`.
- **AF4. Догон эффектов уже идёт (замок занят)**: шаг 8 → `logger.info("догон эффектов уже идёт; прогон пропущен")`, выход без работы.
- **AF5. `--dry-run` у `ensure_employee_statuses`**: печатает, что было бы сделано, не пишет.
- **AF6. Планировщик не сконфигурирован**: шаги 1, 3, 4 не наступают — см. «Открытые вопросы».

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `employee_statuses` (`statuses.EmployeeStatus`) | update / create | `planned`→`active` (`auto_applied=True`), `active`→`completed`, новый «В строю» после истёкшего, закрытие/отмена при увольнении, «В строю» новому сотруднику |
| `employee_status_change_history` | create | Сигнал `log_status_change` на каждый `save` статуса; отмена при увольнении — `CANCELLED` с причиной |
| `notifications` (`Notification`) | create | Уведомления о предстоящем/применённом/завершённом/продлённом/завершающемся статусе — только запись в таблицу |
| Водяной знак и замок догона (`apps/operations`) | update | `materialize_status_effects` двигает знак по дням; материализаторов нет (`EFFECT_MATERIALIZERS = ()`) |
| `ops_employee_statuses` (`OpsEmployeeStatus`) | — | Ничего: состояние строк раздела выводится из дат (`derive_state`), фоновых переходов не требует |
| Очередь Celery | send | `send_status_*_notification.delay(...)` из задач; из `apps/employees/tasks.py` — ничего (`pass`) |

## Бизнес-требования (BR)
- **BR1.** Запланированный кадровый статус вступает в силу автоматически в день начала; предыдущий активный закрывается днём раньше (`_close_active_statuses`).
- **BR2.** Истёкший статус (не «В строю») завершается на следующий день после `end_date`, и сотруднику заводится «В строю» с `end_date + 1`.
- **BR3.** У каждого работающего сотрудника всегда есть ровно один активный статус; отсутствие чинит `ensure_active_status` (сигнал при приёме, команда для остальных).
- **BR4.** Увольнение закрывает активные статусы датой увольнения (или сегодняшней) и отменяет запланированные с авто-причиной.
- **BR5.** Уведомления о предстоящих статусах — за 7 дней, о завершающихся — за 3 дня (`days_before` по умолчанию); канал — только таблица `Notification`.
- **BR6.** Бизнес-дата раздела — `Clock.today_local()`, не `now()`; догон эффектов идемпотентен, идёт под замком и не поднимает доменных ошибок.
- **BR7.** В тестах задачи выполняются синхронно (`CELERY_TASK_ALWAYS_EAGER=True`).

## Требования к логированию
- `logging.getLogger` в `apps/statuses/tasks.py`: `logger.info` с числом применённых/завершённых статусов и id уведомлений, `logger.error` при исключениях и отсутствии статуса.
- `apps/operations/catch_up.py`, `lagging_check.py`, `clock.py`, `locks.py`: `logger.info` (пропуск при занятом замке), `logger.error`/`logger.warning` при сбоях догона и поиска отставших.
- `ensure_employee_statuses`: только `stdout` команды.
- `StatusChangeHistory` — след каждого автоматического перехода (без указания, что переход автоматический, кроме `auto_applied` и текста причины).
- `OpsAuditLog` для автоматических переходов кадровых статусов: `Не реализовано в коде` (`audit_service` из `apps/statuses` не вызывается).
- Журнал запусков задач (когда, сколько, чем закончилось) в БД: `Не реализовано в коде`.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| Система (Celery worker/beat) | полный | Задачи выполняются без пользователя; `created_by=None` |
| Администратор стенда (shell) | запуск команд | Management-команды без проверки прав |
| Любая роль через HTTP | нет | Ручек запуска задач нет (`Не реализовано в коде`) |

## Требования к UX/UI
Нет пользовательского интерфейса.

## Открытые вопросы
- `CELERY_BEAT_SCHEDULE` в настройках отсутствует, `celery-beat` в `docker-compose.yml` поднимается с пустым расписанием: задачи `apply_planned_statuses`, `complete_expired_statuses`, `send_*_notifications` никогда не запускаются сами; фактический ежедневный переход обеспечивается только ручным `ensure_employee_statuses`.
- `config/celery.py` по умолчанию ставит `DJANGO_SETTINGS_MODULE=…settings.production`; на стенде задачи с другими настройками не проверялись.
- `EFFECT_MATERIALIZERS = ()` — движок догона двигает водяной знак, но ни одного эффекта не материализует («шов» по комментарию в `catch_up.py`); Celery-обёртка и расписание для него не заведены.
- Пять задач `apps/employees/tasks.py` (`copy_statuses_task`, `check_status_updates_task`, `reset_default_statuses_task`, `export_employees_to_csv_task`, `export_employees_to_xlsx_task`) — `pass`.
- Уведомления пишутся только в таблицу `Notification`; почта/SMS/мессенджеры не подключены.
- Автоматика касается только кадровой модели `statuses.EmployeeStatus`; для строк раздела `OpsEmployeeStatus` переходов не требуется (состояние выводится), но и уведомлений по ним нет.
- Retry у задач не настроен; ошибка одной строки логируется и теряется.
