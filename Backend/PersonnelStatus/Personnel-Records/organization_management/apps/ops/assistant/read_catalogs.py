"""Fixed, minimal projections. Unknown global catalog ownership stays closed."""
from django.contrib.auth import get_user_model
from django.db.models import Q, Subquery
from rest_framework.exceptions import NotFound, PermissionDenied
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.models import Role, Permission
from organization_management.apps.operations.models_object import OpsSecurityObject
from organization_management.apps.operations.models_vehicle import OpsVehicle
from organization_management.apps.operations.models_gvo import OpsProtectedPerson
from organization_management.apps.operations.models_legal import OpsLegalDocument
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_duty import OpsDutyShift
from organization_management.apps.operations.models_forces import OpsDepartmentRequest, OpsUnitRequest
from .live_data import require, page_result, scoped_employees, employee_brief


def global_read(authority, *alternatives):
    if not any(authority.has(code) and authority.scope(code) is None for code in alternatives):
        raise PermissionDenied('Для этого общего каталога требуется глобальное право чтения. Область не расширена.')


def search_query(query, spec, fields):
    if spec.get('search'):
        match = Q(pk__in=[])
        for field in fields:
            match |= Q(**{field+'__icontains':spec['search']})
        query = query.filter(match)
    return query


def scope_union(authority, permissions):
    result = set()
    for permission in permissions:
        if authority.has(permission):
            scope = authority.scope(permission)
            if scope is None:
                return None
            result |= scope
    return result


def execute_catalog(authority, spec):
    op = spec['operation']
    if op in {'daily_submissions','report_jobs','feedback','dictionaries','settings','ratings','rating_analytics'}:
        from .read_additional import execute_additional
        return execute_additional(authority, spec)
    if op in {'own_profile','directory'}:
        scope = authority.scope('personnel.view')
        allowed = Q() if scope is None else Q(staff_unit__division_id__in=scope) | Q(user_id=authority.user.pk)
        query = Employee.objects.filter(is_active=True, employment_status='working').filter(allowed)
        if op == 'own_profile':
            query = query.filter(user_id=authority.user.pk)
        elif not authority.has('personnel.view') and not query.exists():
            raise PermissionDenied('PERMISSION_DENIED')
        if 'divisionId' in spec:
            query = query.filter(staff_unit__division_id=spec['divisionId'])
        if 'employeeId' in spec:
            query = query.filter(pk=spec['employeeId'])
            if not query.exists(): raise NotFound()
        query = search_query(query, spec, ['last_name','first_name','middle_name'])
        result = page_result(query.select_related('staff_unit__division').order_by('last_name','first_name','pk'), spec, employee_brief)
        result['href']='/security-ops/profile' if op=='own_profile' else '/service-employees'
        return result
    if op == 'organization':
        require(authority, 'orgstructure.view')
        scope=authority.scope('orgstructure.view')
        query=Division.objects.all() if scope is None else Division.objects.filter(pk__in=scope)
        if 'divisionId' in spec:
            query=query.filter(pk=spec['divisionId'])
            if not query.exists(): raise NotFound()
        query=search_query(query,spec,['name'])
        result=page_result(query.order_by('pk'),spec,lambda row:{'id':row.pk,'name':row.name,
            'parentId':row.parent_id if scope is None or row.parent_id in scope else None,'divisionType':row.division_type})
        result['href']='/organization';return result
    if op == 'duties':
        require(authority,'duty.view')
        scope=authority.scope('duty.view')
        employees=scoped_employees(scope,spec,active=False)
        query=OpsDutyShift.objects.all()
        if scope is not None or 'employeeId' in spec or 'divisionId' in spec:
            query=query.filter(employee_id__in=[str(pk) for pk in employees.values_list('pk',flat=True)])
        if 'date' in spec:query=query.filter(business_date=spec['date'])
        result=page_result(query.order_by('-business_date','-pk'),spec,lambda row:{'id':row.pk,'name':row.employee_name,
            'date':row.business_date.isoformat(),'title':row.duty_type_code,'state':row.state_code})
        result['href']='/security-ops/duty-register';return result
    if op == 'force_requests':
        codes=['forces.command','forces.allocate','forces.select']
        if not any(authority.has(code) for code in codes):raise PermissionDenied('PERMISSION_DENIED')
        parent_scope=scope_union(authority,codes[:2]);unit_scope=scope_union(authority,codes)
        parents=OpsDepartmentRequest.objects.all()
        latest=parents.order_by('event_id','allocation_key','-sequence').distinct('event_id','allocation_key').values('pk')
        if authority.has('forces.select') and not any(authority.has(c) for c in codes[:2]):
            query=OpsUnitRequest.objects.filter(department_request_id__in=Subquery(latest))
            if unit_scope is not None:query=query.filter(directorate_id__in=unit_scope)
            if 'divisionId' in spec:query=query.filter(directorate_id=spec['divisionId'])
            latest_units=query.order_by('event_id','directorate_key','-sequence').distinct('event_id','directorate_key').values('pk')
            query=OpsUnitRequest.objects.filter(pk__in=Subquery(latest_units))
            render=lambda row:{'id':row.pk,'eventId':row.event_id,'divisionId':row.directorate_id,'count':row.requested_count,'title':'Запрос управлению','revision':row.sequence}
        else:
            query=parents.filter(pk__in=Subquery(latest))
            if parent_scope is not None:query=query.filter(department_id__in=parent_scope)
            if 'divisionId' in spec:query=query.filter(department_id=spec['divisionId'])
            render=lambda row:{'id':row.pk,'eventId':row.event_id,'divisionId':row.department_id,'count':row.requested_count,'state':row.status,'title':'Запрос департаменту','revision':row.sequence}
        if 'eventId' in spec:
            query=query.filter(event_id=spec['eventId'])
            if not query.exists():raise NotFound()
        if 'divisionId' in spec and not query.exists():raise NotFound()
        result=page_result(query.order_by('-pk'),spec,render);result['href']='/employees?view=forces';return result
    definitions={
        'objects': (OpsSecurityObject,('object.view',),('code','name'),('code','name'),'/security-ops/objects'),
        'vehicles': (OpsVehicle,('event.view',),('brand','plate'),('brand','plate'),'/security-ops/vehicles'),
        'laws': (OpsLegalDocument,('catalog.view','legal.manage'),('code','title','revision','status'),('code','title'),'/security-ops/laws'),
        'protected_persons': (OpsProtectedPerson,('catalog.view',),('name','category'),('name',),'/security-ops/persons'),
        'users': (get_user_model(),('admin.roles',),('username','is_active'),('username',),'/settings/users'),
        'roles': (Role,('admin.roles',),('code','name','is_active'),('code','name'),'/settings/roles'),
        'permissions': (Permission,('admin.roles',),('code','name','is_active'),('code','name'),'/settings/permissions'),
        'audit': (OpsAuditLog,('audit.view',),('action','entity_type','created_at'),('action','entity_type'),'/security-ops/audit'),
    }
    if op not in definitions:raise PermissionDenied('Неподдерживаемое чтение.')
    model,permissions,fields,search,href=definitions[op]
    global_read(authority,*permissions)
    query=search_query(model.objects.all(),spec,search)
    def render(row):
        values={key:getattr(row,key) for key in fields}
        values['id']=row.pk
        if op=='vehicles':values.update(title=values.pop('brand'),code=values.pop('plate'))
        if op=='users':values['name']=values.pop('username')
        if op=='audit':values.update(title=values.pop('action')+' · '+values.pop('entity_type'),date=values.pop('created_at').isoformat())
        return values
    result=page_result(query.order_by('pk'),spec,render);result['href']=href;return result
