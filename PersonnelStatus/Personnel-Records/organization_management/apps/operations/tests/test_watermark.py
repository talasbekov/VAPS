"""Водяной знак: заведение, сдвиг и то, чего он делать не должен.

Ограничения проверяются вставкой В БАЗУ, а не через full_clean: шлюз ходит
через get_or_create()/save(), которые валидацию модели не зовут, — инвариант
обязан жить на БД.

Главное здесь — РАЗДЕЛЬНОСТЬ двух операций. «Завести впервые» и «сдвинуть
вперёд» выглядят одинаково (в обеих строка получает дату), но означают разное:
первая — «работа никогда не шла», вторая — «день пройден». Слив их в один
update_or_create, догон после простоя молча перезаводил бы знак сегодняшним
днём и терял бы пропущенные дни — поэтому тесты бьют именно в перезапись.
"""
from datetime import date

import pytest
from django.db import IntegrityError, transaction

from organization_management.apps.operations import watermark
from organization_management.apps.operations.models_watermark import OpsWatermark

pytestmark = pytest.mark.django_db

KEY = "status_effects"
D1 = date(2026, 8, 1)
D2 = date(2026, 8, 2)


def test_the_first_call_creates_the_mark_at_the_given_day():
    value, created = watermark.get_or_bootstrap(KEY, default_date=D1)

    assert (value, created) == (D1, True)
    assert OpsWatermark.objects.get(key=KEY).last_materialized_date == D1


def test_a_repeated_call_returns_the_stored_day_and_does_not_move_it():
    """Второй запуск читает знак, а не перезаводит его.

    Именно здесь ломается update_or_create: default_date у него другой (свежие
    «сегодня»), и знак прыгнул бы вперёд, проглотив непройденные дни.
    """
    watermark.get_or_bootstrap(KEY, default_date=D1)

    value, created = watermark.get_or_bootstrap(KEY, default_date=D2)

    assert (value, created) == (D1, False)
    assert OpsWatermark.objects.get(key=KEY).last_materialized_date == D1


def test_created_is_true_only_at_the_very_first_creation():
    # Признак «свежая выкатка, историю назад не догоняем» обязан гаснуть после
    # первого запуска, иначе каждый прогон считал бы себя первым и не работал.
    assert watermark.get_or_bootstrap(KEY, default_date=D1)[1] is True
    assert watermark.get_or_bootstrap(KEY, default_date=D1)[1] is False


def test_advance_moves_the_mark_forward_in_the_database():
    watermark.get_or_bootstrap(KEY, default_date=D1)

    watermark.advance(KEY, to_date=D2)

    assert OpsWatermark.objects.get(key=KEY).last_materialized_date == D2


def test_advance_refreshes_updated_at():
    # updated_at — единственный след «работа сегодня вообще шла»; без него
    # застрявший догон не отличить от догона без работы.
    watermark.get_or_bootstrap(KEY, default_date=D1)
    before = OpsWatermark.objects.get(key=KEY).updated_at

    watermark.advance(KEY, to_date=D2)

    assert OpsWatermark.objects.get(key=KEY).updated_at > before


def test_advance_on_a_missing_mark_raises_instead_of_creating_one():
    """Двигать вперёд можно лишь заведённое.

    Тихое создание здесь завело бы знак сразу на пройденный день и стёрло бы
    признак «первый запуск»: работа больше никогда бы не узнала, что стартует
    с нуля.
    """
    with pytest.raises(OpsWatermark.DoesNotExist):
        watermark.advance("never-bootstrapped", to_date=D2)

    assert not OpsWatermark.objects.filter(key="never-bootstrapped").exists()


def test_two_jobs_keep_separate_marks():
    # Общий знак затянул бы одну работу за другой: у догона эффектов и у
    # поиска отставших разные горизонты.
    watermark.get_or_bootstrap("status_effects", default_date=D1)
    watermark.get_or_bootstrap("lagging_submissions", default_date=D1)

    watermark.advance("status_effects", to_date=D2)

    assert watermark.get_or_bootstrap("lagging_submissions", default_date=D2) == (
        D1,
        False,
    )


def test_the_key_is_unique_in_the_database():
    OpsWatermark.objects.create(key=KEY, last_materialized_date=D1)

    with pytest.raises(IntegrityError), transaction.atomic():
        OpsWatermark.objects.create(key=KEY, last_materialized_date=D2)


@pytest.mark.parametrize("blank", ["", "   "])
def test_a_blank_key_is_rejected_by_the_database(blank):
    """Пустой ключ означал бы «знак ни за чем».

    Две работы, обе забывшие ключ, поделили бы одну строку: каждая угоняла бы
    знак другой и пропускала бы дни соседа — молча, потому что unique на
    пустой строке как раз выполняется.
    """
    with pytest.raises(IntegrityError), transaction.atomic():
        OpsWatermark.objects.create(key=blank, last_materialized_date=D1)
