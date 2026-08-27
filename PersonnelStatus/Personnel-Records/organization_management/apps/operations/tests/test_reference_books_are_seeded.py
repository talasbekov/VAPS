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
    assert {"IN_SERVICE", "VACATION", "EVENT_ASSIGNMENT"} <= codes, sorted(codes)
