"""Маршрут согласования расстановки — в настройках раздела (`[СОГ-05]`, Plane №429).

Шаги живут в `OpsApprovalRouteStep`; объект посещения получает КОПИЮ
маршрута при выходе на «Согласование» (`seed_route`), дальше живёт своей
жизнью: подписи, возвраты, повторные отправки не трогают настройку, а правка
настройки не переписывает маршруты уже идущих согласований — иначе подпись,
поставленная вчера, назавтра оказалась бы под другим списком.
"""
from collections.abc import Mapping

from django.contrib.auth import get_user_model
from django.db import transaction

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_settings import OpsApprovalRouteStep


def _employee_name(user):
    employee = getattr(user, "employee", None)
    if employee is None:
        return ""
    parts = [employee.last_name, employee.first_name, employee.middle_name]
    return " ".join(part for part in parts if part).strip()


def serialize_step(step):
    return {
        "id": str(step.pk),
        "position": step.position,
        "roleLabel": step.role_label,
        "unit": step.unit,
        "username": step.username,
        "fullName": step.full_name,
    }


def list_steps():
    return [serialize_step(step) for step in OpsApprovalRouteStep.objects.all()]


def _step_text(value, *, index, field, label):
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise DomainError(
            "VALIDATION_ERROR", 400,
            detail={"steps": [f"Шаг {index}: {label} должно быть строкой."]},
            message="Проверьте заполнение формы.",
        )
    value = value.strip()
    limit = OpsApprovalRouteStep._meta.get_field(field).max_length
    if len(value) > limit:
        raise DomainError(
            "VALIDATION_ERROR", 400,
            detail={"steps": [f"Шаг {index}: {label} — не более {limit} символов."]},
            message="Проверьте заполнение формы.",
        )
    return value


@transaction.atomic
def replace_steps(rows, *, actor):
    """Заменить маршрут целиком: порядок — порядок строк.

    Логин проверяется по учёткам: незнакомая учётка — отказ, а не молчаливая
    строка, которую никто не сможет подписать. ФИО берётся из кадровой записи
    учётки, если она есть, иначе — как прислали.
    """
    if not isinstance(rows, list):
        raise DomainError(
            "VALIDATION_ERROR", 400, detail={"steps": ["Ожидается список шагов."]},
            message="Проверьте заполнение формы.",
        )
    User = get_user_model()
    cleaned = []
    for index, row in enumerate(rows, start=1):
        if not isinstance(row, Mapping):
            raise DomainError(
                "VALIDATION_ERROR", 400,
                detail={"steps": [f"Шаг {index}: ожидается объект с полями подписанта."]},
                message="Проверьте заполнение формы.",
            )
        values = {
            field: _step_text(row.get(key), index=index, field=field, label=label)
            for key, field, label in (
                ("roleLabel", "role_label", "название роли"),
                ("unit", "unit", "название подразделения"),
                ("username", "username", "имя учётной записи"),
                ("fullName", "full_name", "ФИО"),
            )
        }
        role_label = values["role_label"]
        if role_label == "":
            raise DomainError(
                "VALIDATION_ERROR", 400,
                detail={"steps": [f"Шаг {index}: укажите роль (должность) подписанта."]},
                message="Проверьте заполнение формы.",
            )
        username = values["username"]
        full_name = values["full_name"]
        if username:
            user = User.objects.filter(username=username).first()
            if user is None:
                raise DomainError(
                    "VALIDATION_ERROR", 400,
                    detail={"steps": [f"Шаг {index}: учётка «{username}» не найдена."]},
                    message="Проверьте заполнение формы.",
                )
            full_name = _employee_name(user) or full_name or username
            full_name = _step_text(full_name, index=index, field="full_name", label="ФИО сотрудника")
        cleaned.append(
            {
                "position": index,
                "role_label": role_label,
                "unit": values["unit"],
                "username": username,
                "full_name": full_name,
            }
        )
    before = list_steps()
    OpsApprovalRouteStep.objects.all().delete()
    for values in cleaned:
        OpsApprovalRouteStep.objects.create(**values, created_by=str(actor))
    after = list_steps()
    audit_service.record(
        actor=str(actor),
        action=audit_service.APPROVAL_ROUTE_REPLACED,
        entity_type=audit_service.ENTITY_POLICY_SETTING,
        entity_key="APPROVAL_ROUTE",
        old_value={"steps": before},
        new_value={"steps": after},
    )
    return after


def template_route():
    """Маршрут для объекта в форме строк `approval_route` (статус NOT_SENT)."""
    items = []
    for step in OpsApprovalRouteStep.objects.all():
        items.append(
            {
                "id": f"approver-{step.position}",
                "name": step.full_name or step.role_label,
                "unit": step.unit,
                "position": step.role_label,
                "username": step.username,
                "status": "NOT_SENT",
                "decidedAt": None,
                "comment": "",
            }
        )
    return items


def seed_route(visit):
    """Дать объекту маршрут из настроек, если своего у него ещё нет.

    Возвращает True, если маршрут записан. Пустая настройка — пустой маршрут:
    отправлять будет некому, и экран скажет об этом словами.
    """
    if visit.approval_route:
        return False
    items = template_route()
    if not items:
        return False
    visit.approval_route = items
    visit.save(update_fields=["approval_route", "updated_at"])
    return True
