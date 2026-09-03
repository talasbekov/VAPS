"""Маршрут согласования расстановки — в настройках раздела (`[СОГ-05]`, Plane №429).

Шаги живут в `OpsApprovalRouteStep`; объект посещения получает КОПИЮ
маршрута при выходе на «Согласование» (`seed_route`), дальше живёт своей
жизнью: подписи, возвраты, повторные отправки не трогают настройку, а правка
настройки не переписывает маршруты уже идущих согласований — иначе подпись,
поставленная вчера, назавтра оказалась бы под другим списком.
"""
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
        row = row or {}
        role_label = str(row.get("roleLabel") or "").strip()
        if role_label == "":
            raise DomainError(
                "VALIDATION_ERROR", 400,
                detail={"steps": [f"Шаг {index}: укажите роль (должность) подписанта."]},
                message="Проверьте заполнение формы.",
            )
        username = str(row.get("username") or "").strip()
        full_name = str(row.get("fullName") or "").strip()
        if username:
            user = User.objects.filter(username=username).first()
            if user is None:
                raise DomainError(
                    "VALIDATION_ERROR", 400,
                    detail={"steps": [f"Шаг {index}: учётка «{username}» не найдена."]},
                    message="Проверьте заполнение формы.",
                )
            full_name = _employee_name(user) or full_name or username
        cleaned.append(
            {
                "position": index,
                "role_label": role_label,
                "unit": str(row.get("unit") or "").strip(),
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
