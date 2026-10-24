# Cron-lock против параллельного автоимпорта (hd-3-3)

> **Тип:** bounded design (примыкает к [[accreditation-gap-analysis]] §3.4, вместе с [[ImportLog]]).
> **Статус:** РЕАЛИЗОВАНО 2026-08-22.

## Проблема

`django-crontab` гоняет `kazexpo_import_job` каждые 2 минуты (`settings.CRONJOBS`).
Сам импорт — сетевой постраничный цикл к внешнему API (KazEnergy) и может занять
дольше интервала. Без лока два параллельных запуска работали бы над одной
очередью источника и одной Request-категорией — риск двойной обработки анкет.

## Решение

`eventproject/cron.py`: `cache.add(CRON_LOCK_KEY, lock_token, timeout=600)` перед
запуском (`kazexpo_import_job`), снятие в `finally`. `lock_token` — `uuid4().hex`
на каждый запуск.

Побочный фикс: `eventproject/views/file_download.py` импортировал `logger` из
`eventproject.cron` — рабочий, но хрупкий цикл (`views/__init__.py` →
`file_download.py` → `cron.py` → `views.integration.integrate` → снова
`eventproject.views`), который ронялся, как только что-то импортировало
`eventproject.cron` раньше, чем пакет `eventproject.views` (ровно это сделал
новый тест). Заменено на собственный `logging.getLogger("eventproject")`
(стандарт проекта, см. `views/views.py`/`audit.py`) — цикл разорван полностью.

## Итерация после code-review

Ревью (`/code-review medium`, forked-агент) нашло 2 проблемы:

1. **Реальный баг** — `finally: cache.delete(CRON_LOCK_KEY)` снимал лок
   безусловно по ключу. Если запуск переживает TTL (600с), следующий тик
   успевает взять лок первым; когда переживший TTL запуск наконец завершается,
   его `finally` удаляет уже **чужой** (более свежий) лок — гонка, которую лок
   должен был предотвращать, могла произойти именно в overrun-сценарии.
   **Фикс:** owner-token — `finally` снимает лок только если
   `cache.get(key) == свой_token`.
2. Комментарий утверждал «Redis-лок», хотя `settings.CACHES` — `DatabaseCache`
   (Redis в проекте используется для Celery/сессий, не для `CACHES`).
   **Фикс:** комментарий исправлен на факт.

## Тесты

`test_cron_import_lock.py` (5): штатный abort (`DoesNotExist`) снимает лок;
непредвиденное исключение всё равно снимает лок (finally); параллельный вызов
при живом локе не трогает БД; TTL передаётся `cache.add`; **owner-token не
даёт снять чужой (более свежий) лок** — прямое покрытие ревью-находки.

Полный прогон: **702 теста OK** (9 skip).

## Связанные заметки

- [[importlog-design]] (hd-3-1) — тот же эпик hd-3, тот же файл `cron.py`
- [[accreditation-gap-analysis]] — §3.4
