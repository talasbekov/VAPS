"""Сервисы авторизации раздела ОМ (порт apps/operations/services.py из
Backend/VAPS; логика не менялась, заменены только импорты на старый проект).
"""
from django.core.exceptions import ValidationError
from django.db import transaction

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models import (
    Role,
    RolePermission,
    TemporaryDutyPermission,
    UserRole,
)
from organization_management.apps.operations.selectors import (
    DivisionTreeSelector,
    OpsUserRoleSelector,
)

WILDCARD = "*"
# Право управлять доступом. Вынесено константой, потому что его спрашивает не
# только гейт ручки: на нём же держится отбой «снял админскую роль сам у
# себя», и разъехавшийся литерал сделал бы отбой молча бесполезным.
ACCESS_ADMIN_PERMISSION = "admin.roles"


class PermissionService:
    """Stateless-резолюция авторизации: все проверки идут через неё."""

    @staticmethod
    def _scope_matches(scope_division_id, division_id) -> bool:
        if scope_division_id is None:
            return True
        if division_id is None:
            # Scope сужает только division-специфичные проверки; глобальные
            # проходят.
            return True
        return division_id in DivisionTreeSelector.subtree_ids(scope_division_id)

    @classmethod
    def _active_grants(cls, user_id) -> list:
        """Пары (scope_division_id, role_code) из ОБОИХ источников грантов —
        активных назначений ролей и активных (по окну времени) временных
        дежурств. Единственное перечисление за effective_permissions И
        visible_division_ids: точечная проверка и резолюция видимости читают
        одни и те же гранты по построению, а не по договорённости.
        """
        grants = [
            (ur.scope_division_id, ur.role_code_id)
            for ur in OpsUserRoleSelector.active_for_user(user_id)
        ]
        now = Clock.now()
        active_duties = TemporaryDutyPermission.objects.filter(
            user_id=user_id, is_active=True, starts_at__lte=now, ends_at__gte=now
        )
        grants += [(d.scope_division_id, d.duty_role_code) for d in active_duties]
        return grants

    @classmethod
    def effective_permissions(cls, user_id, division_id=None) -> set:
        matching_role_codes = [
            role_code
            for scope_division_id, role_code in cls._active_grants(user_id)
            if cls._scope_matches(scope_division_id, division_id)
        ]
        if not matching_role_codes:
            return set()
        return set(
            RolePermission.objects.filter(
                role_code_id__in=matching_role_codes
            ).values_list("permission_code_id", flat=True)
        )

    @classmethod
    def has_permission(cls, user_id, permission_code, division_id=None) -> bool:
        perms = cls.effective_permissions(user_id, division_id=division_id)
        if WILDCARD in perms:
            return True
        return permission_code in perms

    @classmethod
    def visible_division_ids(cls, user_id, permission_code):
        """ОБРАТНЫЙ вопрос к has_permission для списочных селекторов: какие
        подразделения пользователь видит под permission_code? None — глобальная
        видимость (безскоуповый грант или wildcard ADMIN), иначе множество id
        подразделений — пустое, когда код не несёт ни один грант (fail-closed
        само по себе).

        Делит _active_grants с effective_permissions — точечная проверка и
        резолюция видимости не могут разъехаться. Один вызов кормит один
        division_id__in — не звать по подразделению в цикле; один скан
        адъяценси покрывает все скоупованные гранты (переиспользование
        children_map).
        """
        grants = cls._active_grants(user_id)
        if not grants:
            return set()

        holding_roles = set(
            RolePermission.objects.filter(
                role_code_id__in={code for _, code in grants},
                permission_code_id__in=[permission_code, WILDCARD],
            ).values_list("role_code_id", flat=True)
        )
        visible = set()
        children_map = None
        for scope_division_id, role_code in grants:
            if role_code not in holding_roles:
                continue
            if scope_division_id is None:
                return None
            if children_map is None:
                children_map = DivisionTreeSelector.children_map()
            visible |= DivisionTreeSelector.subtree_ids(
                scope_division_id, children_map=children_map
            )
        return visible


class RoleAdminService:
    """Write-обёртки администрирования RBAC."""

    @staticmethod
    @transaction.atomic
    def assign_role(user_id, role_code, scope_division_id=None, *, actor: str):
        # Пустой actor размывал бы конвенцию «NULL = честно без актора».
        if not actor or not actor.strip():
            raise ValidationError("actor must be a non-empty string")
        # created_by фиксирует создателя СТРОКИ (append-once): реактивация
        # существующего назначения не должна переписать исходного создателя —
        # отсюда create_defaults (Django 5.0+), не defaults.
        user_role, _ = UserRole.objects.update_or_create(
            user_id=user_id,
            role_code_id=role_code,
            scope_division_id=scope_division_id,
            defaults={"is_active": True},
            create_defaults={"is_active": True, "created_by": actor},
        )
        return user_role

    @staticmethod
    @transaction.atomic
    def save_permission(code, *, name, description="", is_active=True, actor):
        """Завести или изменить право справочника (Plane №36, «П-2»).

        Запись идёт ЧЕРЕЗ сервис, а не из вьюхи: у правила «изменение доступа
        оставляет именной след» один владелец, и вторая запись журнала из
        другого места разошлась бы с ним при первой же новой ручке.

        Удаления здесь нет: код права стоит в гейтах живых ручек, и снятие
        строки справочника оставило бы закрытую ручку без объяснения, чем
        именно она закрыта. Право снимается с работы деактивацией.
        """
        from organization_management.apps.operations import audit_service
        from organization_management.apps.operations.models import Permission

        existing = Permission.objects.filter(code=code).first()
        old_value = (
            None
            if existing is None
            else {
                "code": existing.code,
                "name": existing.name,
                "description": existing.description,
                "is_active": existing.is_active,
            }
        )
        permission, _ = Permission.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "description": description,
                "is_active": is_active,
            },
        )
        audit_service.record(
            actor=actor,
            action=audit_service.ACCESS_PERMISSION_SAVED,
            entity_type=audit_service.ENTITY_PERMISSION,
            entity_key=permission.code,
            old_value=old_value,
            new_value={
                "code": permission.code,
                "name": permission.name,
                "description": permission.description,
                "is_active": permission.is_active,
            },
        )
        return permission

    @staticmethod
    @transaction.atomic
    def save_role(code, *, name, description="", is_active=True, actor):
        """Завести или изменить роль (Plane №36, «П-3»).

        Роль БЕЗ прав допустима намеренно: заготовку заводят раньше, чем
        решают её состав, и запрет «сначала право, потом роль» заставил бы
        собирать роль в один присест или держать её мусорной строкой в
        Django-админке.

        Удаления нет по тому же основанию, что и у права: код роли стоит в
        назначениях (`UserRole.role_code` — PROTECT) и в командах стенда;
        роль снимается с работы деактивацией.
        """
        from organization_management.apps.operations import audit_service

        existing = Role.objects.filter(code=code).first()
        old_value = (
            None
            if existing is None
            else {
                "code": existing.code,
                "name": existing.name,
                "description": existing.description,
                "is_active": existing.is_active,
            }
        )
        role, _ = Role.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "description": description,
                "is_active": is_active,
            },
        )
        audit_service.record(
            actor=actor,
            action=audit_service.ACCESS_ROLE_SAVED,
            entity_type=audit_service.ENTITY_ROLE,
            entity_key=role.code,
            old_value=old_value,
            new_value={
                "code": role.code,
                "name": role.name,
                "description": role.description,
                "is_active": role.is_active,
            },
        )
        return role

    @staticmethod
    def role_permission_codes(role_code) -> list:
        return sorted(
            RolePermission.objects.filter(role_code_id=role_code).values_list(
                "permission_code_id", flat=True
            )
        )

    @classmethod
    @transaction.atomic
    def change_role_permissions(cls, role_code, *, add=(), remove=(), actor):
        """Изменить состав прав роли и оставить именной след.

        След пишется ТОЛЬКО когда состав действительно поменялся: повторное
        добавление уже выданного права ничего не меняет, а строка в ленте
        утверждала бы обратное — и разбор «когда роли добавили это право»
        приводил бы к дате, в которую ничего не произошло.

        Старый и новый составы кладутся ЦЕЛИКОМ, а не дельтой: вопрос к ленте
        звучит «что роль открывала до и после», и восстанавливать состав
        сложением дельт по всей истории читатель не должен.
        """
        from organization_management.apps.operations import audit_service

        before = cls.role_permission_codes(role_code)
        for permission_code in add:
            RolePermission.objects.get_or_create(
                role_code_id=role_code, permission_code_id=permission_code
            )
        if remove:
            RolePermission.objects.filter(
                role_code_id=role_code, permission_code_id__in=list(remove)
            ).delete()
        after = cls.role_permission_codes(role_code)
        if after == before:
            return after
        audit_service.record(
            actor=actor,
            action=audit_service.ACCESS_ROLE_PERMISSIONS_CHANGED,
            entity_type=audit_service.ENTITY_ROLE,
            entity_key=role_code,
            old_value={"permissions": before},
            new_value={"permissions": after},
        )
        return after

    @staticmethod
    @transaction.atomic
    def revoke_role(user_id, role_code, scope_division_id=None):
        """Снять роль: деактивация, не удаление — история выдач остаётся."""
        UserRole.objects.filter(
            user_id=user_id, role_code_id=role_code, scope_division_id=scope_division_id
        ).update(is_active=False)

    @classmethod
    def keeps_access_admin_without(cls, user_id, *, excluded_user_role_id) -> bool:
        """Останется ли у человека право управлять доступом БЕЗ этой выдачи.

        Спрашивается перед снятием роли у самого себя: администратор, снявший
        свою последнюю административную роль, запирает раздел — вернуть доступ
        сможет только тот, у кого он ещё есть, а в маленькой службе такого
        может и не быть. Дешевле отбить действие, чем чинить его руками в
        базе.
        """
        role_codes = list(
            UserRole.objects.filter(user_id=user_id, is_active=True)
            .exclude(id=excluded_user_role_id)
            .values_list("role_code_id", flat=True)
        )
        if not role_codes:
            return False
        codes = set(
            RolePermission.objects.filter(role_code_id__in=role_codes).values_list(
                "permission_code_id", flat=True
            )
        )
        return WILDCARD in codes or ACCESS_ADMIN_PERMISSION in codes

    @staticmethod
    @transaction.atomic
    def grant_temporary_duty(
        *,
        user_id,
        duty_role_code,
        starts_at,
        ends_at,
        created_by,
        employee_id=None,
        scope_division_id=None,
        event_id=None,
    ):
        grant = TemporaryDutyPermission(
            user_id=user_id,
            duty_role_code=duty_role_code,
            starts_at=starts_at,
            ends_at=ends_at,
            created_by=created_by,
            employee_id=employee_id,
            scope_division_id=scope_division_id,
            event_id=event_id,
        )
        grant.full_clean()
        grant.save()
        return grant

    @staticmethod
    @transaction.atomic
    def expire_temporary_duty(grant_id):
        TemporaryDutyPermission.objects.filter(id=grant_id).update(is_active=False)


class AccountAdminService:
    """Учётные записи из интерфейса (Plane №36, «П-5»).

    Раньше учётка заводилась только Django-админкой или командой стенда. Здесь
    те же действия, но с именным следом и одним владельцем правил: пароль
    никогда не возвращается дважды и никогда не попадает в журнал.
    """

    # Длина временного пароля. 16 символов из 58-символьного алфавита — это
    # ~94 бита: пароль живёт до первой смены, но живёт он в переписке и в
    # чужой памяти, поэтому короткий «на пару дней» здесь не годится.
    TEMPORARY_PASSWORD_LENGTH = 16
    # Без похожих друг на друга символов: временный пароль ДИКТУЮТ и
    # переписывают руками, и `l/1/I` с `O/0` возвращаются жалобой «не
    # подходит», которую не отличить от настоящей ошибки.
    TEMPORARY_PASSWORD_ALPHABET = (
        "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    )

    @classmethod
    def generate_temporary_password(cls) -> str:
        from django.utils.crypto import get_random_string

        return get_random_string(
            cls.TEMPORARY_PASSWORD_LENGTH, cls.TEMPORARY_PASSWORD_ALPHABET
        )

    @staticmethod
    def _snapshot(user):
        return {
            "username": user.username,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "email": user.email,
            "is_active": user.is_active,
        }

    @classmethod
    @transaction.atomic
    def create_account(
        cls,
        *,
        username,
        password=None,
        first_name="",
        last_name="",
        email="",
        is_active=True,
        actor,
    ):
        """Завести учётку; вернуть (пользователь, временный пароль или None).

        Пароль возвращается ОДИН раз и только тому, кто заводил: хранить его в
        читаемом виде негде и незачем, а показать его надо — иначе человеку
        нечего сообщить новому сотруднику.
        """
        from django.contrib.auth.models import User

        from organization_management.apps.operations import audit_service

        temporary = None
        if not password:
            temporary = cls.generate_temporary_password()
            password = temporary
        user = User(
            username=username,
            first_name=first_name or "",
            last_name=last_name or "",
            email=email or "",
            is_active=is_active,
        )
        user.set_password(password)
        user.save()
        audit_service.record(
            actor=actor,
            action=audit_service.ACCESS_ACCOUNT_SAVED,
            entity_type=audit_service.ENTITY_ACCOUNT,
            entity_id=user.pk,
            new_value=cls._snapshot(user),
        )
        return user, temporary

    @classmethod
    @transaction.atomic
    def save_account(cls, user, *, actor, **fields):
        """Правка учётки, включая блокировку (`is_active`).

        Пароль сюда НЕ приходит: смена пароля — своё действие со своим следом,
        и общая правка не должна уметь менять его мимо него.
        """
        from organization_management.apps.operations import audit_service

        old_value = cls._snapshot(user)
        for name in ("first_name", "last_name", "email", "is_active"):
            if name in fields and fields[name] is not None:
                setattr(user, name, fields[name])
        user.save()
        audit_service.record(
            actor=actor,
            action=audit_service.ACCESS_ACCOUNT_SAVED,
            entity_type=audit_service.ENTITY_ACCOUNT,
            entity_id=user.pk,
            old_value=old_value,
            new_value=cls._snapshot(user),
        )
        return user

    @classmethod
    @transaction.atomic
    def reset_password(cls, user, *, actor):
        """Сбросить пароль и вернуть временный — один раз, вызывающему.

        В журнал уходит ФАКТ сброса, и только он: пароль в ленте, которую
        читают все, кто держит право на журнал, отменил бы самый смысл сброса.
        """
        from organization_management.apps.operations import audit_service

        temporary = cls.generate_temporary_password()
        user.set_password(temporary)
        user.save(update_fields=["password"])
        audit_service.record(
            actor=actor,
            action=audit_service.ACCESS_ACCOUNT_PASSWORD_RESET,
            entity_type=audit_service.ENTITY_ACCOUNT,
            entity_id=user.pk,
            new_value={"username": user.username},
        )
        return temporary


class LegacyRoleSync:
    """Мост на переходный период: назначение ops-ролей по старым учёткам.

    Пока административного UI нет, роли для стенда назначаются management-
    командой seed_operations --assign user:ROLE[:division_id].
    """

    @staticmethod
    def actor_id_for_user(user) -> str:
        """user_id RBAC для пользователя старой системы: str(User.pk).

        Строковый тип сохранён под будущий внешний КУ — смена источника
        идентичности не потребует миграции схемы.
        """
        return str(user.pk)
