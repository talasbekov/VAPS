"""Сериализаторы RBAC раздела ОМ (порт apps/operations/api/serializers.py
из Backend/VAPS; набор полей ответов — дословно).

Сериализаторы ЗАПРОСОВ (AssignRoleRequest/GrantTemporaryDutyRequest) —
добавка переезда: в источнике вьюхи читают request.data[...] напрямую, и
отсутствующее поле даёт KeyError → 500. Здесь недостающее/кривое поле даёт
честный 400 с указанием поля. Идентичность (created_by/actor) в тело запроса
не входит намеренно — она берётся из контракта аутентификации.
"""
from rest_framework import serializers

from organization_management.apps.operations.models import (
    Permission,
    Role,
    StatusType,
    TemporaryDutyPermission,
    UserRole,
)
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    Secondment,
)
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
from organization_management.apps.operations.validators import DUTY_ROLE_CHOICES


class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ["code", "name", "description", "is_active"]


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ["code", "name", "description", "is_active"]


class UserRoleSerializer(serializers.ModelSerializer):
    role_code = serializers.SlugRelatedField(slug_field="code", read_only=True)

    class Meta:
        model = UserRole
        fields = ["id", "user_id", "role_code", "scope_division_id", "is_active"]


class TemporaryDutySerializer(serializers.ModelSerializer):
    class Meta:
        model = TemporaryDutyPermission
        fields = [
            "id", "user_id", "employee_id", "duty_role_code", "scope_division_id",
            "event_id", "starts_at", "ends_at", "is_active", "created_by",
        ]


class AssignRoleRequestSerializer(serializers.Serializer):
    user_id = serializers.CharField(max_length=100)
    role_code = serializers.PrimaryKeyRelatedField(
        queryset=Role.objects.all(), pk_field=serializers.CharField()
    )
    scope_division_id = serializers.IntegerField(required=False, allow_null=True)


class GrantTemporaryDutyRequestSerializer(serializers.Serializer):
    user_id = serializers.CharField(max_length=100)
    duty_role_code = serializers.ChoiceField(choices=DUTY_ROLE_CHOICES)
    starts_at = serializers.DateTimeField()
    ends_at = serializers.DateTimeField()
    employee_id = serializers.IntegerField(required=False, allow_null=True)
    scope_division_id = serializers.IntegerField(required=False, allow_null=True)
    event_id = serializers.IntegerField(required=False, allow_null=True)

    def validate(self, attrs):
        # Тот же инвариант, что и в TemporaryDutyPermission.clean(), но
        # сработавший ДО записи — иначе ValidationError модели ушёл бы 500-й.
        if attrs["starts_at"] >= attrs["ends_at"]:
            raise serializers.ValidationError(
                {"ends_at": "Окончание должно быть позже начала."}
            )
        return attrs


class StatusTypeSerializer(serializers.ModelSerializer):
    """Справочник типов статусов. legacy_code отдаётся наружу намеренно:
    потребитель, читающий данные старой системы, должен уметь сопоставить
    строку со словарём без второго источника правды."""

    class Meta:
        model = StatusType
        fields = [
            "code", "name", "legacy_code", "priority", "report_column_code",
            "is_hard_block", "restricts_editing", "counts_in_list",
            "counts_in_staff", "is_ku_owned", "max_duration_days", "color",
            "is_active",
        ]


# Предел одной пачки: массовое обновление одного подразделения — это десятки
# строк; тысяча уже говорит об ошибке интеграции, а не о работе оператора.
MAX_BULK_ROWS = 1000


class BulkStatusCreateRowSerializer(serializers.Serializer):
    """Одна строка-отклонение пачки.

    Четыре обязательных ключа зеркалят _REQUIRED_ROW_KEYS сервиса: их
    отсутствие ловится ДО сервиса и даёт 400 с указанием поля. employee_id —
    целый pk старых employees (в источнике UUID).
    """

    employee_id = serializers.IntegerField()
    status_type_code = serializers.CharField(max_length=50)
    date_start = serializers.DateField()
    date_end = serializers.DateField()
    comment = serializers.CharField(required=False, allow_blank=True)
    document_basis = serializers.CharField(required=False, allow_blank=True)
    source_ref = serializers.CharField(required=False, allow_blank=True)


class BulkStatusCreateSerializer(serializers.Serializer):
    """Тело POST массового создания статусов.

    Без division_id: область видимости берётся из RBAC актора, а не из тела
    запроса — фронту здесь не доверяем.
    """

    business_date = serializers.DateField()
    rows = BulkStatusCreateRowSerializer(
        many=True, allow_empty=False, max_length=MAX_BULK_ROWS
    )


class OpsEmployeeStatusSerializer(serializers.ModelSerializer):
    """Строка статуса раздела ОМ наружу.

    state не хранится, а выводится из дат и факта отмены на ТЕКУЩУЮ
    бизнес-дату (Clock раздела) — клиенту незачем повторять этот вывод у
    себя и расходиться с сервером в полночь.
    """

    state = serializers.SerializerMethodField()

    class Meta:
        model = OpsEmployeeStatus
        fields = [
            "id", "employee_id", "status_type_code", "date_start", "date_end",
            "state", "source", "source_ref", "comment", "document_basis",
            "cancelled_at", "cancelled_by", "cancelled_reason",
            "created_by", "created_at", "updated_at",
        ]

    def get_state(self, obj) -> str:
        return str(obj.state)


class SecondmentSerializer(serializers.ModelSerializer):
    """Связь пары прикомандирования наружу.

    Ноги отдаются идентификаторами: строки статусов читаются своим маршрутом,
    и дублировать их здесь значило бы завести второй источник правды о них.
    Стадия рукопожатия не хранится, а выводится из фактов сервером — клиенту
    незачем повторять этот вывод у себя и расходиться с фильтром по стадии.
    Сами факты (кто и когда) остаются в ответе: стадия отвечает «где мы»,
    факты — «кто это решил».
    """

    state = serializers.SerializerMethodField()

    class Meta:
        model = Secondment
        fields = [
            "id", "employee_id", "state", "out_status", "in_status",
            "from_division_id", "to_division_id", "document_basis",
            "return_requested_at", "return_requested_by",
            "return_confirmed_at", "return_confirmed_by",
            "created_by", "created_at", "updated_at",
        ]

    def get_state(self, obj) -> str:
        return str(obj.state)


class SecondmentCreateSerializer(serializers.Serializer):
    """Тело POST откомандирования.

    Штатного подразделения в теле НЕТ: оно берётся из штатной единицы
    сотрудника — присланному «откуда» здесь не верят, иначе оператор мог бы
    назначить источник пары произвольно. actor тоже не входит: кто
    откомандировал — факт из контракта аутентификации.
    """

    employee_id = serializers.IntegerField()
    to_division_id = serializers.IntegerField()
    date_start = serializers.DateField()
    date_end = serializers.DateField()
    document_basis = serializers.CharField(required=False, allow_blank=True)


class SecondmentReturnConfirmSerializer(serializers.Serializer):
    """Тело подтверждения возврата: причина нужна только НЕ НАЧАВШЕЙСЯ паре.

    Такую пару подтверждение отменяет, и причина уходит в факты отмены. У
    идущей пары причины нет — она закрывается датой, а не отменяется, поэтому
    поле необязательное: требовать его всегда значило бы просить объяснение
    там, где объяснять нечего.
    """

    reason = serializers.CharField(required=False, allow_blank=True, max_length=1000)


class StatusUpdateSerializer(serializers.Serializer):
    """Тело PATCH правки статуса: интервал и метаданные, все поля
    необязательные.

    Пустое тело — 400, а не «успешный» no-op: правка без единого поля это
    ошибка клиента, и отвечать на неё 200-м значило бы подтверждать
    несделанную работу.

    Неизменяемые поля перечислены явно и при попытке их прислать дают 400 с
    указанием поля. Молчаливо игнорировать их (штатное поведение DRF для
    неизвестных ключей) нельзя: клиент, отправивший смену status_type_code,
    получил бы 200 и остался уверен, что тип сменился. Смена типа или
    сотрудника — это ДРУГАЯ строка (отменить и создать), а факты отмены
    append-once и правкой не переписываются.
    """

    IMMUTABLE_FIELDS = (
        "employee_id",
        "status_type_code",
        "source",
        "source_ref",
        "cancelled_at",
        "cancelled_by",
        "cancelled_reason",
    )

    date_start = serializers.DateField(required=False)
    date_end = serializers.DateField(required=False)
    comment = serializers.CharField(required=False, allow_blank=True)
    document_basis = serializers.CharField(
        required=False, allow_blank=True, max_length=255
    )

    def validate(self, attrs):
        raw = self.initial_data if isinstance(self.initial_data, dict) else {}
        forbidden = [name for name in self.IMMUTABLE_FIELDS if name in raw]
        if forbidden:
            raise serializers.ValidationError(
                {name: "Поле неизменяемо." for name in forbidden}
            )
        if not attrs:
            raise serializers.ValidationError(
                "Пустое тело правки: укажите хотя бы одно изменяемое поле."
            )
        return attrs


class StatusCancelSerializer(serializers.Serializer):
    """Тело отмены статуса: одна обязательная непустая причина.

    Пробельная причина отсекается здесь же (CharField по умолчанию режет
    пробелы, и "   " становится пустой строкой) — это ВЛАДЕЛЕЦ проверки на
    HTTP-границе. Одноимённый гард в cancel_status остаётся контрактом
    СЕРВИСА для остальных вызывающих (пачки, будущих оркестраторов) и
    покрыт его собственными тестами.

    actor/cancelled_by в тело не входят: кто отменил — факт из контракта
    аутентификации, а не присланное клиентом имя.
    """

    reason = serializers.CharField(allow_blank=False, max_length=1000)


class DailySubmissionCreateSerializer(serializers.Serializer):
    """Тело POST сдачи дня: ровно два параметра, которые вьюха передаёт в
    сервис.

    Бизнес-дата ОБЯЗАТЕЛЬНА и приходит явно: сдача «на завтра» — штатный
    режим раздела, и молчаливая подстановка сегодняшней даты записала бы
    заявление не тем днём. Окно допустимых дат проверяет сервис; здесь
    только форма.

    Идентичность в тело не входит, как и везде в разделе: submitted_by —
    факт из контракта аутентификации, а не присланное клиентом имя.
    """

    division_id = serializers.IntegerField()
    business_date = serializers.DateField()


class OpsDailySubmissionSerializer(serializers.ModelSerializer):
    """Строка сдачи наружу — БЕЗ снимка и без полей поправки.

    Снимок весит десятки-сотни килобайт на подразделение и нужен читателю
    расхода, у которого будет свой маршрут. Возвращать его в ответе на
    запись значило бы отдавать клиенту содержимое, которое он не запрашивал,
    умноженное на размер подразделения.

    reason/sanction/triggered_by_status_id — атрибуты ПОПРАВКИ, у первичной
    сдачи всегда пустые; их место в проекции поправки, а не здесь.
    """

    class Meta:
        model = OpsDailySubmission
        fields = [
            "id", "division_id", "business_date", "version", "is_current",
            "event", "submitted_by", "submitted_at", "late",
        ]
        read_only_fields = fields


class OpsAuditLogSerializer(serializers.ModelSerializer):
    """Строка журнала раздела как её видит читатель.

    Снимки old_value/new_value отдаются КАК ЕСТЬ: они уже плоские и
    JSON-безопасные (см. audit_service.status_snapshot), и разбирать их на
    поля здесь значило бы завести второе представление события, которое
    разъедется с первым при первой же смене снимка.
    """

    class Meta:
        model = OpsAuditLog
        fields = [
            "id",
            "actor_user_id",
            "action",
            "entity_type",
            "entity_id",
            "old_value",
            "new_value",
            "reason",
            "created_at",
        ]
