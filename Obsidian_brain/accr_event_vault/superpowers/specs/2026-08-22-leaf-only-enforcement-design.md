# Leaf-only enforcement для Request (hd-5-2 / Story 5.2, FR-22)

> **Тип:** bounded design (see `_bmad-output/planning-artifacts/epics-hardening.md` Story 5.2).
> **Статус:** РЕАЛИЗОВАНО 2026-08-22.

## Проблема

`Event.is_container=True` — денормализованный признак контейнера (есть
под-мероприятия, hd-5-1). Участники/заявки должны крепиться только к
листовому событию — иначе roll-up по «большому» мероприятию молча теряет
участников (FR-22).

## Решение

`Request.clean()` (`eventproject/models.py`) — `self.event.is_container` →
`ValidationError`. `Request.save()` — вызывает `self.clean()` **только при
создании** (`self._state.adding`), не на каждый update. Единая точка: все
текущие пути создания `Request` вызывают `.save()` (форма ru/kz/en,
KazEnergy auto-import); `bulk_create` для `Request` нигде не используется.

Обработка `ValidationError` добавлена на всех точках создания:
`eventproject/views/request.py`, `kz_event/views.py`, `en_event/views.py`
(400 + текст ошибки) и `integrate_kazenergy.py`/`integrate.py` (400 JSON +
лог, `event.py` вариант — на неактивном kazexpo-пути, защита на случай
реактивации, тот же паттерн, что hd-3-1).

## Итерация после code-review

Первая версия вызывала `self.clean()` на **каждом** `save()`, не только при
создании. Ревью (forked-агент) нашло 3 связанных находки:

1. `file_download.py` (легаси JSON-экспорт) меняет `req.status = "Exported"` +
   `req.save()` внутри `select_for_update()` без `try/except ValidationError`
   — необработанный 500 внутри `transaction.atomic()` откатил бы **весь**
   батч экспорта, если у события флаг `is_container` выставлен уже ПОСЛЕ
   создания заявок.
2. `preview()`/`back_to_change()`/`send()` (легаси, ru/kz/en) меняют статус
   существующей заявки без такой обработки — тот же риск 500 на обычном
   переходе статуса.
3. **N+1 под локом**: `self.event.is_container` на каждый `save()` — доп.
   `SELECT Event`, продлевающий удержание `select_for_update()` в
   export-цикле.

**Фикс:** проверка инварианта только на `INSERT` (`self._state.adding`) —
семантически верно (AC говорит «создаётся Request», не «существует»),
устраняет все 3 находки разом: update-пути вообще не трогают `clean()`,
N+1 нет (только на создании, не в цикле по уже существующим строкам).
Заодно добавлен symmetric try/except в неактивный `kazexpo_receive`
(`integrate.py`) — дёшево, защита на случай реактивации.

## Тесты

`test_leaf_only_enforcement.py` (9): создание в контейнер/лист/standalone,
update существующей заявки (в т.ч. когда событие ПОСЛЕ создания заявки стало
контейнером — прямое покрытие ревью-находки), 3 легаси-view (ru/kz/en) → 400
не 500, kazenergy-путь → 400 + ImportLog не создаётся.

Полный прогон: **717 тестов OK** (9 skip). `makemigrations --check` — без
изменений (не новых полей, только методы).

## Не в скоупе

- Периодический data-quality assert (`Event.objects.filter(parent__parent__isnull=False)`
  всегда пуст) — уже держится по построению через `Event.clean()` (один
  уровень, hd-5-1); отдельная периодическая ops-проверка — не код-инвариант,
  не часть этой истории.

## Связанные заметки

- [[importlog-design]] (hd-3-1) — тот же паттерн: не трогаем неактивный kazexpo-путь
