"""Статус объекта посещения словами (`[РЕЕ-08]`/`[РЕК-08]`, Plane №423).

Правило принадлежит серверу: реестр печатает `statusLabel`, а не выводит
подпись из этапа сам. Пробы держат оба конца — функцию и поле в списке.
"""
import pytest
from types import SimpleNamespace

from organization_management.apps.ops import security_events


@pytest.mark.parametrize(
    "stage, assigned, label",
    [
        ("BULLETIN", None, "Бюллетень"),
        ("RECON", 0, "Рекогносцировка"),
        ("DEMAND", 0, "Рекогносцировка завершена"),
        ("FORCES", 0, "Рекогносцировка завершена"),
        # Автопроход открыл «Расстановку», но старший ещё никого не назначил —
        # реестр говорит о совершённом факте, а не об обещанной работе.
        ("PLACEMENT", 0, "Рекогносцировка завершена"),
        ("PLACEMENT", 2, "Расстановка"),
        # Разрез по объектам неизвестен — подпись по этапу, без домысла.
        ("PLACEMENT", None, "Расстановка"),
        ("APPROVAL", 3, "На согласовании"),
        ("ACKNOWLEDGEMENT", 3, "Ознакомление"),
        ("CONDUCT", 3, "Проведение"),
        ("CLOSED", 3, "Закрыто"),
    ],
)
def test_visit_status_label_by_stage(stage, assigned, label):
    visit = SimpleNamespace(stage=stage)
    assert security_events.visit_status_label(visit, assigned=assigned) == label


from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: E402,F401
    URL,
    create_event,
    make_object,
    manager,
)


@pytest.mark.django_db
def test_registry_serializes_status_label(manager):  # noqa: F811
    """Свежий ОМ с паспортом стоит на «Рекогносцировке» — реестр печатает это
    словами из поля сервера, а не выводит из `stage` сам."""
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj).json()["id"]
    resp = manager.get(URL)
    assert resp.status_code == 200
    row = next(r for r in resp.json()["results"] if r["id"] == event_id)
    assert row["visitObjects"], "у ОМ с объектом должен быть объект посещения"
    visit = row["visitObjects"][0]
    assert visit["stage"] == "RECON"
    assert visit["statusLabel"] == "Рекогносцировка"
