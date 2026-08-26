"""Пересчёт состояний паспорта у заведённых объектов (Plane №66, миграция 0049).

Миграция переносит РЕАЛЬНЫЕ данные: до неё поле `passport_state` ставилось
только при заведении объекта (всегда RED) и правилось руками у фикстуры
стенда. Проба проверяет перенос на трёх случаях сразу — иначе «миграция
отработала» значило бы «не упала».
"""
import pytest
from django.db.migrations.executor import MigrationExecutor
from django.db import connection

pytestmark = pytest.mark.django_db

BEFORE = ("operations", "0048_rated_participant_employee")
AFTER = ("operations", "0049_passport_state_backfill")


def migrate_to(target):
    executor = MigrationExecutor(connection)
    executor.loader.build_graph()
    executor.migrate([target])
    executor.loader.build_graph()
    return executor


@pytest.fixture
def at_0048():
    """Откатывает схему к состоянию ДО переноса и возвращает исторические модели."""
    executor = migrate_to(BEFORE)
    yield executor.loader.project_state([BEFORE]).apps
    # Возврат вперёд обязателен: следующая проба в этом же прогоне ждёт
    # актуальную схему, а не откатанную.
    migrate_to(AFTER)


def test_backfill_sets_three_states_by_the_documents(at_0048):
    OpsSecurityObject = at_0048.get_model("operations", "OpsSecurityObject")
    OpsObjectSector = at_0048.get_model("operations", "OpsObjectSector")
    OpsSecurityPost = at_0048.get_model("operations", "OpsSecurityPost")
    OpsPassportVersion = at_0048.get_model("operations", "OpsPassportVersion")

    def make(code, name, state="RED"):
        return OpsSecurityObject.objects.create(
            code=code,
            name=name,
            object_type="Учреждение",
            region="г. Астана",
            address="ул. Проверочная, 1",
            passport_state=state,
            # `object_state` — своё поле со своим ограничением БД: строки
            # пишутся мимо `full_clean`, и пустая строка не пройдёт.
            object_state="ACTIVE",
            ownership="GUARDED",
        )

    # 1) Пустой паспорт, но в поле стоит GREEN — ровно то, что дописывала
    #    руками фикстура стенда.
    empty = make("T-1", "Без постов", state="GREEN")
    # 2) Посты есть, версии нет — «требует доработки».
    drafted = make("T-2", "Только черновик")
    sector = OpsObjectSector.objects.create(
        security_object=drafted, name="Периметр", position=1
    )
    OpsSecurityPost.objects.create(
        sector=sector, name="Пост 1", task="Охрана", requirements="Допуск", position=1
    )
    # 3) Посты есть и версия совпадает с черновиком — «оформлен».
    published = make("T-3", "С версией")
    sector3 = OpsObjectSector.objects.create(
        security_object=published, name="Периметр", position=1
    )
    OpsSecurityPost.objects.create(
        sector=sector3, name="Пост 1", task="Охрана", requirements="Допуск", position=1
    )
    OpsPassportVersion.objects.create(
        security_object=published,
        version_number=1,
        effective_from="2026-08-01",
        published_at="2026-08-01T09:00:00Z",
        published_by="test",
        note="",
        sectors_snapshot=[{"name": "Периметр", "posts": [{"name": "Пост 1"}]}],
    )

    migrate_to(AFTER)

    assert OpsSecurityObject.objects.get(pk=empty.pk).passport_state == "RED"
    assert OpsSecurityObject.objects.get(pk=drafted.pk).passport_state == "YELLOW"
    assert OpsSecurityObject.objects.get(pk=published.pk).passport_state == "GREEN"
