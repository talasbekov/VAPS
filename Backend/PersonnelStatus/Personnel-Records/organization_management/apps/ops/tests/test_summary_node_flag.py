"""Признак «собирает суточный свод» — факт с сервера (Plane №326).

Что было. Экран расхода УГАДЫВАЛ узел свода по форме дерева: брал
подразделение, чей родитель — корень, и у которого в поддереве больше всего
управлений расхода. Правило работало, пока департамент был один; на трёх оно
перестало давать однозначный ответ, и шаг цикла «собрать и отправить свод» не
проходился НИ ПОД КЕМ — ни у admin, ни у erda, ни у demo-учёток.

Догадка по косвенным признакам — тот же класс, что «департамент = нет
предков» (№307): признак верен ровно до первой структуры, под которую его не
подбирали.

Пробы держат два конца: признак ДОЕЗЖАЕТ до клиента в узле дерева (второй
ручкой он разъехался бы с деревом во времени) и по умолчанию НЕ ПРОСТАВЛЕН —
экран без настройки обязан вести себя как вёл.
"""
import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.selectors import DivisionTreeSelector

pytestmark = pytest.mark.django_db


def test_flag_is_off_by_default():
    """Новое подразделение свода не собирает.

    Умолчание `True` тихо назначило бы сводящими все 54 подразделения стенда, и
    экран начал бы спрашивать выбор там, где раньше отвечал сам.
    """
    division = Division.objects.create(name="Свежий департамент")

    assert division.is_summary_node is False


def test_selector_returns_only_flagged():
    organization = Division.objects.create(
        name="Служба", division_type=Division.DivisionType.ORGANIZATION
    )
    marked = Division.objects.create(
        name="Первый департамент",
        parent=organization,
        division_type=Division.DivisionType.DEPARTMENT,
        is_summary_node=True,
    )
    Division.objects.create(
        name="Второй департамент",
        parent=organization,
        division_type=Division.DivisionType.DEPARTMENT,
    )

    assert DivisionTreeSelector.summary_node_ids() == {marked.id}


def test_selector_narrows_to_the_asked_ids():
    """Сужение множеством: дерево светофора спрашивает признак только у узлов
    СВОЕГО ответа, и признак чужого узла в него попасть не должен."""
    organization = Division.objects.create(
        name="Служба", division_type=Division.DivisionType.ORGANIZATION
    )
    mine = Division.objects.create(
        name="Мой департамент", parent=organization, is_summary_node=True
    )
    alien = Division.objects.create(
        name="Чужой департамент", parent=organization, is_summary_node=True
    )

    assert DivisionTreeSelector.summary_node_ids([mine.id]) == {mine.id}
    assert alien.id not in DivisionTreeSelector.summary_node_ids([mine.id])
