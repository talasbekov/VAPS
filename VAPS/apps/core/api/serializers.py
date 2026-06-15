from rest_framework import serializers

from apps.core.models import (
    Division, Employee, EmployeeStaffingAssignment, Position, Rank, StaffingSlot,
)


class EmployeeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Employee
        fields = [
            "id",
            "external_id",
            "iin",
            "full_name",
            "last_name",
            "first_name",
            "middle_name",
            "rank_code",
            "rank_index",
            "position_code",
            "division",
            "phone",
            "gender",
            "height_cm",
            "is_active",
            "is_attached_force",
            "data_source",
            "personnel_number",
            "birth_date",
            "photo_file_path",
            "hire_date",
            "dismissal_date",
            "work_phone",
            "work_email",
            "personal_phone",
            "personal_email",
            "notes",
            "employment_status",
        ]
        read_only_fields = ["id", "full_name", "rank_index"]


class DivisionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Division
        fields = [
            "id", "organization", "parent", "type_code", "name", "code", "is_active",
        ]
        read_only_fields = ["id"]


class PositionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Position
        fields = ["code", "name", "level", "sort_order", "is_active"]


class RankSerializer(serializers.ModelSerializer):
    class Meta:
        model = Rank
        fields = ["code", "name", "category", "rank_index", "is_active"]


class StaffingSlotSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaffingSlot
        fields = [
            "id", "division", "position_code", "slot_number", "parent_slot",
            "is_active", "valid_from", "valid_to",
        ]
        read_only_fields = ["id"]


class StaffingAssignmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmployeeStaffingAssignment
        fields = ["id", "employee", "staffing_slot", "starts_at", "ends_at", "source"]
        read_only_fields = ["id"]
