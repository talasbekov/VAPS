from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from organization_management.apps.notifications.groups import NOTIFY_MESSAGE_TYPE, group_name_for
from organization_management.apps.notifications.models import Notification


def send_report_ready_notification(report):
    """
    Создает уведомление и отправляет его через Channels пользователю,
    который инициировал генерацию отчета.
    """
    if not report.created_by_id:
        return

    notification = Notification.objects.create(
        recipient_id=report.created_by_id,
        notification_type=Notification.NotificationType.REPORT_READY,
        title="Отчет готов",
        message=f"Ваш отчет #{report.id} готов к скачиванию.",
        link=f"/api/reports/{report.id}/download/",
    )

    channel_layer = get_channel_layer()
    payload = {
        "id": notification.id,
        "title": notification.title,
        "message": notification.message,
        "link": notification.link,
        "type": notification.notification_type,
        "created_at": notification.created_at.isoformat(),
    }
    async_to_sync(channel_layer.group_send)(
        # Имя берётся ПРЯМО в вызове, а не через переменную: путь, спрятанный
        # в переменную, делает сторожа слепым (тот же урок, что в Plane №857).
        group_name_for(report.created_by_id),
        {
            "type": NOTIFY_MESSAGE_TYPE,
            "message": payload,
        },
    )
