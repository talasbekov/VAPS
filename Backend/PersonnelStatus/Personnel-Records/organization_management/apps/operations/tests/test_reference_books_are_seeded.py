"""Справочники раздела ОМ на чистой базе не остаются пустыми (Plane №208).

ЗАЧЕМ. Экраны раздела читают справочники, а не выдумывают значения: пустой
справочник даёт пустой выпадающий список, пустую вкладку и пустую аналитику —
причём экран при этом отвечает 200 и выглядит исправным. Инвентарь №199 показал,
что наполнение УЖЕ есть у всего, у чего есть читатель, — три команды сида
покрывают всё. Эта проба закрепляет достигнутое: справочник, который завтра
заведут и забудут засеять, перестанет быть тихой пустотой.

ЧТО СЮДА НЕ ВХОДИТ и почему. `OpsPassportFreshnessPolicy`,
`OpsSubmissionControlSettings` и `OpsDocumentSequence` — синглтоны с ленивым
созданием: их первая строка появляется при первом обращении со значениями по
умолчанию, и требовать их от сида значило бы требовать лишнего.

СПИСОК ЗАДАН РУКАМИ, а не собран автоматом «по имени модели»: «справочник» — это
роль в разделе, а не признак класса, и автомат либо пропустил бы `StatusType`,
либо потребовал бы наполнения от журналов и заявок.
"""
import pytest
from django.core.management import call_command

from organization_management.apps.operations.models import (
    OpsAnalyticsMetricDefinition,
    OpsAnalyticsPeriodPreset,
    OpsAttentionDetector,
    OpsCombatDutyType,
    OpsCombatRoute,
    OpsDictionaryEntry,
    OpsDutyConflictPolicy,
    OpsDutyType,
    OpsFeedbackRegistry,
    OpsLegalDocument,
    OpsPolicySectionVersion,
    OpsPolicySetting,
    OpsRatingFeatureFlags,
    OpsServiceReportType,
    StatusType,
)

pytestmark = pytest.mark.django_db

# Справочник → команда, которая обязана его наполнить.
REFERENCE_BOOKS = (
    (OpsDictionaryEntry, "seed_operations"),
    (OpsDutyType, "seed_operations"),
    (OpsDutyConflictPolicy, "seed_operations"),
    (OpsCombatDutyType, "seed_operations"),
    (OpsCombatRoute, "seed_operations"),
    (OpsPolicySetting, "seed_operations"),
    # 🔴 ВЕРСИЯ РАЗДЕЛА — ТОЖЕ СПРАВОЧНИК (Plane №670). Её забыли внести сюда
    # вместе с самими настройками, и потому раздел мог оказаться посеянным
    # наполовину: настройки есть, версии нет. Экран настроек читает версию
    # отдельным полем и рисовал тогда бейдж «версия:» без числа — признак,
    # который читается как поломка экрана, а не как незаполненная база.
    (OpsPolicySectionVersion, "seed_operations"),
    (OpsAnalyticsMetricDefinition, "seed_operations"),
    (OpsAnalyticsPeriodPreset, "seed_operations"),
    (OpsAttentionDetector, "seed_operations"),
    (OpsServiceReportType, "seed_operations"),
    (OpsFeedbackRegistry, "seed_operations"),
    (OpsRatingFeatureFlags, "seed_operations"),
    (StatusType, "seed_status_types"),
    (OpsLegalDocument, "seed_legal_documents"),
)


@pytest.fixture
def seeded():
    call_command("seed_status_types")
    call_command("seed_operations")
    call_command("seed_legal_documents")


@pytest.mark.parametrize(
    "model,command", REFERENCE_BOOKS, ids=[m.__name__ for m, _ in REFERENCE_BOOKS]
)
def test_the_reference_book_is_not_empty_after_seeding(seeded, model, command):
    assert model.objects.exists(), (
        f"справочник {model.__name__} пуст после сида — экран, который его читает, "
        f"покажет пустой список и при этом ответит 200. Наполнять обязана команда "
        f"`{command}`."
    )


def test_the_status_types_carry_the_codes_the_section_asks_for(seeded):
    """Пустота — не единственный способ соврать: важен и СОСТАВ.

    Раздел адресует типы статусов кодами; справочник, наполненный чем угодно,
    прошёл бы проверку «не пуст», а расход дня остался бы без «в строю».
    """
    codes = set(StatusType.objects.values_list("code", flat=True))
    # `IN_EVENT` вместо `EVENT_ASSIGNMENT` (Plane №486): оба «Привлечён на
    # мероприятие» слиты в «Участие в ОМ», и сид заводит именно его.
    assert {"IN_SERVICE", "VACATION", "IN_EVENT"} <= codes, sorted(codes)


def test_placement_roles_carry_the_labels_of_the_blank(seeded):
    """Роли наряда — ИЗ БЛАНКА, а не придуманы (Plane №237).

    🔴 Проверяется не «справочник непуст», а СОСТАВ: документ «Общая
    расстановка» заполняется по этим ролям, и роль, которой в бланке нет,
    некуда поставить — а недостающая оставит место пустым.

    Оригинал на казахском держится в подписи сознательно: по бумаге сверяют
    заполнение, и без него «водитель VIP» и «VIP жүргізушісі» не свести.
    """
    roles = {
        entry.code: entry.label
        for entry in OpsDictionaryEntry.objects.filter(dictionary_code="PLACEMENT_ROLES")
    }

    assert {"DRIVER_VIP", "MOTORCADE_LEAD", "MOBILE_GUARD_CHIEF", "CHECK_GROUP_LEAD"} <= set(roles)
    assert "VIP жүргізушісі" in roles["DRIVER_VIP"]
    assert "Кортежге жауапты" in roles["MOTORCADE_LEAD"]
    assert len(roles) >= 13, sorted(roles)
