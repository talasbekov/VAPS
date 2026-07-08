# Спайк 6.6 — асинхронность по необходимости (замер генерации Расхода)

**Тип: мерительный спайк (семья 1.9 / 1.10 / 3.13).** Первичный продукт — ЗНАНИЕ:
дурабельный артефакт с числами + вердиктом (`TIMING.md`), а НЕ прод-код.
Измерительный аппарат (`benchmark.py`) одноразовый.

## Зачем

`architecture.md:49/466/624` и `NFR-4` предполагают асинхронную генерацию документов
(Celery + `AsyncJob(202+поллинг)`). Story 6.5 оставила `issue_expense_document`
СИНХРОННЫМ by design и передала эстафету: «Асинхронность/AsyncJob/замеры → 6.6».

Эта стори проверяет допущение **числами** (Принцип отсечения механизмов,
`architecture.md:91-99`): пока сгенерённый документ отдаётся быстрее интерактивного
бюджета одного HTTP-POST, монолит НЕ тащит Celery/Redis/worker/beat ради воображаемой
нагрузки. Async становится решением по измерению, а не по умолчанию.

## Что дурабельно, что одноразово

| Файл | Роль | Судьба |
|---|---|---|
| `TIMING.md` | **Дурабельное решение** — числа + порог + вердикт + гейт path A/B | забирается в Decision Register (`ARCH-DEFERRED-048`) и `deferred-work.md` |
| `benchmark.py` | Одноразовый измерительный аппарат | удаляется вместе с каталогом |
| `README.md` | Этот файл | удаляется вместе с каталогом |

**Правило (канон 1.10 / 3.13):** каталог `spikes/6.6-async-timing/` удаляется ПОСЛЕ
того, как решение забрано в Decision Register (`architecture.md`) и `deferred-work.md`.
До удаления — источник обоснования дефера.

## Как запустить бенчмарк

Нужна живая мигрированная Postgres (те же координаты, что у гейта — `docker compose
up -d --wait db`, порт 5433). Модели используют Postgres-специфику (DateRangeField,
GiST, GeneratedField, ExclusionConstraint) — SQLite не подходит.

```bash
cd Backend/VAPS
docker compose up -d --wait db
# один раз — довести dev-БД до head (данные бенчмарка всё равно откатываются):
VAPS_DB=postgres VAPS_DB_NAME=vaps VAPS_DB_USER=vaps VAPS_DB_PASSWORD=vaps \
  VAPS_DB_HOST=localhost VAPS_DB_PORT=5433 .venv/bin/python manage.py migrate

# сам замер:
VAPS_DB=postgres VAPS_DB_NAME=vaps VAPS_DB_USER=vaps VAPS_DB_PASSWORD=vaps \
  VAPS_DB_HOST=localhost VAPS_DB_PORT=5433 \
  .venv/bin/python ../../spikes/6.6-async-timing/benchmark.py
```

Бенчмарк:
- синтезирует дерево подразделений (~5000 сотрудников) прямым ORM `bulk_create`
  (`factory_boy` в проекте НЕ установлен — Ловушка №7 стори);
- меряет ЧИСТОЕ ядро `build_expense_document`→`generate_expense_docx` (≥30 прогонов,
  p50/p95/max nearest-rank), все 4 генератора, и стоимость свода
  (`StrengthReportService.compute` по поддереву + одноразовый N-строчный адаптер);
- калибрует полный синхронный `issue_expense_document` (1 прогон);
- ВСЁ в `transaction.atomic()` + rollback — прод/dev-БД остаётся чистой; единственный
  побочный файл (attachment полного выпуска) удаляется бенчмарком;
- печатает машинно-читаемый блок чисел — вставляется в `TIMING.md`.

## Границы (что спайк НЕ делает)

- НЕ строит `AsyncJob`/Celery/`/api/jobs`/HTTP 202/worker/beat — это наследник по
  триггеру (см. `TIMING.md` вердикт).
- НЕ строит прод-генератор свода/многострочного документа (зона 6.10) — свод меряется
  ПО КОМПОНЕНТАМ (реальный `compute`/`derive` + одноразовый адаптер в `benchmark.py`).
- НЕ трогает прод-код `apps/` (ветка «синхронно»), не эмитит `DOCUMENT_GENERATED`,
  не вводит §34.1-таймстамп-имя, не резолвит контракт состояний AsyncJob §82.4.
