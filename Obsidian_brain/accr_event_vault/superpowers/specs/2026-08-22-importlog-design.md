# ImportLog — durable-лог автоимпорта (hd-3-1 / gap §3.4)

> **Тип:** bounded design (see [[accreditation-gap-analysis]] §3.4, `Critical`).
> **Статус:** РЕАЛИЗОВАНО 2026-08-22 (частично — только ImportLog-модель и её
> запись; retry/backoff — hd-3-2, cron-lock — hd-3-3, обе отдельные истории, backlog).

## Проблема

Автоимпорт (KazEnergy/Avalon) делал ACK, но не хранил неуспешные анкеты — нет лога
ошибок и ретраев. Битая/неполная анкета терялась молча: только stdout-логгер, без
возможности разобрать/повторить после сбоя.

## Решение

Новая модель `ImportLog` (`eventproject/models.py`, migration `0033_importlog`):
`source`, `event` (nullable), `external_id`, `status` (success/duplicate/
validation_error/save_error/upstream_error), `error_message`, `raw_payload`
(JSONField), `attempts` (задел под hd-3-2, не используется пока), `created_at`.

`eventproject/services/import_log.py`:
- `sanitize_raw_payload()` — маскирует `iin` (`mask_iin`), выбрасывает
  `photo`/`docScan` (base64, не PII-безопасны для нешифрованного JSONField)
- `record_import()` — best-effort создание записи (try/except, никогда не
  бросает — тот же паттерн, что `audit_log`/`record_access_event`)

Встроено в **активный** cron-путь — `kazenergy_receive`
(`eventproject/views/integration/integrate_kazenergy.py`) — на всех развилках:
upstream GET failed/non-200, validation_error (missing fields), duplicate,
success, save_error. `kazexpo_receive` (Avalon) **не тронут** — он сейчас
закомментирован в `cron.py` (`# response = async_to_sync(kazexpo_receive)...`),
не используется в проде; провести туда же ту же схему — тривиально, когда
источник снова активируют.

## Итерация после code-review

Первая версия писала `raw_payload=attendee` (сырой словарь от источника) для
**всех** статусов, включая success/duplicate — полное ФИО, номер паспорта, дата
рождения оказывались в открытом (незашифрованном) JSONField неограниченно долго,
хотя эти данные уже лежат в `Attendee` (там же и Fernet-шифрование ИИН). Ревью
(`/code-review medium`, forked-агент) поймало это как реальную PII-находку —
второй небезопасный экземпляр PII без необходимости.

**Фикс:** `raw_payload` теперь пишется **только** для `validation_error`/
`save_error` (где он реально нужен для разбора/повтора) — не для `success`/
`duplicate`. Заодно исправлен баг `if raw_payload else None` (пустой `{}`
трактовался как falsy → писался `NULL` вместо `{}`) → `is not None`.

## Тесты

- `test_import_log.py` — unit (`sanitize_raw_payload`, `record_import`, best-effort
  no-raise на сбое БД, regression на пустой dict)
- `test_kazenergy_import_log.py` — интеграционные (мок `httpx.AsyncClient`) на все
  5 развилок `kazenergy_receive`: success (без raw_payload), validation_error (с
  raw_payload), duplicate (без raw_payload), upstream-error, save-error (с
  raw_payload)

Полный прогон: **697 тестов OK** (9 skip, Postgres-only на SQLite). Миграция
чистая (`makemigrations --check` — без изменений).

## Не в скоупе (отдельные истории)

- `hd-3-2` — retry/backoff (Celery) + dead-letter для ручного разбора
- `hd-3-3` — cron-lock (защита от параллельного запуска импорта)
- Wiring в `kazexpo_receive` (Avalon) — не активен в проде сейчас

## Связанные заметки

- [[accreditation-gap-analysis]] — §3.4
