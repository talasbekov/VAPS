# hd-1-4 — Экспорт: устранение N+1 и сокращение удержания row-lock

Дата: 2026-08-22 · Story: hd-1-4-export-no-n1-streaming · Ветка: `security-hardening`

## 1. Проблема

Отложено из code-review hd-1-2 (`deferred-work.md`):

> **[Med — tracked hd-1-4] Row-lock удерживается на всём построении payload**
> [`eventproject/views/file_download.py:362-374` (×3 set-эндпоинта)] — под локом:
> per-attendee `_media_url` → `storage.exists()` ×2 (диск-syscall), **N+1 по
> Attendee**, `json.dumps`. Конкурент ждёт всё время сборки, не только пометку.

При разборе найден **второй, не отмеченный ранее N+1 — в современном
delta-пути** (`services/export.py::select_new_attendees` идёт без
`select_related`, а `build_export_object` читает `attendee.request.event_id`,
`attendee.request.event.event_code`, `attendee.category.name`) → до **3N**
дополнительных SELECT на экспорт. Это горячий путь Integration Spec v1.1,
он же CSV-выгрузка Face ID.

Измеримые дефекты:

| # | Путь | Дефект | Стоимость |
|---|------|--------|-----------|
| D1 | легаси `download_json` / `download_guests_json` / `download_all_guests_json` | `Attendee.objects.filter(request=req)` внутри цикла по заявкам | N+1 SELECT **под `select_for_update`** |
| D2 | те же 3 эндпоинта | `req.save()` на каждую заявку | N UPDATE вместо одного |
| D3 | современный `export_delta` (JSON+CSV) | нет `select_related` → лениво тянутся `request`, `request.event`, `category` | до 3N SELECT (вне лока, но на каждый экспорт) |

## 2. Решение

### D1 — один запрос вместо N+1 (легаси)

Новый хелпер в `views/file_download.py`:

```python
def _build_attendees_payload(reqs, dir_names, request):
    """Whitelist-объекты участников всех заблокированных заявок — ОДНИМ запросом."""
```

Порядок вывода сохраняется побайтово: внешний цикл по `reqs` (уже
`order_by("pk")`), внутри — участники в порядке `pk` (совпадает с прежним
дефолтным порядком БД).

### D2 — одна пометка вместо N (легаси)

`Request.objects.filter(pk__in=ids).update(status="Exported")` вместо
`req.save()` в цикле. Безопасно: `Request.save()` (hd-5.2) выполняет `clean()`
**только на создании** (`self._state.adding`), на update — чистый
`super().save()`; `auto_now`-полей у модели нет; сигналов на `Request` нет.

### D3 — `select_related` в современном пути

`select_new_attendees` → `.select_related("request__event", "category")`.
Изменение чисто исполнительное: набор строк и порядок (`order_by("id")`) те же.

## 3. Что СОЗНАТЕЛЬНО не делается

**Streaming JSON-ответа (вторая половина названия истории) — отклонён.**
Причина: hd-1-5 (SHA-256-манифест, gap §3.10) добавил заголовок
`X-Content-SHA256` на все 5 однофайловых JSON/CSV-эндпоинтов. Заголовки уходят
клиенту **до** тела, поэтому хеш всего тела обязан быть вычислен заранее —
`StreamingHttpResponse` физически несовместим с уже поставленной гарантией
целостности. Целостность выгрузки для эстафеты в госорган важнее пиковой памяти
на метаданных. Крупный поток (фото/сканы) и так не буферизуется: он идёт
`FileResponse` с диска (`download_photos`, `export_delta` ZIP), в память не
попадает. Payload JSON — только метаданные участников (~1 КБ/участник).

**Перенос построения payload за пределы `transaction.atomic`** — отклонён.
Это убрало бы `storage.exists()`-syscalls из-под лока, но разорвало бы
инвариант hd-1.2/1.3 «заявка помечена Exported ⟺ клиент получил payload»:
исключение при сборке после коммита оставило бы заявки помеченными без выдачи
данных (безвозвратно потерянная выгрузка). Сокращаем удержание лока тем, что
дёшево и безопасно (D1+D2); дисковую проверку медиа оставляем внутри.

**Attendee-TOCTOU под Request-локом** (`[Low]` из того же деферред-списка) — не
трогаем: pre-existing check-then-act уровня участника, лечится не здесь, а
пересмотром гранулярности лока (кандидат отдельной истории).

## 4. Проверка

- `assertNumQueries` как прямое доказательство: число запросов легаси-экспорта
  **не растёт** с числом заявок (2 заявки vs 5 заявок — одинаковый счётчик).
- `assertNumQueries` на `export_delta`: не растёт с числом участников.
- Регрессия по содержимому: побайтово тот же JSON, те же статусы, тот же аудит
  (существующие `test_export_whitelist.py` / `test_export_views.py` /
  `test_export_reexport.py` / `test_export_delta.py` / `test_export_concurrency.py`).

## 5. Итог ревью (независимый агент, 2026-08-22)

Функциональных дефектов, ломающих hd-1.1/1.2/1.3/1.5, не найдено (проверено в т.ч.
мутационно: откат каждой из правок D1/D2/D3 роняет новые тесты). Применено:

- **[Important] Тест не удерживал `select_related("category")`** — фикстура не
  проставляла категорию, а оба билдера короткозамкнуты
  (`attendee.category.name if attendee.category_id`), поэтому при `category=None`
  ленивый SELECT не происходил вовсе и мутация «убрать category» проходила молча.
  Исправлено: категория проставляется каждому участнику (`get_or_create` —
  `(event, name)` уникальна). Перепроверено мутацией: теперь падают 4 теста.
- **[Minor]** Убраны мёртвые `list_of_attendees = []` / `exported = 0` (×3).
- **[Minor]** `_mark_requests_exported` возвращает rowcount самого `UPDATE`, а не
  `len(reqs)` — число в аудите стало измеренным, а не заявленным.
- **[Minor]** После bulk-update синхронизируется `req.status` в памяти — мина под
  будущего читателя (выгрузил бы «Sent» для уже Exported-заявки).
- **[Minor] `IN`-список без потолка** — не чиним, документируем границу в
  docstring: на Postgres (прод) 65535 недостижим, заявки = категории (десятки).

Подтверждено ревью отдельно: `exported_by` не заполнялся и прежним кодом
(pre-existing gap, `build_legacy_request_dict` всегда отдаёт `null`) — не регрессия
этой истории.
