"""Роли этапов ОМ, которые определяются назначениями в данных."""


def can_manage_recon(event, visit_object, actor_employee, permission_codes):
    """Может ли актор вести рекогносцировку указанного объекта.

    `event.manage` намеренно не участвует: это право ведения карточки ОМ, а
    рекогносцировка принадлежит назначенному старшему объекта (`[РЕК-10]`).
    Руководство использует отдельный `event.stage_override`; wildcard остаётся
    административным обходом. Закрытый или уже прошедший этап неизменяем.
    """
    if event.stage == "CLOSED" or visit_object.stage != "RECON":
        return False
    permissions = set(permission_codes or ())
    if "*" in permissions or "event.stage_override" in permissions:
        return True
    return bool(
        actor_employee is not None
        and actor_employee.is_active
        and visit_object.chief_employee_id is not None
        and int(visit_object.chief_employee_id) == int(actor_employee.pk)
    )
