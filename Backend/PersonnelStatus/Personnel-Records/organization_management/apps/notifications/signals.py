"""
Signal handlers for notifications.

These receivers listen to model events across the personnel
application and generate corresponding ``Notification`` records.  When
Channels is installed and properly configured, the receivers also
broadcast real-time messages over WebSocket so that clients can
immediately reflect state changes without polling.
"""

import logging

from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.contrib.auth.models import User
from organization_management.apps.secondments.models import SecondmentRequest
from organization_management.apps.statuses.models import EmployeeStatusLog
from organization_management.apps.employees.models import Employee
from .groups import NOTIFY_MESSAGE_TYPE, group_name_for
from .models import Notification

logger = logging.getLogger(__name__)

# Attempt Channels import
try:
    from channels.layers import get_channel_layer
    from asgiref.sync import async_to_sync
    _has_channels = True
except Exception:
    _has_channels = False


# ✅ Сигнал только на SecondmentRequest
@receiver(post_save, sender=SecondmentRequest, dispatch_uid="create_secondment_notification")
def create_secondment_notification(sender, instance, created, **kwargs):
    if created:
        recipient = instance.approved_by or User.objects.filter(is_superuser=True).first()
        if not recipient:
            return

        Notification.objects.create(
            recipient=recipient,
            notification_type=Notification.NotificationType.SECONDMENT_REQUEST,
            title=f"New Secondment Request for {instance.employee.full_name}",
            message=(
                f"A new secondment from {instance.from_division.name} to "
                f"{instance.to_division.name} has been requested for {instance.employee.full_name}."
            ),
            related_object_id=instance.id,
            related_model="SecondmentRequest",
            payload={"secondment_request_id": instance.id, "employee_id": instance.employee.id},
        )


# ✅ Сигнал только на EmployeeStatusLog
@receiver(post_save, sender=EmployeeStatusLog, dispatch_uid="create_status_update_notification")
def create_status_update_notification(sender, instance, created, **kwargs):
    if not created or not instance.employee or not instance.employee.user:
        return

    Notification.objects.create(
        recipient=instance.employee.user,
        notification_type=Notification.NotificationType.STATUS_CHANGED,
        title=f"Your status has been updated to {instance.get_status_display()}",
        message=(
            f'Your status has been updated to "{instance.get_status_display()}" '
            f"from {instance.date_from}."
        ),
        related_object_id=instance.id,
        related_model="EmployeeStatusLog",
        payload={"status_log_id": instance.id, "new_status": instance.status},
    )

    if _has_channels:
        try:
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                # 🔴 БЫЛО `f"user_{...}_notifications"` — ГРУППА, В КОТОРУЮ НЕ
                # ЗАХОДИТ НИКТО (Plane №824). Потребитель слушает `user_<id>`,
                # и уведомление о смене статуса не приходило в браузер ВООБЩЕ:
                # строка в таблице создавалась, поэтому после перезагрузки
                # страницы оно было видно, а живым сокетом — никогда. Симптом
                # читался как «сокет отвалился», а не как ошибка адреса.
                # Теперь имя берётся из общего договора, где оно одно на всех.
                group_name_for(instance.employee.user.id),
                {
                    "type": NOTIFY_MESSAGE_TYPE,
                    "message": {
                        "type": "status_update",
                        "employee_id": instance.employee.id,
                        "new_status": instance.status,
                    },
                },
            )
        except Exception:
            # 🔴 ГЛУХОЙ `pass` ЗАМЕНЁН НА ЗАПИСЬ В ЖУРНАЛ (Plane №824).
            # Проглатывать отказ здесь по-прежнему правильно: смена статуса
            # сотрудника не должна падать из-за недоступного слоя каналов.
            # Но МОЛЧАТЬ о нём нельзя — пока молчали, отказ слоя и ошибка
            # адреса выглядели одинаково: «уведомление не пришло», и ни одна
            # из двух причин не оставляла следа. `exception` пишет и трассу.
            logger.exception(
                "уведомление о смене статуса не ушло в канальный слой: "
                "сотрудник %s, статус %s",
                instance.employee_id,
                instance.status,
            )


# ✅ Сигнал только на Employee
@receiver(post_save, sender=Employee, dispatch_uid="create_employee_update_notification")
def create_employee_update_notification(sender, instance, created, **kwargs):
    if not instance.user:
        return

    action = "created" if created else "updated"

    Notification.objects.create(
        recipient=instance.user,
        notification_type=Notification.NotificationType.STATUS_CHANGED,
        title=f"Your employee profile has been {action}",
        message=f"Your profile has been {action}.",
        related_object_id=instance.id,
        related_model="Employee",
        payload={"employee_id": instance.id},
    )


# ✅ Сигнал только на Employee
@receiver(post_delete, sender=Employee, dispatch_uid="create_employee_delete_notification")
def create_employee_delete_notification(sender, instance, **kwargs):
    recipients = User.objects.filter(is_superuser=True)
    for recipient in recipients:
        Notification.objects.create(
            recipient=recipient,
            notification_type=Notification.NotificationType.STATUS_CHANGED,
            title=f"Employee Deleted: {instance.full_name}",
            message=f"The employee profile for {instance.full_name} has been deleted.",
            related_object_id=instance.id,
            related_model="Employee",
            payload={
                "employee_id": instance.id,
                "full_name": instance.full_name,
            },
        )
