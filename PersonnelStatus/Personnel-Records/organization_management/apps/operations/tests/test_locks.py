"""Консультативный замок: занят ли, отпускается ли и переживает ли КОММИТ.

Занятость проверяется вторым, НАСТОЯЩИМ соединением к той же тестовой БД:
консультативные замки считаются по сеансам, и внутри одного сеанса замок
берётся повторно (счётчиком) — «занято» на своём же соединении не наблюдается
вовсе. Тест в один сеанс был бы зелёным при любой реализации.

Главный тест здесь — последний: замок обязан пережить коммит. Догон коммитит
день за днём, и `pg_advisory_xact_lock` (или select_for_update) отпустил бы на
первом же дне, впустив второй прогон с середины.
"""
import pytest
from django.db import connection, transaction
from django.db.backends.postgresql.base import Database

from organization_management.apps.operations.locks import advisory_lock
from organization_management.apps.operations.models_watermark import OpsWatermark

KEY = 0x56415053
OTHER_KEY = 0x5641474C


class Outsider:
    """Второй сеанс к той же БД — «чужой прогон»."""

    def __init__(self):
        # Драйвер берётся у самого Django (Database), а не импортом psycopg
        # по имени: версия драйвера — дело окружения, а не теста.
        params = connection.get_connection_params()
        for driver_only in ("cursor_factory", "context", "row_factory"):
            params.pop(driver_only, None)
        self.conn = Database.connect(**params)
        self.conn.autocommit = True

    def try_lock(self, key):
        with self.conn.cursor() as cur:
            cur.execute("SELECT pg_try_advisory_lock(%s)", [key])
            return cur.fetchone()[0]

    def unlock(self, key):
        with self.conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_unlock(%s)", [key])

    def close(self):
        self.conn.close()


@pytest.fixture
def outsider():
    other = Outsider()
    yield other
    other.close()


@pytest.mark.django_db
def test_the_lock_is_held_inside_the_block_and_released_after(outsider):
    with advisory_lock(KEY) as acquired:
        assert acquired is True
        assert outsider.try_lock(KEY) is False

    assert outsider.try_lock(KEY) is True
    outsider.unlock(KEY)


@pytest.mark.django_db
def test_a_free_lock_is_taken_without_waiting(outsider):
    with advisory_lock(KEY, blocking=False) as acquired:
        assert acquired is True
        assert outsider.try_lock(KEY) is False

    assert outsider.try_lock(KEY) is True
    outsider.unlock(KEY)


@pytest.mark.django_db
def test_a_busy_lock_yields_false_instead_of_queueing(outsider):
    """Занято — сразу False, а не очередь.

    Фоновая работа должна ПРОПУСТИТЬ прогон: встав вторым, она через минуту
    прошла бы по уже пройденным дням.
    """
    assert outsider.try_lock(KEY) is True
    try:
        with advisory_lock(KEY, blocking=False) as acquired:
            assert acquired is False
    finally:
        outsider.unlock(KEY)


@pytest.mark.django_db
def test_each_job_locks_its_own_key(outsider):
    # Ключи у работ разные намеренно: догон эффектов и поиск отставших не
    # должны блокировать друг друга.
    assert outsider.try_lock(OTHER_KEY) is True
    try:
        with advisory_lock(KEY, blocking=False) as acquired:
            assert acquired is True
    finally:
        outsider.unlock(OTHER_KEY)


@pytest.mark.django_db
def test_the_lock_is_released_when_the_block_raises(outsider):
    # Упавший прогон не имеет права запереть работу до перезапуска процесса.
    with pytest.raises(RuntimeError):
        with advisory_lock(KEY):
            raise RuntimeError("прогон упал на середине")

    assert outsider.try_lock(KEY) is True
    outsider.unlock(KEY)


@pytest.mark.django_db(transaction=True)
def test_the_lock_survives_a_commit_inside_the_block(outsider):
    """Сеансовый замок, а не транзакционный — ради этого он и выбран.

    Внутри блока идёт НАСТОЯЩИЙ коммит (день догона). Транзакционный замок
    отпустил бы здесь, и второй прогон вошёл бы со второго дня.
    """
    try:
        with advisory_lock(KEY) as acquired:
            assert acquired is True
            with transaction.atomic():
                OpsWatermark.objects.create(
                    key="commit-probe", last_materialized_date="2026-08-01"
                )
            assert outsider.try_lock(KEY) is False

        assert outsider.try_lock(KEY) is True
        outsider.unlock(KEY)
    finally:
        OpsWatermark.objects.filter(key="commit-probe").delete()
