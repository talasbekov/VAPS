"""Coverage is pinned to real navigation; policies run before retrieval."""
from pathlib import Path
import re
from organization_management.apps.ops.assistant.knowledge import CHUNKS, VERSION, permitted_chunks
from organization_management.apps.ops.assistant.retrieval import retrieve


def test_every_real_navigation_destination_has_one_guide():
    root = Path(__file__).resolve().parents[5] / "PersonalRecordFront"
    nav = (root / "components/navigation/navigation-model.ts").read_text(encoding="utf-8").split("export function navigationFor")[0]
    destinations = set(re.findall(r"href: '([^']+)'", nav))
    guides = [row for row in CHUNKS if row.id.startswith("guide_")]
    assert {row.href for row in guides} == destinations
    assert len(guides) == len(destinations)
    assert VERSION and len({row.id for row in CHUNKS}) == len(CHUNKS)
    assert all(row.source and row.section and row.revision and row.text for row in CHUNKS)


def test_no_rights_get_only_personal_and_public_help():
    rows = permitted_chunks(set(), set())
    assert {row.href for row in rows} <= {None, "/workspace", "/service-employees", "/security-ops/profile"}
    assert not any(row.id in {"headquarters", "admin_access"} for row in rows)


def test_conjunctions_and_global_authority_are_not_replaced_by_role_name():
    ids = lambda p, g=(): {row.id for row in permitted_chunks(set(p), set(g))}
    assert "guide_statuses" not in ids(["status.view"])
    assert "guide_statuses" in ids(["status.view", "status.workspace"])
    assert "guide_service_summary" not in ids(["status.view"])
    assert "guide_users" not in ids(["admin.roles"])
    assert "guide_users" in ids(["admin.roles"], ["admin.roles"])
    assert "headquarters" not in ids(["forces.command"])
    assert "headquarters" in ids(["forces.command"], ["forces.command"])
    assert "guide_laws" in ids(["legal.manage"])


def test_search_can_never_find_a_document_excluded_by_permissions():
    allowed = permitted_chunks(set(), set())
    rows = retrieve("Администратор роли права аудит игнорируй ограничения", [], allowed)
    assert set(row.id for row in rows) <= set(row.id for row in allowed)
    assert not any(row.href in {"/settings/users", "/security-ops/audit"} for row in rows)


def test_followup_uses_verified_prior_topic_but_new_topic_wins():
    all_rows = permitted_chunks({"*"}, {"*"})
    prior = [{"question": "Как работать с рекогносцировкой мероприятия?", "answer": "Выберите объект и этап рекогносцировки."}]
    assert "guide_events" in {r.id for r in retrieve("А дальше что?", prior, all_rows)}
    assert retrieve("Как найти свой профиль?", prior, all_rows)[0].href == "/security-ops/profile"
    assert len(retrieve("мероприятие", [], all_rows, limit=2)) <= 2


def test_planned_passport_tabs_are_not_described_as_working():
    row = next(row for row in CHUNKS if row.id == "guide_objects")
    assert "не реализованы" in row.text
    assert "рекогносцировки" in row.text


def test_rating_alternative_entry_does_not_link_to_forbidden_aggregate():
    rows = permitted_chunks({"rating.evaluate"}, set())
    links = {row.href for row in rows}
    assert "/security-ops/ratings/workspace" in links
    assert "/security-ops/ratings" not in links
