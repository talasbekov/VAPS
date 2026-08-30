"""Справочник секций бланка ведётся ШАБЛОНОМ, а не руками (Plane №242, Ш-2).

Почему это отдельная проба, а не строка в сиде. Роли наряда перечислены в коде
и это оправдано: их тринадцать и заказчик их обсуждает. Секций двадцать четыре,
подписи у них казахские, и меняются они вместе с бланком — каждый новый образец
заказчика пересобирает шаблон. Список, переписанный в код, разошёлся бы с файлом
МОЛЧА: человек выбрал бы при назначении секцию, которой в документе нет, и место
осталось бы пустым без объяснения.

Проба держит три конца: состав совпадает с шаблоном; повтор ничего не удваивает;
секция, исчезнувшая из шаблона, СНИМАЕТСЯ, а не удаляется — на неё могут
ссылаться назначения уже проведённых мероприятий.
"""
import pytest
from django.core.management import call_command

from organization_management.apps.operations.models_settings import OpsDictionaryEntry
from organization_management.apps.ops.documents_placement_full import template_sections

pytestmark = pytest.mark.django_db

DICTIONARY = "PLACEMENT_SECTIONS"


def sync():
    call_command("sync_placement_sections", yes=True)


def codes(active=True):
    rows = OpsDictionaryEntry.objects.filter(dictionary_code=DICTIONARY)
    if active:
        rows = rows.filter(is_active=True)
    return set(rows.values_list("code", flat=True))


def test_dictionary_matches_the_template():
    sync()

    assert codes() == {entry["code"] for entry in template_sections()}
    assert "ULAN_BATOR_KOSHPELI_KUZET" in codes()


def test_a_dry_run_changes_nothing():
    """Без `--yes` команда только рассказывает. Справочник трогать с первого
    запуска и без спроса — способ однажды переписать не тот стенд."""
    call_command("sync_placement_sections")

    assert OpsDictionaryEntry.objects.filter(dictionary_code=DICTIONARY).count() == 0


def test_a_repeat_does_not_duplicate():
    sync()
    before = OpsDictionaryEntry.objects.filter(dictionary_code=DICTIONARY).count()

    sync()

    assert OpsDictionaryEntry.objects.filter(dictionary_code=DICTIONARY).count() == before


def test_a_section_gone_from_the_template_is_retired_not_deleted():
    """Снятая секция остаётся строкой: на неё ссылаются старые назначения.

    Удаление стёрло бы вторую координату уже проведённых мероприятий задним
    числом — и документ по ним перестал бы собираться, а причина была бы не
    видна нигде.
    """
    sync()
    OpsDictionaryEntry.objects.create(
        dictionary_code=DICTIONARY,
        code="GONE_SECTION",
        label="«Снятая» секция",
        is_active=True,
    )

    sync()

    retired = OpsDictionaryEntry.objects.get(
        dictionary_code=DICTIONARY, code="GONE_SECTION"
    )
    assert retired.is_active is False, "секция удалена вместо снятия"


def test_a_changed_label_is_picked_up():
    """Бланк переверстали — подпись секции обязана поехать следом."""
    sync()
    entry = OpsDictionaryEntry.objects.filter(
        dictionary_code=DICTIONARY, code="ULAN_BATOR_KOSHPELI_KUZET"
    ).get()
    entry.label = "устаревшая подпись"
    entry.save(update_fields=["label"])

    sync()

    entry.refresh_from_db()
    assert entry.label == "«Ұлан-батор» көшпелі күзет"
