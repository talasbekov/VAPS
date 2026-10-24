# Защита мероприятия от удаления при живых заявках (hd-5-8 / Story 5.8, FR-14)

> **Тип:** bounded design (see `_bmad-output/planning-artifacts/epics-hardening.md` Story 5.8).
> **Статус:** РЕАЛИЗОВАНО 2026-08-22.

## Проблема

`Request.event` был `on_delete=CASCADE` — удаление мероприятия с живыми
заявками молча каскадно стирало `Request` → `Attendee` (та же категория
ошибки, что `hd-5-7` нашла для `Operator`). `Event.parent` уже был `PROTECT`
(hd-5-1, защита иерархии), но защиты от удаления события С ЗАЯВКАМИ не было.

## Решение

`Request.event`: `CASCADE` → `PROTECT` (migration `0034_alter_request_event`).
Теперь ЛЮБОЕ удаление `Event` с живыми `Request` бросает `ProtectedError` на
уровне ORM — защищено сразу на всех путях.

Graceful-обработка `ProtectedError` (400 вместо 500) добавлена на **трёх**
живых путях удаления Event:

1. `delete_event` (легаси view) — проверка ДО `rmtree` медиа-директории (иначе
   при блокировке файлы уже стёрты, а строка `Event` осталась)
2. `EventViewSet.perform_destroy` (DRF) — `ProtectedError` → `DRFValidationError` (400)
3. `flush_outdated_events` (batch-очистка старых событий) — пропускает
   защищённое событие и продолжает batch (раньше общий `except Exception`
   останавливал ВЕСЬ batch на первом защищённом событии, при этом медиа
   текущего события уже были стёрты)

## Итерация после code-review

Ревью нашло, что диф пропустил `flush_outdated_events` — тот же паттерн
бага, что и в (1): `rmtree` до `.delete()`, плюс здесь ещё хуже — общий
`except Exception` в конце функции останавливал обработку ОСТАЛЬНЫХ
устаревших событий в batch при первом же `ProtectedError`. Исправлено:
`try/except ProtectedError` вокруг `.delete()` — при блокировке событие
пропускается (лог + счётчик), `rmtree` для него не выполняется, batch
продолжается для остальных событий.

## Тесты

- `test_csrf_deletes.py` — `test_delete_event_post_deletes` переименован в
  `test_delete_event_with_live_requests_blocked_not_cascaded` (существующий
  `setUp` уже создавал Event с живым Request — раньше тест ассертил успешное
  каскадное удаление, теперь ассертит блокировку) + новый тест на удаление
  события БЕЗ заявок (по-прежнему работает)
- `test_event_views.py` — 2 новых теста на DRF `EventViewSet.destroy`
  (блокировка при живой заявке / успех без заявок)
- `test_audit_action_coverage.py::EventDeleteAuditTests` — новый тест на
  `flush_outdated_events`: защищённое событие пропускается, остальные из
  batch всё равно удаляются

Полный прогон: **728 тестов OK** (9 skip). `makemigrations --check` — миграция
`0034` уже применена, дополнительных изменений не требуется.

## Связанные заметки

- hd-5-7 (`operator-soft-delete-design.md`) — тот же паттерн находки
  (physical-delete рядом с уже существующей защитой/soft-delete), тот же
  метод обнаружения (проверка каскадов `on_delete`)
