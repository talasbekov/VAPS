"""«Скачать дело» (`[ЗАК-11]`, Plane №437) и «Лист ознакомления» как
приложение к расстановке (`[ОЗН-07]`).

Проверяется в DOCX (тот же документ до конвертации; PDF делает LibreOffice
и на тестовой машине его может не быть): в деле есть все секции и живые
данные объекта; расстановка после «Ознакомления» несёт приложение, до —
нет; реестр знает вид `case`, ручка отдаёт файл.
"""
import io

import pytest
from docx import Document

from organization_management.apps.ops import documents_case, documents_registry
from organization_management.apps.ops.documents_placement import render_placement
from organization_management.apps.ops.tests.test_ops_visit_object_close import (  # noqa: F401
    actor,
    two_objects_on_conduct,
)
from organization_management.apps.ops.tests.test_ops_visit_object_approval import (  # noqa: F401
    two_objects_on_approval,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    URL,
    approver,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db


def _text(payload):
    document = Document(io.BytesIO(payload))
    parts = [p.text for p in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            parts.extend(cell.text for cell in row.cells)
    return "\n".join(parts)


def test_case_carries_every_section_of_the_object(manager, two_objects_on_conduct):  # noqa: F811
    _, event_id, first, _ = two_objects_on_conduct
    from organization_management.apps.ops import security_events as service
    event = service.lock_event(event_id)
    payload = documents_case.render_case(event.code, visit_object_id=str(first.pk), fmt="docx")
    text = _text(payload)
    for section in ["Расстановка сил", "Версии документа", "Лист ознакомления", "Замечания согласования", "Оценки сотрудников", "Журнал штаба"]:
        assert section in text, section
    assert first.object_name in text
    # Живые данные: назначенный на пост объекта и версия документа.
    assigned = [a for a in event.placement_assignments if a.get("employeeName")]
    assert assigned and assigned[0]["employeeName"] in text
    assert "Версия 1" in text


def test_case_without_object_collects_all_objects(manager, two_objects_on_conduct):  # noqa: F811
    _, event_id, first, second = two_objects_on_conduct
    from organization_management.apps.ops import security_events as service
    event = service.lock_event(event_id)
    text = _text(documents_case.render_case(event.code, fmt="docx"))
    assert first.object_name in text and second.object_name in text


def test_placement_gets_the_sheet_only_after_acknowledgement(manager, two_objects_on_conduct):  # noqa: F811
    _, event_id, first, _ = two_objects_on_conduct
    from organization_management.apps.ops import security_events as service
    event = service.lock_event(event_id)
    after = _text(render_placement(event.code, fmt="docx", visit_object_id=str(first.pk)))
    assert "Приложение. Лист ознакомления" in after
    # До «Проведения» приложения нет (🔴 мутация: порог стадии).
    event.stage = "PLACEMENT"
    event.save(update_fields=["stage", "updated_at"])
    before = _text(render_placement(event.code, fmt="docx", visit_object_id=str(first.pk)))
    assert "Приложение. Лист ознакомления" not in before


def test_registry_knows_the_case_and_the_endpoint_serves_it(manager, two_objects_on_conduct):  # noqa: F811
    _, event_id, first, _ = two_objects_on_conduct
    from organization_management.apps.ops import security_events as service
    event = service.lock_event(event_id)
    kinds = {k["kind"]: k for k in documents_registry.list_kinds()}
    assert kinds["case"]["needsEvent"] is True
    payload, name = documents_registry.render("case", event_code=event.code, fmt="docx", visit_object_id=str(first.pk))
    assert name == f"delo-{event.code}.docx" and len(payload) > 1000
    resp = manager.get(
        f"/api/ops/event-documents/render/?kind=case&event={event.code}&ext=docx&visitObject={first.pk}"
    )
    assert resp.status_code == 200, resp.content
