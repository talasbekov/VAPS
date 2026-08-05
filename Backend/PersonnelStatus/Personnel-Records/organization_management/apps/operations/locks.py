"""Консультативный замок процессов (порт apps/core/locks.py из Backend/VAPS).

Взаимное исключение ЦЕЛОГО фонового прогона, а не одной транзакции. Догон
коммитит ДЕНЬ ЗА ДНЁМ — это его способ пережить сбой на середине, — поэтому
замок обязан пережить коммит. И `select_for_update`, и `pg_advisory_xact_lock`
отпускают на первом же коммите: второй запуск вошёл бы со второго дня и
применил бы эффекты повторно.

Отсюда СЕАНСОВЫЙ `pg_advisory_lock`: он держится до явного отпускания (или до
закрытия соединения) и накрывает весь многотранзакционный прогон. Замок
консультативный — он ничего не запирает в таблицах, о нём договариваются только
сами работы, и ключ у каждой работы свой.

Только PostgreSQL: консультативные замки — его особенность. Раздел и так живёт
на нём (ExclusionConstraint против пересечения статусов).
"""
import logging
from contextlib import contextmanager

from django.db import connection

logger = logging.getLogger(__name__)


@contextmanager
def advisory_lock(key, *, blocking=True):
    """Держать сеансовый консультативный замок `key` (стабильное целое).

    Внутрь приходит True, пока замок держит ЭТОТ сеанс. При blocking=False и
    занятом замке — False СРАЗУ, без ожидания: вызывающий сам решает, что
    делать (фоновая работа пропускает прогон, а не выстраивается в очередь
    вторым, чтобы через минуту пройти по уже пройденным дням).

    Отпускается ВСЕГДА в finally — но только если брали здесь: чужой замок
    отпускать нельзя, pg_advisory_unlock снял бы его у соседнего сеанса.

    Взятие и отпускание идут по ОДНОМУ соединению (потоковое соединение
    Django) — иначе пара lock/unlock не сходится и замок остаётся висеть до
    закрытия соединения.
    """
    if blocking:
        with connection.cursor() as cur:
            cur.execute("SELECT pg_advisory_lock(%s)", [key])
        acquired = True
    else:
        with connection.cursor() as cur:
            cur.execute("SELECT pg_try_advisory_lock(%s)", [key])
            acquired = cur.fetchone()[0]
    try:
        yield acquired
    finally:
        if acquired:
            with connection.cursor() as cur:
                cur.execute("SELECT pg_advisory_unlock(%s)", [key])
