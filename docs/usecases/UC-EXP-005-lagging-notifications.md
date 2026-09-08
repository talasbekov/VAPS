# UC-EXP-005. Уведомить об отставании сдачи

| Поле | Значение |
|---|---|
| Модуль | Ежедневный расход |
| Актор | Система (management-команда `check_lagging_submissions`, запуск оператором/планировщиком); получатель — ответственный за подразделение (`OpsDivisionNotifyRecipient.recipient`) или общий дежурный (`OpsSubmissionControlSettings.default_notify_recipient`); администратор справочников (Django Admin) |
| Статус | Partial |
| Основание | `apps/operations/lagging_check.py` (`check_lagging_submissions`, `_emit_lagging`), `management/commands/check_lagging_submissions.py`, `apps/operations/notify_service.py` (`notify`, `_publish`, `mark_read`), `apps/operations/watermark.py` + `models_watermark.OpsWatermark` (ключ `lagging_submissions`), `apps/operations/tomorrow_block.py`, `models_submission.py` (`OpsDivisionNotifyRecipient`, `OpsSubmissionControlSettings`), `models_notification.OpsNotification` (`Kind.SUBMISSION_LAGGING`), `apps/operations/admin.py`, `NotificationViewSet` (`GET /api/operations/notifications/`, `POST …/{id}/read/`, `unread-count`, `read-all`); FRONT `hooks/use-ops-lagging-notifications.ts`, `app/security-ops/analytics/page.tsx::LaggingRemindersSection` |
| Дата актуализации | 2026-09-08 |

## Цель
Ответственный за подразделение один раз за день узнаёт, что его «необходимое управление» не сдало день после контрольного часа.

## Предусловия
- В `OpsSubmissionControlSettings` заполнен `required_division_ids` (иначе отстающих нет) и задан `control_hour`.
- Для отстающего подразделения заведён `OpsDivisionNotifyRecipient` либо задан `default_notify_recipient`.
- Команда запускается вне объемлющей транзакции; конкурентный прогон не держит advisory-замок `LAGGING_LOCK_KEY`.

## Main Flow
1. Оператор/планировщик запускает `manage.py check_lagging_submissions` (опционально `--today ГГГГ-ММ-ДД` для догона прошлого).
2. Система берёт сеансовый замок; при первом запуске заводит водяной знак `lagging_submissions` на вчера и завершает прогон без рассылки.
3. Система определяет горизонт: сегодня — если локальное время строго позже контрольного часа, иначе вчера; строит план дней от знака до горизонта (не более 31 дня за прогон).
4. Для каждого дня в отдельной транзакции система выводит отстающих (`tomorrow_block(day).laggards` — «необходимые» без действующей сдачи).
5. Система разрешает получателей (`NotifyRecipientSelector.resolve_many`: закреплённый → общий дежурный), группирует отстающих по получателю.
6. Система пишет `OpsNotification` вида `SUBMISSION_LAGGING` с `payload.laggard_division_ids` — одно на получателя за день (`get_or_create` по recipient+kind+business_date+dedupe_key).
7. По коммиту система объявляет созданную строку в WS-группу получателя (`transaction.on_commit(_publish)`), если `OPS_WS_ENABLED`.
8. Система сдвигает водяной знак на пройденный день; команда печатает «знак A -> B, дней N, охвачено M».
9. Получатель открывает «Аналитику службы» → «Напоминания об отставших»; экран читает `GET /api/operations/notifications/` и доклеивает имена подразделений из дерева светофора.
10. Получатель отмечает уведомление прочитанным (`POST /api/operations/notifications/{id}/read/`); счётчик непрочитанных уменьшается.

## Alternative Flow
- **AF1. Замок занят другим прогоном**: шаг 2 → прогон пропущен, вывод «замок держит другой прогон», код 0.
- **AF2. Часы позади знака** (`today < watermark`): остановка `clock_behind_watermark`, `CommandError`, ненулевой выход, знак не сдвинут.
- **AF3. Разрыв больше 366 дней**: остановка `gap_exceeds_sanity`, `CommandError`.
- **AF4. До контрольного часа при догнанном знаке**: холостой проход, знак не двигается.
- **AF5. У отстающего нет получателя**: `logger.warning`, подразделение пропущено, остальные оповещаются.
- **AF6. `notify()` вернул None (сбой БД/сериализации)**: `LaggingNotifyError`, транзакция дня откатывается, знак остаётся на предыдущем дне; следующий прогон повторит день.
- **AF7. Повторный прогон того же дня**: строка найдена `get_or_create`, дубликата нет, получатель посчитан в «охвачено».
- **AF8. `--today` в будущем или нечитаемый**: `CommandError` до запуска.
- **AF9. Обход блокировки на дату записан**: уведомление всё равно уходит (обход снимает замок, не факт отставания).
- **AF10. Канальный слой недоступен**: `logger.exception`, знак в сокет не уходит, строка и возврат `notify()` не меняются.

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `OpsNotification` | create | `recipient`, `kind=SUBMISSION_LAGGING`, `business_date`, `payload.laggard_division_ids` |
| `OpsNotification.read_at` | update | по `POST …/read/`, `read-all` |
| `OpsWatermark` (`lagging_submissions`) | create/update | заведение на вчера; сдвиг на пройденный день |
| WS-группа получателя (Channels) | send | `NOTIFY_MESSAGE_TYPE` по коммиту, если `OPS_WS_ENABLED` |
| `ops_submission_control_settings`, `ops_division_notify_recipients`, `ops_daily_submissions` | read | обязанные, получатели, действующие сдачи |
| Почта / SMS / внешние каналы | send | `Не реализовано в коде` |

## Бизнес-требования (BR)
- **BR1.** Отстающее = подразделение из `required_division_ids` без действующей сдачи за день; вытесненная поправкой версия не считается.
- **BR2.** День проверяется только после своего контрольного часа (граница строгая).
- **BR3.** Одно уведомление на получателя за день; несколько отстающих одного получателя — один payload.
- **BR4.** Получатель на подразделение один (`unique division_id`), непустой; пусто у общего дежурного — законное «дежурного нет».
- **BR5.** Работа идемпотентна и переживает простой: догон от водяного знака, порция 31 день, порог здравого смысла 366 дней.
- **BR6.** Сбой записи уведомления откатывает день целиком; знак не уходит за неоповещённый день.
- **BR7.** Первый запуск не рассылает задним числом.
- **BR8.** Лента уведомлений — своя для каждого получателя, гейт — аутентификация, не право.
- **BR9.** Обход блокировки завтра не отменяет уведомления.

## Требования к логированию
- Console-логгер `lagging_check.py` (`logging.getLogger(__name__)`): `info` «поиск отставших уже идёт; прогон пропущен», `error` «часы позади водяного знака…» / «разрыв… больше порога…» с `extra` (watermark, today, gap_days), `warning` «у отстающего подразделения нет получателя уведомлений» (division_id, business_date).
- `notify_service.py`: `logger.exception` при сбое записи (`notify() не сработал: получатель=… вид=… дата=…`) и при сбое публикации в канальный слой.
- Вывод команды в stdout: итог прогона / пропуск; `CommandError` при остановке.
- Журнал раздела (`audit_service`) событие рассылки не пишет; HTTP-аудит не участвует (не HTTP). Запись факта рассылки в `ops_audit_log` — `Не реализовано в коде`.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| Оператор сервера / планировщик | запуск команды | доступ к `manage.py`; прав раздела команда не проверяет |
| ADMIN (Django superuser/staff) | настройка контрольного часа, обязанных подразделений, получателей | Django Admin (`OpsSubmissionControlSettingsAdmin`, `OpsDivisionNotifyRecipientAdmin`) |
| Любой аутентифицированный | своя лента, отметка прочитанным | `NotificationViewSet` — гейт аутентификация, фильтр по `recipient = actor` |
| Роли со `status.view` | имена подразделений в ленте | `useTrafficLightTree` под `status.view` |

## Требования к UX/UI
- «Аналитика службы» (`/security-ops/analytics`) → секция «Напоминания об отставших»: подпись «Уходят ответственным автоматически после контрольного часа HH:MM — одно за день.», бейдж числа непрочитанных, строки с деловой датой и именами отставших подразделений (или id, если имён нет), кнопка отметки прочитанным; состояния загрузки/ошибки.
- Настройка получателей, обязанных подразделений и контрольного часа — только Django Admin; в портале `Нет пользовательского интерфейса`.

## Открытые вопросы
- Расписания запуска нет: `CELERY_BEAT_SCHEDULE` отсутствует, Celery-обёртки у команды нет намеренно («обёртку задачи и расписание кладёт отдельный срез») — без внешнего cron уведомления не уходят.
- Внешних каналов (почта, SMS, push) нет — только строка в БД и WS-знак при `OPS_WS_ENABLED`.
- Получатель — плоская строка `recipient` (`str(User.pk)`), справочник ведётся вручную в Admin; API/экрана для `OpsDivisionNotifyRecipient` и `OpsSubmissionControlSettings` нет.
- Секция ленты живёт на «Аналитике службы» (гейт `analytics.view`), а получатель — начальник управления (`DIRECTORATE_HEAD`), у которого `analytics.view` нет: лента ему в портале недоступна, хотя ручка открыта по аутентификации.
- Название файла `watermark.py` в брифе — это шлюз водяного знака догона, не водяной знак документа.
