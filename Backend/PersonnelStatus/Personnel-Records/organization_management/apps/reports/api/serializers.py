import uuid
from django.urls import reverse

from rest_framework import serializers
from organization_management.apps.reports.models import Report


class ReportSerializer(serializers.ModelSerializer):
    file = serializers.SerializerMethodField()

    class Meta:
        model = Report
        fields = "__all__"
        read_only_fields = (
            'id', 'job_id', 'status', 'file', 'error_message',
            'created_by', 'created_at', 'completed_at',
        )

    def validate_filters(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError('Фильтры должны быть объектом')
        return value

    def get_file(self, report) -> str | None:
        if not report.file:
            return None
        url = reverse('report-content', kwargs={'pk': report.pk})
        request = self.context.get('request')
        return request.build_absolute_uri(url) if request is not None else url

    def create(self, validated_data):
        # Генерируем уникальный job_id сразу при создании задания
        if not validated_data.get("job_id"):
            validated_data["job_id"] = uuid.uuid4().hex
        return super().create(validated_data)
