"""Пересчёт состояний паспорта у заведённых объектов (Plane №66, миграция 0049).

Миграция переносит РЕАЛЬНЫЕ данные: до неё поле `passport_state` ставилось
только при заведении объекта (всегда RED) и правилось руками у фикстуры
стенда. Проба проверяет перенос на трёх случаях сразу — иначе «миграция
отработала» значило бы «не упала».

🔴 ПОЧЕМУ НЕ ЧЕРЕЗ `MigrationExecutor` (Plane №827, 06.09.2026).

Прежняя редакция добывала исторические модели честным путём — гоняла схему
общей тестовой базы НАЗАД до `operations/0048` и обратно вперёд. Это работало
ровно до тех пор, пока каждая миграция раздела была обратимой. С №758
(коммит `188f882a`) миграции 0091 и 0092 объявлены необратимыми, и такой откат
стал невозможен — но невозможен он ДОРОГО:

  • Django снимает миграции по одной и плана заранее не проверяет: он снял бы и
    зафиксировал 0097…0093 и упал `IrreversibleError` только на 0092;
  • возврат вперёд стоял ПОСЛЕ `yield` в фикстуре и потому не выполнился бы —
    ОБЩАЯ тестовая база осталась бы на схеме 0092, без `withdrawn_at`,
    `dedupe_key` и прочего, а в этом дереве её делят до пяти сессий. Весь
    остаток прогона поехал бы по сломанной схеме: «ВСЕ тесты файла красные
    разом на setup» — признак, который CLAUDE.md описывает как чужой pytest в
    базе, и следующая сессия пошла бы искать несуществующий дефект у себя.

Поэтому проба переведена на приём, уже принятый в проекте по этой же причине:
`operations/tests/test_visit_object_stage_backfill.py` (Plane №529) отказался от
`MigrationExecutor` со словами «миграция схемы внутри пробы уронила бы чужой
прогон» и подаёт ПОДСТАВНОЙ реестр. Здесь то же самое: проверяется РЕШЕНИЕ
миграции — какое состояние она назначит каждому из трёх объектов, — а не работа
ORM. Это её честная граница, и она названа вслух.

База пробе больше не нужна вовсе: `django_db` снят намеренно, и его отсутствие
— часть починки, а не экономия.
"""
from importlib import import_module

import pytest

migration = import_module(
    "organization_management.apps.operations.migrations.0049_passport_state_backfill"
)


class FakeQuerySet:
    """Ровно те звенья, которые зовёт миграция, и ни одного лишнего."""

    def __init__(self, rows):
        self._rows = list(rows)

    def all(self):
        return self

    def order_by(self, *fields):
        # Порядок здесь не важен: миграция сравнивает ФОРМУ (имена секторов и
        # постов), а фикстура подаёт её уже в нужном порядке. Подменять
        # сортировку значило бы проверять ORM, а не решение миграции.
        return self

    def values_list(self, field, flat=False):
        assert flat is True
        return FakeQuerySet([getattr(row, field) for row in self._rows])

    def first(self):
        return self._rows[0] if self._rows else None

    def iterator(self):
        return iter(self._rows)

    def __iter__(self):
        return iter(self._rows)


class FakePost:
    def __init__(self, name):
        self.name = name


class FakeSector:
    def __init__(self, name, posts):
        self.name = name
        self.posts = FakeQuerySet([FakePost(post) for post in posts])


class FakeVersion:
    def __init__(self, version_number, sectors_snapshot):
        self.version_number = version_number
        self.sectors_snapshot = sectors_snapshot


class FakeObject:
    def __init__(self, code, passport_state, sectors, versions):
        self.code = code
        self.passport_state = passport_state
        self.sectors = FakeQuerySet(sectors)
        self.passport_versions = FakeQuerySet(versions)
        self.saved_fields = []

    def save(self, update_fields=None):
        self.saved_fields.append(tuple(update_fields or ()))


class FakeApps:
    def __init__(self, rows):
        self._rows = rows

    def get_model(self, app_label, model_name):
        assert (app_label, model_name) == ("operations", "OpsSecurityObject")

        class Model:
            objects = FakeQuerySet(self._rows)

        return Model


@pytest.fixture
def objects():
    """Три случая правила `resolve_passport_state`, по одному на состояние."""
    return {
        # 1) Пустой паспорт, но в поле стоит GREEN — ровно то, что дописывала
        #    руками фикстура стенда.
        "empty": FakeObject("T-1", "GREEN", sectors=[], versions=[]),
        # 2) Посты есть, версии нет — «требует доработки».
        "drafted": FakeObject(
            "T-2",
            "RED",
            sectors=[FakeSector("Периметр", ["Пост 1"])],
            versions=[],
        ),
        # 3) Посты есть и версия совпадает с черновиком — «оформлен».
        "published": FakeObject(
            "T-3",
            "RED",
            sectors=[FakeSector("Периметр", ["Пост 1"])],
            versions=[
                FakeVersion(1, [{"name": "Периметр", "posts": [{"name": "Пост 1"}]}])
            ],
        ),
    }


def test_backfill_sets_three_states_by_the_documents(objects):
    migration.forwards(FakeApps(list(objects.values())), None)

    assert objects["empty"].passport_state == "RED"
    assert objects["drafted"].passport_state == "YELLOW"
    assert objects["published"].passport_state == "GREEN"


def test_backfill_saves_only_what_changed(objects):
    """Миграция не переписывает строки, у которых состояние и так верное.

    Это не украшение: перенос идёт по ВСЕМУ реестру, и лишний `save` на каждой
    строке — лишняя запись в журнал БД на боевой базе.
    """
    migration.forwards(FakeApps(list(objects.values())), None)

    assert objects["empty"].saved_fields == [("passport_state",)]
    assert objects["drafted"].saved_fields == [("passport_state",)]
    assert objects["published"].saved_fields == [("passport_state",)]

    # Второй проход — состояния уже верные, писать нечего.
    for row in objects.values():
        row.saved_fields.clear()
    migration.forwards(FakeApps(list(objects.values())), None)
    assert [row.saved_fields for row in objects.values()] == [[], [], []]


def test_shape_ignores_spaces_but_not_order():
    """Форма сравнивается по именам, а не по объектам снимка.

    `shape` — то место, где миграция решает «черновик совпал с версией».
    Пробел по краям имени не должен разводить состояния (данные заводили
    руками), а вот другой порядок постов — это другой паспорт.
    """
    same = migration.shape([{"name": " Периметр ", "posts": [{"name": "Пост 1 "}]}])
    assert same == migration.shape([{"name": "Периметр", "posts": [{"name": "Пост 1"}]}])

    swapped = migration.shape(
        [{"name": "Периметр", "posts": [{"name": "Пост 2"}, {"name": "Пост 1"}]}]
    )
    assert swapped != migration.shape(
        [{"name": "Периметр", "posts": [{"name": "Пост 1"}, {"name": "Пост 2"}]}]
    )
