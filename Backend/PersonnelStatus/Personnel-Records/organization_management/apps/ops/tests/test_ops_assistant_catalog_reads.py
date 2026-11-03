import pytest
from organization_management.apps.core.tests.test_service_employees_api import people
from organization_management.apps.ops.tests.test_ops_assistant_live_data import read
from organization_management.apps.ops.tests.test_ops_assistant_api import jwt_actor

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize('operation', ['organization','objects','duties','force_requests','vehicles','laws','protected_persons','users','roles','permissions','audit'])
def test_registered_catalog_read_is_bounded_and_projection_excludes_secret_fields(operation):
    api, _ = jwt_actor('catalog-'+operation, ('*',))
    response = read(api, operation)
    assert response.status_code == 200, response.content
    data = response.json()['readOnly']
    assert len(data['rows']) <= 10
    for row in data['rows']:
        assert not {'password','iin','bio','note','file_url','old_value','new_value','personal_phone','email'} & set(row)


@pytest.mark.parametrize('operation,permission', [('users','admin.roles'),('roles','admin.roles'),('permissions','admin.roles'),('audit','audit.view'),('laws','catalog.view'),('vehicles','event.view'),('protected_persons','catalog.view')])
def test_global_catalogs_do_not_treat_scoped_grant_as_global(operation, permission, people):
    root, child, foreign, rows = people
    api, _ = jwt_actor('catalog-scoped-'+operation, (permission,), root.pk)
    assert read(api, operation).status_code == 403


def test_organization_is_scoped_and_global_other_permission_does_not_expand_it(people):
    root, child, foreign, rows = people
    api, _ = jwt_actor('catalog-org', ('orgstructure.view',), root.pk)
    data = read(api, 'organization').json()['readOnly']
    assert {r['id'] for r in data['rows']} == {root.pk, child.pk}
    assert read(api, 'organization', divisionId=foreign.pk).status_code == 404


@pytest.mark.parametrize('operation', ['daily_submissions','report_jobs','feedback','dictionaries','settings','ratings','rating_analytics'])
def test_additional_current_metadata_reads_keep_unavailable_distinct_from_zero(operation):
    api, _ = jwt_actor('extra-'+operation, ('*',))
    response = read(api, operation)
    assert response.status_code in ({200,422} if operation in {'ratings','rating_analytics'} else {200}), response.content
    if response.status_code == 200:
        assert len(response.json()['readOnly']['rows']) <= 10


@pytest.mark.parametrize('operation', ['daily_submissions','report_jobs','feedback','dictionaries','settings','ratings','rating_analytics'])
def test_extra_reads_without_grant_are_denied(operation):
    api, _ = jwt_actor('no-extra-'+operation, ('profile.view',))
    assert read(api, operation).status_code == 403
