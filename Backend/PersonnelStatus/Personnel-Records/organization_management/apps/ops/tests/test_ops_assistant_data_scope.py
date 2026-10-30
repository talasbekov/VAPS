from datetime import timedelta
from types import SimpleNamespace
import pytest
from organization_management.apps.core.tests.test_service_employees_api import people
from organization_management.apps.ops.tests.test_ops_assistant_api import jwt_actor
from organization_management.apps.operations.models import TemporaryDutyPermission, UserRole
from organization_management.apps.operations.clock import Clock
from organization_management.apps.ops.assistant.data_scope import DataAuthority

pytestmark = pytest.mark.django_db


def test_permission_scopes_are_separate_and_conjunction_is_intersection(people):
    root, child, foreign, rows = people
    _, user = jwt_actor('scope-data', ('status.view',), root.pk)
    _, other = jwt_actor('scope-workspace', ('status.workspace',), child.pk)
    grant = UserRole.objects.get(user_id=str(other.pk))
    UserRole.objects.create(user_id=str(user.pk), role_code=grant.role_code, scope_division_id=child.pk)
    authority = DataAuthority(SimpleNamespace(user=user))
    assert authority.scope('status.view') == {root.pk, child.pk}
    assert authority.intersection('status.view', 'status.workspace') == {child.pk}
    assert not authority.has('event.view')


def test_event_bound_temporary_grant_does_not_open_general_status_or_other_event(people):
    root, child, foreign, rows = people
    _, user = jwt_actor('scope-temporary', ('profile.view',), root.pk)
    _, holder = jwt_actor('scope-duty-role', ('event.view', 'status.view', 'personnel.view'))
    code = UserRole.objects.get(user_id=str(holder.pk)).role_code_id
    now = Clock.now()
    TemporaryDutyPermission.objects.create(user_id=str(user.pk), duty_role_code=code,
        event_id=123, scope_division_id=None, starts_at=now-timedelta(hours=1), ends_at=now+timedelta(hours=1), created_by='tests')
    authority = DataAuthority(SimpleNamespace(user=user))
    assert not authority.has('status.view') and not authority.has('personnel.view')
    assert authority.event_ids('event.view') == {123}
    assert authority.scope('event.view', event_id=123) is None
    assert authority.scope('event.view', event_id=124) == set()


def test_fingerprint_changes_when_tree_or_temporary_event_changes(people):
    root, child, foreign, rows = people
    _, user = jwt_actor('scope-stamp', ('status.view', 'status.workspace'), root.pk)
    before = DataAuthority(SimpleNamespace(user=user)).stamp
    child.parent = foreign; child.save(update_fields=['parent'])
    assert DataAuthority(SimpleNamespace(user=user)).stamp != before


def test_scope_and_stamp_do_not_mix_different_topology_snapshots(people,monkeypatch):
    from organization_management.apps.operations.selectors import DivisionTreeSelector
    root,child,foreign,rows=people
    _,user=jwt_actor('scope-race',('status.view',),root.pk)
    stale=DivisionTreeSelector.children_map()
    child.parent=foreign;child.save(update_fields=['parent'])
    monkeypatch.setattr(DivisionTreeSelector,'children_map',lambda:stale)
    authority=DataAuthority(SimpleNamespace(user=user))
    assert child.pk not in authority.scope('status.view')
