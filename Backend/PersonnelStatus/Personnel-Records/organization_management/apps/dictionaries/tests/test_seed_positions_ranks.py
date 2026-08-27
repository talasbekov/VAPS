"""Должности и звания: лестница, усыновление чужих строк, повтор, снос (№202).

Что стерегут пробы:

1. ЛЕСТНИЦА БЕЗ ДЫР И БЕЗ ПОВТОРОВ. `level` означает старшинство и по нему
   сортируются люди; дыра или два одинаковых уровня ломают порядок молча — на
   экране это выглядит как «отсортировано неправильно», а не как ошибка сида.
2. УСЫНОВЛЕНИЕ. На стенде уже есть «Инспектор» и «майор» с чужими кодами.
   Сид обязан взять их, а не завести вторых: два одинаковых имени в выпадающем
   списке человек различить не может.
3. ПОВТОР ничего не создаёт.
4. СНОС уносит только своё и не сиротит штатные единицы без `--force`.
"""
import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from organization_management.apps.dictionaries.models import Position, Rank
from organization_management.apps.divisions.models import Division
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

SEED = "SEED-"


def test_positions_and_ranks_form_a_ladder():
    call_command("seed_positions_ranks")

    ladder = list(
        Position.objects.filter(level__lt=90).order_by("level").values_list("level", "name")
    )
    assert [level for level, _ in ladder] == list(range(1, 10)), f"уровни должностей: {ladder}"
    assert ladder[0][1] == "Начальник департамента"
    assert ladder[-1][1] == "Дежурный"

    rank_levels = list(Rank.objects.filter(level__lt=90).order_by("level").values_list("level", flat=True))
    assert rank_levels == list(range(1, 11)), f"уровни званий: {rank_levels}"
    assert Rank.objects.get(level=1).name == "полковник"
    assert Rank.objects.get(level=10).name == "сержант"


def test_existing_row_is_adopted_not_duplicated():
    stranger = Position.objects.create(name="Инспектор", code="POS-6", level=3)
    stranger_rank = Rank.objects.create(name="майор", code="RANK-1", level=1)

    call_command("seed_positions_ranks")

    assert Position.objects.filter(name="Инспектор").count() == 1
    assert Rank.objects.filter(name="майор").count() == 1

    stranger.refresh_from_db()
    stranger_rank.refresh_from_db()
    assert stranger.code == "POS-6", "чужой код перезаписывать нельзя: на него могли сослаться"
    assert stranger.level == 8, "уровень усыновлённой строки встаёт в лестницу"
    assert stranger_rank.level == 3


def test_rows_outside_the_ladder_are_pushed_below_it():
    """Демо-строки миграции стоят на уровнях 1-3 — вровень с начальниками.

    Одинаковый уровень означает произвольный порядок в сортировке по
    старшинству: экран каждый раз разный, а причина невидима.
    """
    legacy = Position.objects.create(name="Director", code="POS-LEGACY", level=1)

    call_command("seed_positions_ranks")

    legacy.refresh_from_db()
    assert legacy.level >= 90
    assert legacy.name == "Director" and legacy.code == "POS-LEGACY"
    assert Position.objects.filter(level=1).count() == 1


def test_second_run_creates_nothing():
    call_command("seed_positions_ranks")
    before = (
        list(Position.objects.values_list("id", flat=True)),
        list(Rank.objects.values_list("id", flat=True)),
    )

    call_command("seed_positions_ranks")

    assert (
        list(Position.objects.values_list("id", flat=True)),
        list(Rank.objects.values_list("id", flat=True)),
    ) == before


def test_wipe_keeps_adopted_rows():
    stranger = Position.objects.create(name="Инспектор", code="POS-6", level=3)
    call_command("seed_positions_ranks")

    call_command("seed_positions_ranks", "--wipe")

    assert Position.objects.filter(code__startswith=SEED).count() == 0
    assert Rank.objects.filter(code__startswith=SEED).count() == 0
    assert Position.objects.filter(pk=stranger.pk).exists(), "усыновлённая строка не наша — снос её не трогает"


def test_wipe_refuses_to_orphan_staff_units():
    call_command("seed_positions_ranks")
    division = Division.objects.create(
        name="Первый отдел", code="D-1", division_type=Division.DivisionType.DIVISION
    )
    position = Position.objects.get(code=f"{SEED}POS-INSPECTOR")
    StaffUnit.objects.create(division=division, position=position, index=1)

    with pytest.raises(CommandError) as error:
        call_command("seed_positions_ranks", "--wipe")

    assert "штатных единиц: 1" in str(error.value)
    assert Position.objects.filter(pk=position.pk).exists()
