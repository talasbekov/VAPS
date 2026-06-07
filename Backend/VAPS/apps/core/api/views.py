from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from apps.core.api.serializers import EmployeeSerializer
from apps.core.models import Employee
from apps.core.services import mask_employee_data


class DefaultPagination(PageNumberPagination):
    page_size = 50


def _permissions_from_request(request) -> set:
    raw = request.headers.get("X-User-Permissions", "")
    return {p.strip() for p in raw.split(",") if p.strip()}


class EmployeeViewSet(viewsets.ModelViewSet):
    serializer_class = EmployeeSerializer
    pagination_class = DefaultPagination
    http_method_names = ["get", "patch", "post"]

    def get_queryset(self):
        qs = Employee.objects.all().order_by("full_name")
        params = self.request.query_params
        if division_id := params.get("division_id"):
            qs = qs.filter(division_id=division_id)
        if status_code := params.get("status"):
            qs = qs.filter(employment_status=status_code)
        if rank_code := params.get("rank_code"):
            qs = qs.filter(rank_code=rank_code)
        if position_code := params.get("position_code"):
            qs = qs.filter(position_code=position_code)
        if search := params.get("search"):
            from django.db.models import Q
            qs = qs.filter(
                Q(full_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(first_name__icontains=search)
                | Q(personnel_number__icontains=search)
            )
        return qs

    def _mask(self, data):
        return mask_employee_data(data, user_permissions=_permissions_from_request(self.request))

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        serialized = [self._mask(EmployeeSerializer(e).data) for e in page]
        return self.get_paginated_response(serialized)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        return Response(self._mask(EmployeeSerializer(instance).data))

    @action(detail=True, methods=["post"])
    def archive(self, request, *args, **kwargs):
        emp = self.get_object()
        emp.employment_status = Employee.EmploymentStatus.ARCHIVED
        emp.is_active = False
        emp.save(update_fields=["employment_status", "is_active", "updated_at"])
        return Response(self._mask(EmployeeSerializer(emp).data), status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def restore(self, request, *args, **kwargs):
        emp = self.get_object()
        emp.employment_status = Employee.EmploymentStatus.WORKING
        emp.is_active = True
        emp.save(update_fields=["employment_status", "is_active", "updated_at"])
        return Response(self._mask(EmployeeSerializer(emp).data), status=status.HTTP_200_OK)
