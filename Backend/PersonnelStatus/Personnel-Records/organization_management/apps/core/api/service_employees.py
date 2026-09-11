"""Directory and employee card share the same scope, including own employee."""
from django.db.models import Q, Value
from django.db.models.functions import Concat
from django.shortcuts import get_object_or_404
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.api.permissions import resolve_actor_id, effective_permissions
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.services import PermissionService
from organization_management.apps.operations.selectors import StatusTypeSelector
from organization_management.apps.core import service_employees as service


class DirectoryFilters(serializers.Serializer):
    search = serializers.CharField(required=False, allow_blank=True, max_length=200)
    division_id = serializers.IntegerField(required=False, min_value=1)
    status = serializers.CharField(required=False)
    participation = serializers.ChoiceField(choices=['active', 'none'], required=False)
    rating_min = serializers.DecimalField(max_digits=3, decimal_places=1, min_value=0, max_value=10, required=False)
    rating_max = serializers.DecimalField(max_digits=3, decimal_places=1, min_value=0, max_value=10, required=False)
    page = serializers.IntegerField(min_value=1, required=False)
    page_size = serializers.IntegerField(min_value=1, max_value=100, required=False)

    def validate(self, data):
        if data.get('rating_min', 0) > data.get('rating_max', 10):
            raise serializers.ValidationError({'rating_max': 'Максимум меньше минимума.'})
        return data


class DirectoryPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 100


class DivisionBrief(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()


class StatusBrief(serializers.Serializer):
    code = serializers.CharField()
    name = serializers.CharField()
    date_end = serializers.DateField(allow_null=True)


class AssignmentBrief(serializers.Serializer):
    id = serializers.CharField()
    event_id = serializers.IntegerField()
    event_code = serializers.CharField()
    event_title = serializers.CharField()
    object_name = serializers.CharField()
    post = serializers.CharField()
    sector = serializers.CharField()
    date_start = serializers.DateField()
    date_end = serializers.DateField()
    closed = serializers.BooleanField()
    active = serializers.BooleanField()
    stage = serializers.CharField()
    acknowledged_at = serializers.DateTimeField(allow_null=True)
    declined_at = serializers.DateTimeField(allow_null=True)
    address = serializers.CharField()
    event_time = serializers.TimeField(allow_null=True)
    task = serializers.CharField()
    requirements = serializers.CharField()
    uniform = serializers.CharField()
    weapon = serializers.CharField()
    chief_name = serializers.CharField()
    chief_callsign = serializers.CharField(allow_null=True)
    chief_work_phone = serializers.CharField(allow_null=True)


class EmployeeBrief(serializers.Serializer):
    id = serializers.IntegerField()
    full_name = serializers.CharField()
    personnel_number = serializers.CharField()
    callsign = serializers.CharField()
    rank = serializers.CharField(allow_null=True)
    position = serializers.CharField(allow_null=True)
    division = DivisionBrief(allow_null=True)
    current_status = StatusBrief()
    rating = serializers.FloatField(allow_null=True)
    evaluations_count = serializers.IntegerField()
    rated_events_count = serializers.IntegerField()
    rating_state = serializers.CharField()
    active_assignments_count = serializers.IntegerField()
    next_assignment = AssignmentBrief(allow_null=True)


class EmployeeDirectoryPage(serializers.Serializer):
    count = serializers.IntegerField()
    next = serializers.URLField(allow_null=True)
    previous = serializers.URLField(allow_null=True)
    results = EmployeeBrief(many=True)


class EvaluationBrief(serializers.Serializer):
    event_id = serializers.IntegerField(allow_null=True)
    event_code = serializers.CharField()
    score = serializers.IntegerField()
    comment = serializers.CharField(allow_null=True)
    author = serializers.CharField()
    date = serializers.DateField()
    assignment_id = serializers.CharField(allow_null=True)
    post = serializers.CharField(allow_null=True)


class EmployeeDirectoryDetail(EmployeeBrief):
    hire_date = serializers.DateField(allow_null=True)
    work_phone = serializers.CharField(allow_null=True)
    work_email = serializers.EmailField(allow_null=True)
    assignments = AssignmentBrief(many=True)
    history = AssignmentBrief(many=True)
    evaluations = EvaluationBrief(many=True)


class ServiceEmployeeViewSet(viewsets.ViewSet):
    permission_service_map = {'list': 'personnel.view', 'retrieve': 'personnel.view', 'options': 'personnel.view'}

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if resolve_actor_id(request) is None:
            raise PermissionDenied('PERMISSION_DENIED')
        perms = effective_permissions(request)
        if not ({'*', 'personnel.view'} & perms) and not service.visible_employees(request).exists():
            if self.action != 'retrieve':
                raise PermissionDenied('PERMISSION_DENIED')

    @extend_schema(parameters=[DirectoryFilters], responses=EmployeeDirectoryPage)
    def list(self, request):
        filters = DirectoryFilters(data=request.query_params)
        filters.is_valid(raise_exception=True)
        values = filters.validated_data
        today = Clock.today_local()
        names = StatusTypeSelector.names_map()
        qs = service.annotated_employees(service.visible_employees(request), today)
        if search := values.get('search'):
            qs = qs.annotate(search_name=Concat('last_name', Value(' '), 'first_name', Value(' '), 'middle_name'))
            for term in search.split():
                qs = qs.filter(Q(search_name__icontains=term) | Q(personnel_number__icontains=term) | Q(callsign__icontains=term))
        if division_id := values.get('division_id'):
            division = Division.objects.filter(pk=division_id).first()
            qs = qs.filter(staff_unit__division__in=division.get_descendants(include_self=True)) if division else qs.none()
        if status := values.get('status'):
            if status not in names:
                raise ValidationError({'status': 'Неизвестный статус.'})
            qs = qs.filter(status_code=status)
        if values.get('participation') == 'active':
            qs = qs.filter(active_count__gt=0)
        elif values.get('participation') == 'none':
            qs = qs.filter(active_count=0)
        if 'rating_min' in values:
            qs = qs.filter(rating_value__gte=values['rating_min'])
        if 'rating_max' in values:
            qs = qs.filter(rating_value__lte=values['rating_max'])
        paginator = DirectoryPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        assignments = service.assignments_for([e.pk for e in page], today)
        rows = []
        for employee in page:
            row = service.row_of(employee, names)
            row['next_assignment'] = next((a for a in assignments[str(employee.pk)] if a['active']), None)
            rows.append(row)
        return paginator.get_paginated_response(rows)

    @extend_schema(responses=EmployeeDirectoryDetail)
    def retrieve(self, request, pk=None):
        today = Clock.today_local()
        if not str(pk).isdigit():
            from django.http import Http404
            raise Http404
        employee = get_object_or_404(service.annotated_employees(service.visible_employees(request), today), pk=pk)
        row = service.row_of(employee, StatusTypeSelector.names_map())
        assignments = service.assignments_for([employee.pk], today)[str(employee.pk)]
        row['next_assignment'] = next((a for a in assignments if a['active']), None)
        row['assignments'] = sorted(
            [a for a in assignments if a['active']],
            key=lambda a: (
                1 if a['acknowledged_at'] else 0 if a['stage'] in ('ACKNOWLEDGEMENT', 'CONDUCT') else 2,
                a['date_start'], a['event_id'], a['id'],
            ),
        )
        row['history'] = [a for a in assignments if a['closed']][::-1]
        closed_ids = {a['event_id'] for a in row['history']}
        row['evaluations'] = [e for e in service.evaluations_for(employee.pk) if e['event_id'] in closed_ids]
        row['hire_date'] = employee.hire_date.isoformat() if employee.hire_date is not None else None
        row['work_phone'] = employee.work_phone
        row['work_email'] = employee.work_email
        return Response(row)

    @extend_schema(responses={200: dict})
    @action(detail=False, methods=['get'])
    def options(self, request):
        employees = service.visible_employees(request)
        scope = PermissionService.visible_division_ids(resolve_actor_id(request), 'personnel.view')
        divisions = Division.objects.all()
        if scope is not None:
            own_ids = employees.filter(user=request.user).values_list('staff_unit__division_id', flat=True)
            divisions = divisions.filter(pk__in=scope | {pk for pk in own_ids if pk is not None})
        divisions = divisions.order_by('tree_id', 'lft', 'id')
        return Response({
            'divisions': list(divisions.values('id', 'name', 'parent_id', 'level')),
            'statuses': [{'code': k, 'name': v} for k, v in StatusTypeSelector.names_map().items()],
        })
