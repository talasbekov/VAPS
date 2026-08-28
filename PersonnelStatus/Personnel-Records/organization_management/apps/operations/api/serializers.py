"""Сериализаторы RBAC раздела ОМ (порт apps/operations/api/serializers.py
из Backend/VAPS; набор полей ответов — дословно).

Сериализаторы ЗАПРОСОВ (AssignRoleRequest/GrantTemporaryDutyRequest) —
добавка переезда: в источнике вьюхи читают request.data[...] напрямую, и
отсутствующее поле даёт KeyError → 500. Здесь недостающее/кривое поле даёт
честный 400 с указанием поля. Идентичность (created_by/actor) в тело запроса
не входит намеренно — она берётся из контракта аутентификации.
"""
from django.utils.dateparse import parse_datetime
from rest_framework import serializers

from organization_management.apps.operations.models import (
    Permission,
    Role,
    StatusType,
    TemporaryDutyPermission,
    UserRole,
)
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_notification import (
    OpsNotification,
)
from organization_management.apps.operations.models_document import (
    OpsIssuedDocument,
)
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    Secondment,
)
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
    OpsTomorrowBlockOverride,
)
from organization_management.apps.operations.validators import DUTY_ROLE_CHOICES


class StatusParticipationSerializer(serializers.Serializer):
    """Участие статуса в ОДНОМ мероприятии (Plane №274, Ш-3).

    Коды видов и ролей НЕ перечисляются здесь списком: они живут в
    справочниках и меняются администратором, а сериализатор с зашитым списком
    начал бы отбивать значения, законно заведённые вчера. Проверяет их сервис
    — там же, где известен состав справочника.
    """

    event_id = serializers.IntegerField()
    kind_code = serializers.CharField(max_length=100)
    role_code = serializers.CharField(
        required=False, allow_blank=True, max_length=100
    )


class RoleSerializer(serializers.ModelSerializer):
    # Состав прав едет ВМЕСТЕ с ролью (Plane №36, «П-3»): реестр ролей без
    # него отвечает на вопрос «как называется», а спрашивают у него «что
    # открывает». Второй запрос на строку список превратил бы в N+1 — от него
    # спасает prefetch_related во вьюхе, а не отдельная ручка.
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = Role
        fields = ["code", "name", "description", "is_active", "permissions"]

    def get_permissions(self, role) -> list[str]:
        return sorted(
            link.permission_code_id for link in role.role_permissions.all()
        )


class RolePermissionsRequestSerializer(serializers.Serializer):
    """Правка состава прав роли: добавить и/или снять одним обращением.

    Оба списка в ОДНОМ запросе намеренно: на экране состав правят галочками и
    сохраняют разом, а два обращения оставили бы роль в промежуточном
    состоянии, если второе не дойдёт.
    """

    add = serializers.ListField(
        child=serializers.CharField(), required=False, default=list
    )
    remove = serializers.ListField(
        child=serializers.CharField(), required=False, default=list
    )

    def validate(self, attrs):
        add = attrs.get("add") or []
        remove = attrs.get("remove") or []
        if not add and not remove:
            raise serializers.ValidationError("add or remove must be non-empty")
        both = set(add) & set(remove)
        if both:
            # Молча предпочесть одно другому значило бы решить за
            # отправителя; такой запрос — ошибка формы, а не выбор.
            raise serializers.ValidationError(
                f"permission listed in both add and remove: {sorted(both)}"
            )
        unknown = sorted(
            set(add) - set(Permission.objects.filter(code__in=add).values_list(
                "code", flat=True
            ))
        )
        if unknown:
            # Право, которого нет в справочнике, не открывает ничего: гейт
            # сверяется с кодом, а не с намерением. Молчаливая выдача
            # оставила бы роль с мёртвым кодом внутри.
            raise serializers.ValidationError(f"unknown permission: {unknown}")
        attrs["add"] = add
        attrs["remove"] = remove
        return attrs


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ["code", "name", "description", "is_active"]


class UserRoleSerializer(serializers.ModelSerializer):
    role_code = serializers.SlugRelatedField(slug_field="code", read_only=True)
    # Имена — рядом с идентификаторами (Plane №36, «П-4»), а не вместо них:
    # экран показывает человека и область словами, а клиент продолжает
    # ветвиться по кодам. Разрешение идёт СПРАВОЧНИКАМИ ИЗ КОНТЕКСТА (одна
    # выборка на страницу во вьюхе), иначе список делал бы по два запроса на
    # строку.
    #
    # null у имени — не «поле забыли»: назначение живёт на строковом user_id
    # без внешнего ключа (источник идентичности сменный), и у выданной роли
    # удалённого пользователя имени действительно нет. Пустое имя рядом с
    # живым id честнее, чем скрытая строка.
    user_login = serializers.SerializerMethodField()
    user_full_name = serializers.SerializerMethodField()
    role_name = serializers.SerializerMethodField()
    scope_division_name = serializers.SerializerMethodField()

    class Meta:
        model = UserRole
        fields = [
            "id",
            "user_id",
            "user_login",
            "user_full_name",
            "role_code",
            "role_name",
            "scope_division_id",
            "scope_division_name",
            "is_active",
        ]

    def _user(self, user_role):
        return (self.context.get("users") or {}).get(str(user_role.user_id))

    def get_user_login(self, user_role) -> str | None:
        user = self._user(user_role)
        return user.username if user is not None else None

    def get_user_full_name(self, user_role) -> str | None:
        user = self._user(user_role)
        if user is None:
            return None
        return user.get_full_name() or None

    def get_role_name(self, user_role) -> str | None:
        role = user_role.role_code
        return role.name if role is not None else None

    def get_scope_division_name(self, user_role) -> str | None:
        if user_role.scope_division_id is None:
            # Безобластное назначение — «вся служба»; подписывает его КЛИЕНТ:
            # строки «вся служба» в справочнике подразделений нет, и выдумывать
            # её на сервере значило бы отдать клиенту имя несуществующей
            # записи.
            return None
        return (self.context.get("divisions") or {}).get(
            user_role.scope_division_id
        )


class TemporaryDutySerializer(serializers.ModelSerializer):
    class Meta:
        model = TemporaryDutyPermission
        fields = [
            "id", "user_id", "employee_id", "duty_role_code", "scope_division_id",
            "event_id", "starts_at", "ends_at", "is_active", "created_by",
        ]


class AccountSerializer(serializers.ModelSerializer):
    """Учётная запись раздела доступа (Plane №36, «П-5»).

    Пароля в ответе нет ни в каком виде — ни хеша, ни признака: хеш это
    материал для перебора, и отдавать его тому, кто просто открыл список
    людей, незачем. Временный пароль приходит ОТДЕЛЬНЫМ полем ответа и только
    у двух действий (заведение и сброс), один раз.
    """

    full_name = serializers.SerializerMethodField()
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        from django.contrib.auth.models import User as _User

        model = _User
        fields = [
            "id",
            "username",
            "first_name",
            "last_name",
            "full_name",
            "email",
            "is_active",
            "last_login",
            "password",
        ]
        read_only_fields = ["id", "last_login"]

    def get_full_name(self, user) -> str | None:
        return user.get_full_name() or None

    def validate_password(self, value):
        if not value:
            return value
        from django.contrib.auth.password_validation import validate_password
        from django.core.exceptions import ValidationError as DjangoValidationError

        try:
            # Правила стойкости — те же, что у остальных входов в систему:
            # свой набор здесь означал бы, что заведённая администратором
            # учётка слабее заведённой любым другим путём.
            validate_password(value)
        except DjangoValidationError as error:
            raise serializers.ValidationError(list(error.messages))
        return value


class AssignRoleRequestSerializer(serializers.Serializer):
    user_id = serializers.CharField(max_length=100)
    role_code = serializers.PrimaryKeyRelatedField(
        queryset=Role.objects.all(), pk_field=serializers.CharField()
    )
    scope_division_id = serializers.IntegerField(required=False, allow_null=True)

    def validate_scope_division_id(self, value):
        # Область — не свободное число: внешнего ключа у поля нет (оно
        # переживает переезд справочника), и без этой проверки опечатка в id
        # завела бы роль с областью, которой не существует, — человек молча
        # не увидел бы НИЧЕГО, а причина не читалась бы ниоткуда.
        if value is None:
            return value
        from organization_management.apps.divisions.models import Division

        if not Division.objects.filter(id=value).exists():
            raise serializers.ValidationError("Подразделения с таким id нет.")
        return value


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
    # Мероприятия статуса. НЕОБЯЗАТЕЛЬНО и БЕЗ значения по умолчанию:
    # «ключа нет» и «прислали пусто» — разные заявления, и default=[] стёр бы
    # эту разницу ещё до сервиса.
    participations = StatusParticipationSerializer(many=True, required=False)
    comment = serializers.CharField(required=False, allow_blank=True)
    document_basis = serializers.CharField(required=False, allow_blank=True)
    source_ref = serializers.CharField(required=False, allow_blank=True)


class StatusResolveSerializer(serializers.Serializer):
    """Тело разрешения строки-заглушки: чем заменить, за какой период и на
    каком основании.

    Причина обязательна и непуста — здесь, на границе, как и у отмены; тот же
    гард в сервисе остаётся контрактом для прочих вызывающих.

    `employee_id` в теле нет: разрешение не переносит строку на другого
    человека — это была бы другая операция, а не выяснение обстановки.
    """

    resolved_type_code = serializers.CharField(max_length=50)
    date_start = serializers.DateField()
    date_end = serializers.DateField()
    reason = serializers.CharField(allow_blank=False, max_length=1000)
    override = serializers.BooleanField(required=False, default=False)
    override_reason = serializers.CharField(
        required=False, allow_blank=True, max_length=1000
    )


class BulkStatusCreateSerializer(serializers.Serializer):
    """Тело POST массового создания статусов.

    Без division_id: область видимости берётся из RBAC актора, а не из тела
    запроса — фронту здесь не доверяем.
    """

    business_date = serializers.DateField()
    rows = BulkStatusCreateRowSerializer(
        many=True, allow_empty=False, max_length=MAX_BULK_ROWS
    )
    # Объяснение поправки: требуется, только если интервалы пачки задевают
    # сданные дни. Обязательным его делать нельзя — утренняя пачка обычно не
    # задевает ничего сданного, и поле-заглушка научило бы писать «пачка».
    amendment_reason = serializers.CharField(
        required=False, allow_blank=True, max_length=255
    )


class OpsEmployeeStatusSerializer(serializers.ModelSerializer):
    """Строка статуса раздела ОМ наружу.

    state не хранится, а выводится из дат и факта отмены на ТЕКУЩУЮ
    бизнес-дату (Clock раздела) — клиенту незачем повторять этот вывод у
    себя и расходиться с сервером в полночь.
    """

    state = serializers.SerializerMethodField()
    # Мероприятия статуса ЕДУТ НАРУЖУ вместе со строкой (Plane №274): экран
    # правки открывает уже выбранное, и вторым запросом за ними ходить некуда
    # — их немного и они принадлежат этой же строке.
    participations = StatusParticipationSerializer(many=True, read_only=True)

    class Meta:
        model = OpsEmployeeStatus
        fields = [
            "id", "employee_id", "status_type_code", "date_start", "date_end",
            "state", "source", "source_ref", "comment", "document_basis",
            "participations",
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

    `amendment_reason` — не правка, а ОБЪЯСНЕНИЕ правки: он требуется, только
    если интервал задевает сданный день, и сам по себе изменением не
    считается (тело из одной причины — то же пустое тело).

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
    # Мероприятия статуса (Plane №274). Смена только их — ПОЛНОЦЕННАЯ правка:
    # ниже они не исключаются из проверки на пустое тело, иначе «поменял
    # список ОМ, ничего больше» отбивалось бы как пустое.
    participations = StatusParticipationSerializer(many=True, required=False)
    amendment_reason = serializers.CharField(
        required=False, allow_blank=True, max_length=255
    )

    def validate(self, attrs):
        raw = self.initial_data if isinstance(self.initial_data, dict) else {}
        forbidden = [name for name in self.IMMUTABLE_FIELDS if name in raw]
        if forbidden:
            raise serializers.ValidationError(
                {name: "Поле неизменяемо." for name in forbidden}
            )
        if not {name: value for name, value in attrs.items() if name != "amendment_reason"}:
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


class DailySubmissionAmendSerializer(serializers.Serializer):
    """Тело POST поправки: ровно причина и санкция.

    Обе обязательны и непусты — CharField по умолчанию режет пробелы, так
    что "   " становится пустой строкой и отбивается здесь же. Одноимённый
    гард в amend_day остаётся контрактом СЕРВИСА для остальных вызывающих
    (будущий хук ретро-правки), и покрыт его собственными тестами.

    Длина санкции ограничена так же, как колонка модели: без этого
    великанское значение доехало бы до Postgres DataError → 500 вместо 400.
    Причина — TextField, её не ограничиваем намеренно.

    `triggered_by_status_id` НЕ принимается: это ссылка на строку статуса,
    вызвавшую поправку, и её ставит система, когда научится дёргать поправку
    сама. Принять её от клиента значило бы позволить ему приписать поправке
    произвольное происхождение.
    """

    reason = serializers.CharField(allow_blank=False)
    sanction = serializers.CharField(allow_blank=False, max_length=255)


class OpsDailySubmissionAmendedSerializer(serializers.ModelSerializer):
    """Проекция ПОПРАВКИ: строка сдачи плюс её объяснение.

    Отличие от источника, где ответ на поправку — та же проекция, что у
    первичной сдачи: там клиент не видит в ответе ни причины, ни санкции,
    то есть не может убедиться, ЧТО именно записано (текст обрезается
    сервисом, и присланное не равно сохранённому). Снимка здесь по-прежнему
    нет — он едет своим маршрутом чтения.
    """

    class Meta:
        model = OpsDailySubmission
        fields = OpsDailySubmissionSerializer.Meta.fields + [
            "reason", "sanction", "triggered_by_status_id",
        ]
        read_only_fields = fields


class OpsDailySubmissionDetailSerializer(serializers.ModelSerializer):
    """Одна сдача целиком — ЕДИНСТВЕННЫЙ канал, отдающий снимок.

    Снимок здесь не роскошь, а смысл маршрута: расход и светофор строятся из
    сданного, а не из живых данных, и без него читатель вынужден был бы
    пересобирать состав заново — то есть увидеть не то, под чем подписалось
    подразделение. Ровно поэтому снимка нет ни в списке, ни в ответах на
    запись: тяжёлое содержимое отдаётся только тому, кто попросил конкретную
    версию.
    """

    class Meta:
        model = OpsDailySubmission
        fields = OpsDailySubmissionAmendedSerializer.Meta.fields + ["snapshot"]
        read_only_fields = fields


class TrafficLightTreeFilterSerializer(serializers.Serializer):
    """Параметры запроса светофора: оба НЕОБЯЗАТЕЛЬНЫ.

    Корень по умолчанию выводится из области актора — экран руководителя не
    обязан знать, какой у него корень. Дата по умолчанию сегодняшняя по часам
    раздела: у сервера и у браузера «сегодня» на границе суток разное, и
    молчаливо доверять клиентской дате нельзя.

    Мусор отбивается здесь: нецелой корень и не-ISO дата дают 400 с именем
    поля, а не сырой ValueError из глубины сервиса. Параметра глубины нет —
    свод отдаёт поддерево целиком.
    """

    root_division_id = serializers.IntegerField(required=False)
    business_date = serializers.DateField(required=False)


class SubmittedExpenseFilterSerializer(serializers.Serializer):
    """Параметры расхода по СДАННОМУ дню: подразделение ОБЯЗАТЕЛЬНО.

    Обязательность здесь — свойство предмета, а не придирка к форме: сдают
    подразделения поштучно, и у поддерева одного снимка не существует. Свод
    сданных расходов по дереву был бы суммой РАЗНЫХ заявлений, часть которых
    вообще не сделана, и отличить в такой сумме «людей нет» от «не сдавали»
    стало бы нечем. Поэтому умолчания «вся область актора», как у живого
    расхода, тут нет.

    Дата необязательна, по умолчанию сегодняшняя по часам раздела — тем же
    доводом, что у светофора: у сервера и браузера «сегодня» на границе суток
    разное.
    """

    division_id = serializers.IntegerField()
    business_date = serializers.DateField(required=False)


class TrafficLightDivisionFilterSerializer(serializers.Serializer):
    """Параметр точечного светофора: только день, и он необязателен.

    Подразделение приходит адресом, а не телом запроса: цвет спрашивают У
    КОНКРЕТНОГО узла, и второй способ его назвать разошёлся бы с гардом
    области.
    """

    business_date = serializers.DateField(required=False)


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


class OpsNotificationSerializer(serializers.ModelSerializer):
    """Уведомление раздела как его видит получатель.

    Плоская проекция ФАКТА: вид, деловая дата и данные. Слов здесь нет и не
    будет — их складывает читающий экран (см. модель), и переписать
    формулировку можно не трогая историю. payload отдаётся КАК ЕСТЬ: он уже
    плоский и JSON-безопасный, а разложив его на поля, вьюха завела бы второе
    представление факта, разъезжающееся с первым при первом же новом виде.

    read_at отдаётся, хотя проставить его пока нечем: «прочитано» — это
    МОМЕНТ, и лента без него не отличит новое от уже виденного. Отметка
    прочтения — отдельный срез.
    """

    class Meta:
        model = OpsNotification
        fields = [
            "id",
            # Получатель — всегда сам читатель (лента личная), и всё же он в
            # проекции: ответ обязан быть самодостаточным для того, кто читает
            # его из журнала запросов или из выгрузки, где вопроса «чей это
            # ответ» задать уже некому.
            "recipient",
            "kind",
            "business_date",
            "payload",
            "read_at",
            "created_at",
        ]
        read_only_fields = fields


class TomorrowBlockOverrideCreateSerializer(serializers.Serializer):
    """Тело POST обхода блокировки: дата и причина.

    Причина ОБЯЗАТЕЛЬНА и непуста уже на форме — отказ по форме внятнее, чем
    отказ по бизнес-правилу за то же самое. Сервис и БД её всё равно
    проверяют: маршрут не единственный вход, а последнюю линию держит база.

    Ответственный в тело не входит, как и везде в разделе: обход подписывает
    тот, кто аутентифицирован, а не тот, кого назвали в JSON.
    """

    business_date = serializers.DateField()
    reason = serializers.CharField(allow_blank=False, max_length=1000)


class OpsTomorrowBlockOverrideSerializer(serializers.ModelSerializer):
    """Записанный обход наружу: кто, когда, почему и на какую дату."""

    class Meta:
        model = OpsTomorrowBlockOverride
        fields = ["id", "business_date", "overridden_by", "reason", "created_at"]


class SummaryAssembleSerializer(serializers.Serializer):
    """Тело сборки сводки: подразделение и день.

    Те же два параметра, что у сдачи дня, и по той же причине: бизнес-дата
    приходит явно, потому что сводку собирают и «на завтра», и молчаливая
    подстановка сегодняшней записала бы её не тем днём.
    """

    division_id = serializers.IntegerField()
    business_date = serializers.DateField()


class SummaryRebuildSerializer(serializers.Serializer):
    """Тело пересборки: к дню добавляются причина и санкция.

    Пересборка — поправка сводки, и объясняется она так же, как поправка
    сданного дня: без причины она неотличима от тихой подмены заявления.
    """

    division_id = serializers.IntegerField()
    business_date = serializers.DateField()
    reason = serializers.CharField(allow_blank=False, max_length=1000)
    sanction = serializers.CharField(allow_blank=False, max_length=255)


class DocumentReleaseSerializer(serializers.Serializer):
    """Тело выпуска расхода: подразделение и день.

    Причины здесь нет: первый выпуск дня ничего не отменяет и объяснять ему
    нечего. У замены она обязательна — и потому у замены своя форма, а не
    необязательное поле в этой. Необязательное поле означало бы, что замену
    можно попросить молча.

    Выпускающий в тело не входит, как и везде в разделе: документ подписывает
    тот, кто аутентифицирован, а не тот, кого назвали в JSON.
    """

    division_id = serializers.IntegerField()
    business_date = serializers.DateField()


class DocumentReissueSerializer(DocumentReleaseSerializer):
    """Тело замены документа: то же плюс ОБЯЗАТЕЛЬНАЯ причина.

    Непустота проверяется уже на форме — отказ по форме внятнее, чем отказ по
    бизнес-правилу за то же самое. Сервис и база её всё равно проверяют:
    маршрут не единственный вход, а последнюю линию держит база.
    """

    reason = serializers.CharField(allow_blank=False, max_length=1000)


class OpsIssuedDocumentSerializer(serializers.ModelSerializer):
    """Выпуск наружу: номер, день, состояние и метаданные файла.

    Ключ хранения (storage_key) НАРУЖУ НЕ ВЫХОДИТ. Он и есть имя файла во
    внутренней локации веб-сервера, и отданный клиенту превратил бы приватное
    хранилище в адресуемое: скачивание пошло бы мимо права, мимо сверки
    дайджеста и мимо журнала. Наружу едет идентификатор ВЛОЖЕНИЯ — по нему
    маршрут скачивания и найдёт байты, проверив всё перечисленное.
    """

    attachment_id = serializers.IntegerField(read_only=True)
    original_name = serializers.CharField(
        source="attachment.original_name", read_only=True
    )
    content_type = serializers.CharField(
        source="attachment.content_type", read_only=True
    )
    size = serializers.IntegerField(source="attachment.size", read_only=True)
    sha256 = serializers.CharField(source="attachment.sha256", read_only=True)
    supersedes_number = serializers.IntegerField(
        source="supersedes.number", read_only=True, allow_null=True
    )

    class Meta:
        model = OpsIssuedDocument
        fields = [
            "id",
            "doc_type",
            "number",
            "year",
            "business_date",
            "division_id",
            "submission_id",
            "submission_version",
            "status",
            "reason",
            "supersedes",
            "supersedes_number",
            "attachment_id",
            "original_name",
            "content_type",
            "size",
            "sha256",
            "created_by",
            "created_at",
        ]


class NotificationReadAllSerializer(serializers.Serializer):
    """Тело массовой отметки: необязательная верхняя граница.

    Граница НЕОБЯЗАТЕЛЬНА намеренно: «прочитать всё» — законное намерение, и
    требовать от клиента момент значило бы заставлять его выдумывать «сейчас»,
    то есть читать часы на своей стороне. Но когда граница подана, она несёт
    смысл — «всё, что я ВИДЕЛ», — и потому это отдельное поле, а не умолчание
    сервера.

    ЗОНА ОБЯЗАТЕЛЬНА, тем же доводом, что и у курсора ленты: наивный
    «2026-08-05T12:00» в поясе +05 сдвигает границу на пять часов, и человек,
    отметивший «всё, что видел», прочитал бы вдобавок то, чего не видел.

    Разбор идёт по СЫРОЙ строке, а не через DateTimeField: тот молча достраивает
    наивный момент текущей зоной проекта — то есть делает ровно то, чего мы
    здесь не хотим, и делает молча. Это тот же разбор, что у `since` в query,
    и двум границам раздела расходиться в этом незачем.
    """

    until = serializers.CharField(required=False, allow_null=True)

    def validate_until(self, value):
        if value in (None, ""):
            return None
        parsed = parse_datetime(value)
        if parsed is None:
            raise serializers.ValidationError(
                "Ожидается момент в формате ISO 8601 с указанием зоны."
            )
        if parsed.utcoffset() is None:
            raise serializers.ValidationError(
                "Укажите часовой пояс (например, +05:00 или Z)."
            )
        return parsed


class StatusCompleteSerializer(serializers.Serializer):
    """Тело досрочного завершения: фактическая дата окончания.

    Дата ОБЯЗАТЕЛЬНА и умолчания не имеет. Соблазн подставить «сегодня»
    отвергнут: досрочное завершение фиксирует ФАКТ («вернулся третьего»), и
    подставленное сегодня молча записало бы не тот день — а исправлять его
    пришлось бы уже поправкой сдачи.

    `amendment_reason` — не часть операции, а объяснение того, что она задела
    сданный день; требуется только тогда и проверяется сервисом.
    """

    actual_end = serializers.DateField()
    amendment_reason = serializers.CharField(
        required=False, allow_blank=True, max_length=255
    )


class StatusExtendSerializer(serializers.Serializer):
    """Тело продления: новая дата конца плюс протокол обхода мягкого конфликта.

    Обход здесь тот же, что у правки и разрешения заглушки, и намеренно тот же:
    оператор, научившийся обходить пересечение в одном месте раздела, не должен
    заново выяснять правила в другом. Причина обхода обязательна — обход без
    объяснения неотличим от продавливания.
    """

    new_date_end = serializers.DateField()
    override = serializers.BooleanField(required=False, default=False)
    override_reason = serializers.CharField(
        required=False, allow_blank=True, max_length=1000
    )
    amendment_reason = serializers.CharField(
        required=False, allow_blank=True, max_length=255
    )

    def validate(self, attrs):
        if attrs.get("override") and not attrs.get("override_reason", "").strip():
            raise serializers.ValidationError(
                {"override_reason": "Обход конфликта требует причины."}
            )
        return attrs


class StatusCreateSerializer(serializers.Serializer):
    """Тело создания ОДНОГО статуса.

    Существует ради того, чего массовый путь не умеет: ОБХОДА мягкого
    пересечения. Пачка такой конфликт только сообщает — обхода у неё нет и не
    предвидится (она валидирует все строки разом, и «обойти» пришлось бы
    выборочно), и оператору некуда было идти: одиночного маршрута тоже не
    существовало. Обход здесь тот же, что у правки, продления и разрешения
    заглушки: флаг плюс непустая причина.

    Сотрудник и тип приходят в теле и НЕизменяемы после создания: смена любого
    из них — это другая строка (отменить и создать), а не правка.
    """

    employee_id = serializers.IntegerField()
    status_type_code = serializers.CharField(max_length=50)
    date_start = serializers.DateField()
    date_end = serializers.DateField()
    comment = serializers.CharField(required=False, allow_blank=True)
    document_basis = serializers.CharField(
        required=False, allow_blank=True, max_length=255
    )
    override = serializers.BooleanField(required=False, default=False)
    override_reason = serializers.CharField(
        required=False, allow_blank=True, max_length=1000
    )
    amendment_reason = serializers.CharField(
        required=False, allow_blank=True, max_length=255
    )

    def validate(self, attrs):
        if attrs.get("override") and not attrs.get("override_reason", "").strip():
            raise serializers.ValidationError(
                {"override_reason": "Обход конфликта требует причины."}
            )
        return attrs
