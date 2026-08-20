"""Модели ГВО/охраняемых лиц: каталог лиц и патч сводки (спека 2026-08-20).

Инварианты уровня БД, а не только валидации:
- category ограничен CheckConstraint — choice без дефолта по практике
  проекта закрывается на уровне СУБД, иначе сырой bulk_create/SQL заведёт
  категорию-призрак;
- патч сводки — ровно один на мероприятие (OneToOne): сводка ГВО есть
  проекция мероприятия, второй патч означал бы две правды об одном ОМ.
"""
import pytest
from django.db import IntegrityError

from organization_management.apps.operations.models_gvo import (
    OpsProtectedPerson,
)


@pytest.mark.django_db
def test_protected_person_category_constraint_rejects_unknown():
    with pytest.raises(IntegrityError):
        OpsProtectedPerson.objects.create(name="Тест", category="ALIEN")


@pytest.mark.django_db
def test_protected_person_ordering_by_name_then_id():
    # Порядок заведения обратный алфавитному: совпади он с ожидаемым,
    # проверка прошла бы и на выборке вообще без order_by.
    OpsProtectedPerson.objects.create(name="Бекетов", category="OURS")
    OpsProtectedPerson.objects.create(name="Алиев", category="FOREIGN")
    assert list(
        OpsProtectedPerson.objects.values_list("name", flat=True)
    ) == ["Алиев", "Бекетов"]


@pytest.mark.django_db
def test_gvo_patch_one_per_event():
    from organization_management.apps.operations.models_gvo import (
        OpsGvoSummaryPatch,
    )
    from organization_management.apps.operations.models_event import (
        OpsSecurityEvent,
    )

    ev = OpsSecurityEvent.objects.create(
        code="ОМ-Т-1",
        title="Тестовое мероприятие",
        object_name="Объект",
        business_date="2026-08-21",
        stage=OpsSecurityEvent.Stage.BULLETIN,
        readiness_percent=0,
        force_need=0,
        conflicts_count=0,
        owner_name="Тест",
        recon_checklist=[],
        recon_sector_posts=[],
        demand_rows=[],
        demand_approved=False,
        force_requests=[],
        placement_assignments=[],
        approval_status=OpsSecurityEvent.ApprovalStatus.PENDING,
        journal_entries=[],
        closure_direction_summaries=[],
    )
    OpsGvoSummaryPatch.objects.create(event=ev, patch={"country": "X"})
    with pytest.raises(IntegrityError):
        OpsGvoSummaryPatch.objects.create(event=ev, patch={})


@pytest.mark.django_db
def test_seed_protected_persons_is_idempotent():
    from django.core.management import call_command

    call_command("seed_protected_persons")
    call_command("seed_protected_persons")
    qs = OpsProtectedPerson.objects.all()
    assert qs.count() == 5
    assert qs.filter(category="OURS").count() == 3
    assert qs.filter(category="FOREIGN").count() == 2
