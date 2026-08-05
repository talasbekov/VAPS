"""Шлюз водяного знака (порт apps/core/watermark.py из Backend/VAPS).

Только доступ к данным. ПОЛИТИКА догона — план дней, замок, порог здравого
смысла, размер порции — живёт в самом движке, а арифметика дат в
`clock.catchup_plan`. Здесь ровно две операции, и разделены они не для красоты:
«завести знак впервые» и «сдвинуть знак вперёд» — разные события. Первое
означает «работа никогда не шла, историю назад не отматываем», второе — «день
пройден». Один общий `update_or_create` слил бы их, и каждый запуск после
простоя молча перезаводил бы знак сегодняшним днём, съедая пропущенные дни.
"""
from organization_management.apps.operations.models_watermark import OpsWatermark


def get_or_bootstrap(key, *, default_date):
    """Вернуть (последний обработанный день, заведён_ли_сейчас) для `key`.

    Отсутствующий знак заводится на `default_date` — у модели дефолта нет
    намеренно, откуда начинать решает работа. `created=True` приходит ТОЛЬКО в
    момент первого заведения; вызывающий читает его как «свежая выкатка, задним
    числом ничего не догоняем».

    Дата существующей строки НЕ трогается: знак двигает только advance().
    """
    wm, created = OpsWatermark.objects.get_or_create(
        key=key, defaults={"last_materialized_date": default_date}
    )
    return wm.last_materialized_date, created


def advance(key, *, to_date):
    """Сдвинуть знак `key` на `to_date` (и обновить updated_at).

    Знака нет — DoesNotExist, а не тихое заведение: двигать вперёд можно лишь
    то, что уже заведено. Молчаливое создание здесь скрыло бы порядок вызовов
    (advance до bootstrap) и завело бы знак сразу на пройденный день, потеряв
    признак «первый запуск».
    """
    wm = OpsWatermark.objects.get(key=key)
    wm.last_materialized_date = to_date
    wm.save(update_fields=["last_materialized_date", "updated_at"])
