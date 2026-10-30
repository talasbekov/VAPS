"""Shared geometry: recon chief prepares points; staffing remains placement-only."""
import pytest

from organization_management.apps.operations.models_event import OpsSecurityEvent, OpsVisitObjectDeputy
from organization_management.apps.operations.tests.test_bulk_status_api import client_for
from .test_ops_recon_object_chief_access import two_object_recon  # noqa: F401
from .test_ops_security_events_api import manager  # noqa: F401

pytestmark = pytest.mark.django_db
POINT = {"latitude": 51.128, "longitude": 71.43}

@pytest.fixture(autouse=True)
def private_geometry(settings, tmp_path):
    settings.OPS_PRIVATE_STORAGE_ROOT = str(tmp_path)
    return tmp_path

@pytest.fixture
def recon_map(two_object_recon):
    event_id, first, second, chief, neighbour = two_object_recon
    base = f"/api/ops/security-events/{event_id}/"
    response = chief.post(base + 'recon/import-from-passport/', {'visitObjectId': str(first.pk)}, format='json')
    assert response.status_code == 200, response.content
    event = response.json()
    post = next(row for row in event['reconSectorPosts'] if row['visitObjectId'] == str(first.pk))
    return base, first, second, chief, neighbour, post

@pytest.mark.parametrize('kind', ['object', 'post'])
def test_recon_chief_saves_own_object_and_saved_post_without_changing_calculation(recon_map, kind):
    base, first, _, chief, _, post = recon_map
    before = chief.get(base).json()
    target = str(first.pk) if kind == 'object' else post['id']
    payload = {'targetType': kind, 'targetId': target, 'location': POINT}
    if kind == 'post':
        payload['outdoor'] = True
    response = chief.patch(base + 'placement/map/', payload, format='json')
    assert response.status_code == 200, response.content
    geometry = chief.get(base + 'placement/map/').json()
    assert (geometry['objects'][target] if kind == 'object' else geometry['posts'][target]['location']) == POINT
    after = chief.get(base).json()
    for key in ('reconSectorPosts', 'placementAssignments', 'forceRoster', 'stage'):
        assert after[key] == before[key]
    assert [v['reconChecklist'] for v in after['visitObjects']] == [v['reconChecklist'] for v in before['visitObjects']]

def test_recon_chief_cannot_change_neighbour_geometry(recon_map, private_geometry):
    base, first, _, _, neighbour, post = recon_map
    for kind, target in [('object', str(first.pk)), ('post', post['id'])]:
        payload = {'targetType': kind, 'targetId': target, 'location': POINT, 'outdoor': True}
        assert neighbour.patch(base + 'placement/map/', payload, format='json').status_code == 403
    assert not list(private_geometry.rglob('*.geojson'))

@pytest.mark.parametrize('codes', [('event.view', 'event.manage'), ('event.view', 'placement.manage', 'placement.command')])
def test_unassigned_event_or_placement_manager_does_not_gain_recon_map_authority(recon_map, codes, private_geometry):
    base, first, _, _, _, _ = recon_map
    api, _ = client_for('not-recon-chief', 'NOT_RECON_CHIEF', perms=codes)
    result = api.patch(base + 'placement/map/', {'targetType': 'object', 'targetId': str(first.pk), 'location': POINT}, format='json')
    assert result.status_code == 403, result.content
    assert not list(private_geometry.rglob('*.geojson'))

def test_placement_deputy_is_not_a_recon_chief(recon_map, private_geometry):
    base, first, _, _, neighbour, _ = recon_map
    OpsVisitObjectDeputy.objects.create(visit_object=first, employee_id=neighbour.handler._force_user.employee.pk, employee_name='Замещающий', assigned_by='tests', can_edit_placement=True)
    response = neighbour.patch(base + 'placement/map/', {'targetType': 'object', 'targetId': str(first.pk), 'location': POINT}, format='json')
    assert response.status_code == 403, response.content
    assert not list(private_geometry.rglob('*.geojson'))

def test_recon_missing_chief_keeps_existing_guard_even_for_override(recon_map, manager, private_geometry):
    base, first, _, _, _, _ = recon_map
    first.chief_employee_id = None
    first.save(update_fields=['chief_employee_id'])
    result = manager.patch(base + 'placement/map/', {'targetType': 'object', 'targetId': str(first.pk), 'location': POINT}, format='json')
    assert result.status_code == 422, result.content
    assert result.json()['error_code'] == 'VISIT_CHIEF_REQUIRED'
    assert not list(private_geometry.rglob('*.geojson'))

def test_inactive_recon_chief_cannot_write_map(recon_map, private_geometry):
    base, first, _, chief, _, _ = recon_map
    employee = chief.handler._force_user.employee
    employee.is_active = False
    employee.save(update_fields=['is_active'])
    result = chief.patch(base + 'placement/map/', {'targetType': 'object', 'targetId': str(first.pk), 'location': POINT}, format='json')
    assert result.status_code == 403, result.content
    assert not list(private_geometry.rglob('*.geojson'))

def test_recon_coordinates_survive_transition_to_placement_and_can_be_cleared(recon_map):
    base, first, _, chief, _, post = recon_map
    url = base + 'placement/map/'
    for kind, target in [('object', str(first.pk)), ('post', post['id'])]:
        payload = {'targetType': kind, 'targetId': target, 'location': POINT, 'outdoor': True}
        result = chief.patch(url, payload, format='json')
        assert result.status_code == 200, result.content
    current = chief.get(base).json()
    visit = next(row for row in current['visitObjects'] if row['id'] == str(first.pk))
    checklist = [dict(row, state='NORMAL', comment='') for row in visit['reconChecklist']]
    saved = chief.patch(base + 'recon/', {'visitObjectId': str(first.pk), 'checklist': checklist}, format='json')
    assert saved.status_code == 200, saved.content
    completed = chief.post(base + 'recon/complete/', {'visitObjectId': str(first.pk)}, format='json')
    assert completed.status_code == 200, completed.content
    assert next(v for v in completed.json()['visitObjects'] if v['id'] == str(first.pk))['stage'] == 'PLACEMENT'
    geometry = chief.get(url).json()
    assert geometry['objects'][str(first.pk)] == POINT
    assert geometry['posts'][post['id']]['location'] == POINT
    removed = chief.patch(url, {'targetType': 'post', 'targetId': post['id'], 'location': None, 'outdoor': False}, format='json')
    assert removed.status_code == 200, removed.content
    assert post['id'] not in removed.json()['posts']

def test_recon_geometry_does_not_create_or_replace_staff_assignments(recon_map):
    base, _, _, chief, _, post = recon_map
    before = chief.get(base).json()['placementAssignments']
    result = chief.patch(base + 'placement/map/', {'targetType': 'post', 'targetId': post['id'], 'location': POINT, 'outdoor': True}, format='json')
    assert result.status_code == 200, result.content
    assert chief.get(base).json()['placementAssignments'] == before

def test_closed_event_rejects_recon_map_even_when_visit_stage_is_stale(recon_map, private_geometry):
    base, first, _, chief, _, _ = recon_map
    event = OpsSecurityEvent.objects.get(pk=first.event_id)
    event.stage = 'CLOSED'
    event.save(update_fields=['stage'])
    result = chief.patch(base + 'placement/map/', {'targetType': 'object', 'targetId': str(first.pk), 'location': POINT}, format='json')
    assert result.status_code == 403, result.content
    assert not list(private_geometry.rglob('*.geojson'))

@pytest.mark.parametrize('next_stage', ['RECON', 'PLACEMENT'])
def test_recon_authority_is_rechecked_after_lock_and_cannot_cross_a_stage_change(recon_map, monkeypatch, private_geometry, next_stage):
    from organization_management.apps.ops import map_locations
    base, first, _, chief, neighbour, _ = recon_map
    original = map_locations.events.lock_event
    def changed_before_lock(event_id):
        first.stage = next_stage
        first.chief_employee_id = neighbour.handler._force_user.employee.pk
        first.save(update_fields=['stage', 'chief_employee_id'])
        return original(event_id)
    monkeypatch.setattr(map_locations.events, 'lock_event', changed_before_lock)
    result = chief.patch(base + 'placement/map/', {'targetType': 'object', 'targetId': str(first.pk), 'location': POINT}, format='json')
    assert result.status_code in {403, 409, 422}, result.content
    assert not list(private_geometry.rglob('*.geojson'))
