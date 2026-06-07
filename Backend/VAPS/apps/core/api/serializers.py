from rest_framework import serializers

from apps.core.models import Division, Employee


class EmployeeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Employee
        fields = [
            "id", "external_id", "iin", "full_name", "last_name", "first_name", "middle_name",
            "rank_code", "rank_index", "position_code", "division", "phone", "gender",
            "height_cm", "is_active", "is_attached_force", "data_source", "personnel_number",
            "birth_date", "photo_file_path", "hire_date", "dismissal_date", "work_phone",
            "work_email", "personal_phone", "personal_email", "notes", "employment_status",
        ]
        read_only_fields = ["id", "full_name", "rank_index"]


class DivisionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Division
        fields = [
            "id", "organization", "parent", "type_code", "name", "code", "is_active",
        ]
        read_only_fields = ["id"]
