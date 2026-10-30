"""Minimal scoped reads. Filtering always precedes count, search and slicing."""
from datetime import date
from collections import Counter
from django.db.models import Q, F, CharField, Count, OuterRef, Subquery
from django.db.models.functions import Cast
from rest_framework.exceptions import NotFound, PermissionDenied
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.clock import Clock
from organization_management.apps.statuses.models import EmployeeStatus
from organization_management.apps.statuses.selectors import statuses_effective_on_date, effective_status_types_by_employee
from organization_management.apps.statuses.catalog import label_for, personnel_reporting_catalog


def require(authority, *permissions):
    if not all(authority.has(code) for code in permissions):
        raise PermissionDenied('PERMISSION_DENIED')


def page_result(query, spec, render):
    count, page, size = query.count(), spec['page'], 10
    return {'operation': spec['operation'], 'asOf': Clock.now().isoformat(), 'count': count, 'page': page, 'pageSize': size,
            'hasNext': page * size < count, 'rows': [render(row) for row in query[(page-1)*size:page*size]]}


def scoped_employees(scope, spec, *, active=True):
    qs = Employee.objects.all()
    if active:
        qs = qs.filter(is_active=True, employment_status='working')
    if scope is not None:
        qs = qs.filter(staff_unit__division_id__in=scope)
    if 'divisionId' in spec:
        if scope is not None and spec['divisionId'] not in scope:
            raise NotFound()
        qs = qs.filter(staff_unit__division_id=spec['divisionId'])
    if 'employeeId' in spec:
        qs = qs.filter(pk=spec['employeeId'])
        if not qs.exists():
            raise NotFound()
    return qs.select_related('staff_unit__division', 'staff_unit__position').order_by('last_name', 'first_name', 'pk')


def employee_brief(employee):
    staff = getattr(employee, 'staff_unit', None)
    return {'employeeId': employee.pk, 'name': ' '.join(p for p in [employee.last_name, employee.first_name, employee.middle_name] if p),
            'division': staff.division.name if staff and staff.division else None}


def statuses(authority, spec):
    require(authority, 'status.view', 'status.workspace')
    scope = authority.intersection('status.view', 'status.workspace')
    employees = scoped_employees(scope, spec)
    if spec.get('ownOnly'):
        employees=employees.filter(user_id=authority.user.pk)
        if not employees.exists():raise NotFound()
    day = date.fromisoformat(spec['date']) if 'date' in spec else Clock.today_local()
    # Exactly the date winner used by reports/dashboard, including ACTIVE,
    # priority and return-day rules. Only minimal scoped tuples are read.
    catalog=personnel_reporting_catalog()
    ids=list(employees.values_list('pk',flat=True))
    rows=list(statuses_effective_on_date(EmployeeStatus.objects.filter(employee_id__in=Subquery(employees.values('pk'))),day)
              .values_list('employee_id','status_type','state','start_date','actual_end_date','end_date'))
    winners=effective_status_types_by_employee([row[:5] for row in rows],catalog)
    matches={}
    for row in rows:
        if winners.get(row[0])==row[1]:matches.setdefault(row[0],[]).append(row)
    metadata={}
    for employee_id,candidates in matches.items():
        active=[row for row in candidates if row[2]==EmployeeStatus.StatusState.ACTIVE]
        candidates=active or candidates
        states={row[2] for row in candidates}
        intervals={(row[3],row[4] or row[5]) for row in candidates}
        start,end=next(iter(intervals)) if len(intervals)==1 else (None,None)
        metadata[employee_id]={'state':next(iter(states)) if len(states)==1 else None,
            'startDate':start.isoformat() if start else None,'endDate':end.isoformat() if end else None,
            'planned':states=={EmployeeStatus.StatusState.PLANNED},'ambiguousSource':len(states)>1 or len(intervals)>1}
    if spec.get('absentOnly'):
        absent_codes={code for code in catalog.code_by_alias if catalog.column_for(catalog.code_for(code))!='in_service'}
        ids=[pk for pk in ids if winners.get(pk) in absent_codes and metadata.get(pk,{}).get('state') not in (None,EmployeeStatus.StatusState.PLANNED)]
        employees=employees.filter(pk__in=ids)
    labels={code:label_for(code,'Неизвестно') for code in set(winners.values()) | {None}}
    def render(employee):
        code=winners.get(employee.pk)
        return {**employee_brief(employee),'statusCode':code,'status':labels[code],
            **metadata.get(employee.pk,{'state':None,'startDate':None,'endDate':None,'planned':False,'ambiguousSource':False})}
    if spec['operation'] == 'status_summary':
        groups=Counter((winners.get(pk),metadata.get(pk,{}).get('state')) for pk in ids)
        items=sorted(groups,key=str);page=spec['page'];size=10
        result={'operation':spec['operation'],'asOf':Clock.now().isoformat(),'count':len(ids),'page':page,'pageSize':size,
            'hasNext':page*size<len(items),'rows':[{'statusCode':code,'status':labels[code],'state':state,
                'planned':state==EmployeeStatus.StatusState.PLANNED,'count':groups[(code,state)]} for code,state in items[(page-1)*size:page*size]]}
    else:
        result = page_result(employees, spec, render)
    result['date'] = day.isoformat()
    if spec.get('absentOnly'):
        result['notice']='Отобраны известные статусы вне колонки «В строю». Это не подтверждение физического отсутствия; неизвестные и планы не включены.'
    result['href'] = '/statuses'
    return result


def base_event_condition(authority, scope, *, include_own=True):
    if scope is None:
        return Q()
    employees = Employee.objects.filter(staff_unit__division_id__in=scope)
    owners = employees.exclude(user_id__isnull=True).annotate(account=Cast('user_id', CharField())).values('account')
    own=Q(owner_actor_id=authority.actor) if include_own else Q(pk__in=[])
    return (own | Q(owner_actor_id__in=owners) | Q(chief_employee_id__in=employees.values('pk'))
            | Q(visit_objects__chief_employee_id__in=employees.values('pk'))
            | Q(visit_objects__deputies__employee_id__in=employees.values('pk'))
            | Q(department_request_rows__department_id__in=scope) | Q(unit_request_rows__directorate_id__in=scope))


def visible_events(authority):
    bound = authority.event_ids('event.view')
    if not authority.has('event.view') and not bound:
        raise PermissionDenied('PERMISSION_DENIED')
    query = OpsSecurityEvent.objects.all()
    # Q() is Django's empty condition, not Boolean True when OR-combined
    # with pk__in=[]. A real global grant must return the unrestricted query.
    if authority.has('event.view') and authority.scope('event.view') is None:
        return query
    condition = Q(pk__in=bound)
    if authority.has('event.view'):
        condition |= base_event_condition(authority, authority.scope('event.view'))
    return query.filter(condition).distinct()


def event_brief(row):
    return {'id': row.pk, 'code': row.code, 'title': row.title, 'date': row.business_date.isoformat(),
            'dateEnd': row.business_date_end.isoformat() if row.business_date_end else None,
            'stage': row.stage, 'stageLabel': row.get_stage_display(), 'href': f'/security-ops/events/{row.pk}'}


def event_data(authority, spec):
    query = visible_events(authority)
    if 'eventId' in spec:
        query = query.filter(pk=spec['eventId'])
        if not query.exists():
            raise NotFound()
    if 'divisionId' in spec:
        scope = authority.scope('event.view')
        if scope is not None and spec['divisionId'] not in scope:
            raise NotFound()
        query = query.filter(base_event_condition(authority, {spec['divisionId']},include_own=False))
    if spec['operation'] == 'event_objects':
        parent = query.first()
        scope = authority.scope('event.view', event_id=parent.pk)
        visits = parent.visit_objects.all()
        if scope is not None:
            employees = Employee.objects.filter(staff_unit__division_id__in=scope)
            owners = set(str(pk) for pk in employees.exclude(user_id__isnull=True).values_list('user_id', flat=True))
            full = parent.owner_actor_id == authority.actor or parent.owner_actor_id in owners or parent.chief_employee_id in employees.values_list('pk', flat=True)
            if not full:
                visits = visits.filter(Q(chief_employee_id__in=employees.values('pk')) | Q(deputies__employee_id__in=employees.values('pk'))).distinct()
        result = page_result(visits.order_by('pk'), spec, lambda row: {'id':row.pk, 'name':row.object_name,
            'stage':row.stage, 'stageLabel':row.get_stage_display(), 'href':f'/security-ops/events/{parent.pk}?visitId={row.pk}'})
        result['eventId'] = parent.pk
    else:
        if 'search' in spec:
            query = query.filter(Q(title__icontains=spec['search']) | Q(code__icontains=spec['search']))
        if 'stage' in spec:
            query = query.filter(stage=spec['stage'])
        if 'date' in spec:
            day = date.fromisoformat(spec['date'])
            query = query.filter(business_date__lte=day).filter(Q(business_date_end__gte=day) | Q(business_date_end__isnull=True, business_date=day))
        if 'dateFrom' in spec:
            query = query.filter(business_date__gte=spec['dateFrom'])
        if 'dateTo' in spec:
            query = query.filter(business_date__lte=spec['dateTo'])
        result = page_result(query.order_by('-business_date','-pk'), spec, event_brief)
    result['href'] = f"/security-ops/events/{spec['eventId']}" if 'eventId' in spec else '/security-ops/events'
    return result


def execute(authority, spec):
    if spec['operation'] in {'statuses','status_summary'}:
        return statuses(authority, spec)
    if spec['operation'] in {'events','event_detail','event_objects'}:
        return event_data(authority, spec)
    from .read_catalogs import execute_catalog
    return execute_catalog(authority, spec)
