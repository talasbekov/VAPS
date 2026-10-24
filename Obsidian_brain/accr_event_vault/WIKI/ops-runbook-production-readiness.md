# OPS Runbook — Production-Readiness

> Сгенерировано: 2026-06-26. Для: владельца инфраструктуры / прод-деплоя.
> Контекст: код-долг production-readiness прохода закрыт (батчи A–G, чек-лист
> `_bmad-output/implementation-artifacts/remaining-debt-checklist.md`). Остаются
> **два операционных пункта**, которые нельзя выполнить в dev-контейнере —
> требуется прод-подобная инфраструктура и/или доступ к прод-БД.

| ID | Что | Блокирует | Где владелец |
|----|-----|-----------|--------------|
| **OPS-1** | Живой нагрузочный прогон 3000 пользователей | NFR5 `<5с@3000`, Story 1.7 (AC-1/2/3), дашборд 4.2 (AC-6) | этот runbook + `docs/WIKI/performance-backlog.md` |
| **OPS-2** | `SELECT DISTINCT status` на проде перед `migrate 0022` | безопасность backfill `Attendee.status` | этот runbook |

---

## OPS-2 — Проверка статусов перед `migrate 0022` (делать ПЕРВЫМ)

**Зачем.** Миграция `0022_backfill_attendee_status` переносит `Attendee.status` из
`Request.status` по карте `_STATUS_MAP`. Поле `Request.status` — свободный
`CharField` **без `choices`**, поэтому на проде могли накопиться исторические
значения, которых нет в коде. Неизвестные значения миграция оставляет в `draft`
(fail-safe) — но если такое значение должно было маппиться в `ready`/`exported`,
эти участники молча не попадут в delta-export. Проверка ловит это ДО миграции.

**Карта миграции `0022` (эталон для сверки):**

```
Active    → draft
Checking  → in_review
Sent      → ready
Exported  → exported
completed → exported
```

**Шаг 1 — снять фактические статусы на проде** (read-only, безопасно):

```sql
SELECT status, COUNT(*)
FROM eventproject_request
GROUP BY status
ORDER BY COUNT(*) DESC;
```

**Шаг 2 — сверить с картой.** Ожидаемый набор значений:
`{Active, Checking, Sent, Exported, completed, processing}`.
`processing` — транзитный статус импорта (`process_avalon_payload` ставит при
создании Request и тут же → `completed`); осознанно вне карты → fail-safe `draft`
корректен (застрявший mid-import нельзя экспортировать).

- ✅ **Если набор ⊆ ожидаемого** → миграция безопасна, выполнять `migrate`.
- ⚠️ **Если есть статус вне набора** (исторический/legacy) → НЕ мигрировать
  вслепую. Решить маппинг с Project Lead (Erda), при необходимости расширить
  `_STATUS_MAP` в `0022_backfill_attendee_status.py` ИЛИ выполнить точечный
  `UPDATE` до миграции. Зафиксировать решение.

**Шаг 3 — применить миграции** (после зелёной сверки):

```bash
python manage.py migrate eventproject
```

> Примечание: `0022` идемпотентна по набору значений (фильтр+update), но
> `RunPython.noop` на reverse — откат значений не восстановит. Снять бэкап БД
> перед прод-migrate по стандартной процедуре.

---

## OPS-1 — Нагрузочный прогон 3000 пользователей

**Канонический источник деталей:** `docs/WIKI/performance-backlog.md`
§«Still required before Story 1.7 can be signed off». Harness и runbook-комментарий
живут в `docs/load_tests/locustfile.py` (шапка файла). Ниже — операционная сводка.

### Предусловия стенда (ОБЯЗАТЕЛЬНО — иначе baseline недостоверен)

1. **Прод-подобный стек:** PostgreSQL + Redis (не SQLite, не locmem).
2. **HTTPS или settings-override.** `settings.py` задаёт
   `SESSION_COOKIE_SECURE=True`, `CSRF_COOKIE_SECURE=True`, `SECURE_SSL_REDIRECT`
   по умолчанию `True`. По `http://` куки не сохраняются и SSL-redirect ломает
   логин. Либо прогонять против **HTTPS**-стенда, либо выставить
   `SECURE_SSL_REDIRECT=False`, `SESSION_COOKIE_SECURE=False`,
   `CSRF_COOKIE_SECURE=False` для нагрузочного стенда.
3. **django-axes** (`AXES_FAILURE_LIMIT=10`) заблокирует единый тест-аккаунт с
   одного IP. Отключить axes на стенде ИЛИ завести пул аккаунтов/IP.
4. **Ratelimit** `POST /add_attendee/` = `20/h` на IP (`block=False` → 429).
   Поднять/снять лимит на стенде, иначе add_attendee упрётся в 429.

### Засев тестовых данных (env-переменные harness'а)

| Переменная | Назначение | Default |
|------------|-----------|---------|
| `TEST_USER` / `TEST_PASS` | тест-аккаунт оператора | `load_test_user` / `load_test_pass` |
| `TEST_REQUEST_ID` | валидный `Request` (категория) | `1` |
| `SEX_ID` | FK справочника пола | `1` |
| `COUNTRY_ID` | FK справочника страны | `1` |
| `DOCTYPE_ID` | FK справочника типа документа | `1` |

Создать заранее: `Event` + `Request` (→ `TEST_REQUEST_ID`), тест-аккаунт оператора,
и валидные FK-id справочников.

### Запуск

```bash
export TEST_USER=... TEST_PASS=... TEST_REQUEST_ID=... \
       SEX_ID=... COUNTRY_ID=... DOCTYPE_ID=...

locust -f docs/load_tests/locustfile.py --host https://<стенд> \
    -u 3000 -r 100 --run-time 5m --headless \
    --csv=docs/load_test_baseline_$(date +%Y-%m-%d)
```

### Критерии приёмки (что замерить)

- **p50 / p95 / p99** по 4 эндпоинтам при **0% spurious failures** (harness явно
  фейлит 302-на-логин, 403-CSRF, 200-error-page, 429-ratelimit — закрывает AC-1).
- **Redis cache hit rate** под нагрузкой (закрывает Story 1.7 AC-3).
- **Финальный вердикт NFR5** `<5с@3000` (закрывает Story 1.7 AC-2 и дашборд
  4.2 AC-6). Известные неиндексированные фильтры дашборда
  (`Q(photo="")|isnull`, `Q(docScan="")|isnull`) — кандидаты на индекс, если
  дашборд не укладывается в бюджет.

### После прогона

- Сохранить CSV-артефакты (`docs/load_test_baseline_<дата>*`).
- Обновить `docs/WIKI/performance-backlog.md`: проставить фактический вердикт NFR5
  (`nfr5_compliance.compliant` → `true`/`false` вместо `null`).
- Закрыть OPS-1 в `remaining-debt-checklist.md` и зафиксировать в
  `sprint-status.yaml` (Story 1.7 операционный остаток).

---

## OPS-3 — Регламент ротации ключей шифрования (hd-7-4, FR-21)

> Ключи изолированы от кода/репозитория — только env (`.env`/секрет-хранилище),
> обязательны (`require_env`, fail-fast при отсутствии — `eventproject/settings.py`).

### Fernet (`FERNET_KEYS`, шифрует `Attendee.iin`)

`django-fernet-fields` использует `cryptography.fernet.MultiFernet`: **шифрует
всегда ПЕРВЫМ ключом** списка `FERNET_KEYS`, расшифровывает — перебором всех
ключей по очереди. Ключи кешируются на `cached_property` поля один раз за
жизнь процесса — смена `FERNET_KEYS` требует **рестарта** процессов
(gunicorn/celery), а не просто правки `.env`.

**Процедура ротации:**
1. Сгенерировать новый ключ: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`.
2. В `.env`/секрет-хранилище — новый ключ **первым** в `FERNET_KEYS`, старый
   оставить вторым (переходный период): `FERNET_KEYS=<new>,<old>`.
3. Рестарт процессов (иначе кеш ключей в памяти старый).
4. `python manage.py reencrypt_iin` — перечитывает и пересохраняет
   `Attendee.iin` у каждой непустой записи; `save()` шифрует уже новым
   (первым) ключом. Батчами (`iterator`), безопасно повторять при сбое.
5. Убедиться, что вывод команды показывает ожидаемое число записей
   (`SELECT COUNT(*) FROM eventproject_attendee WHERE iin IS NOT NULL` — сверить).
6. Убрать старый ключ из `FERNET_KEYS` (`FERNET_KEYS=<new>`), снова рестарт.
7. Хранить старый ключ в архиве (не в `.env`) ещё один цикл бэкапов — на
   случай, если восстановление из старого бэкапа потребует расшифровки.

### HMAC (`HMAC_IIN_DEDUP_KEY`, зарезервировано под hd-6-2)

Сознательно **отдельный** от `FERNET_KEYS` ключ (компрометация одного не
даёт расшифровать/подделать по другому) — задел в `settings.py`, пока
опционален (`config(..., default=None)`, не через `require_env`), т.к.
дедуп по HMAC (hd-6-2) ещё не реализован. Когда реализуется:
- перенести чтение в `require_env` рядом с `FERNET_KEYS` (fail-fast);
- регламент ротации: смена ключа **инвалидирует все существующие HMAC-хеши**
  дедупа разом (HMAC, в отличие от Fernet, не поддерживает MultiFernet-подобный
  перебор при проверке — старые и новые хеши несравнимы) → потребуется
  management-команда пересчёта хешей по тому же паттерну, что `reencrypt_iin`,
  запускаемая ОДНИМ проходом сразу после смены ключа (окно, где дедуп неполон,
  должно быть коротким).

---

## Чек-лист закрытия

- [ ] **OPS-2** — `SELECT DISTINCT status` снят на проде, сверен с `_STATUS_MAP`,
      решение по неизвестным статусам зафиксировано → `migrate 0022` применён.
- [ ] **OPS-1** — стенд поднят, данные засеяны, прогон `-u 3000 -r 100 -t 5m`
      выполнен, p50/p95/p99 + cache-hit + вердикт NFR5 зафиксированы.
