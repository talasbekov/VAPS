from django.utils.dateparse import parse_datetime
from rest_framework import serializers
from organization_management.apps.notifications.models import Notification

class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = '__all__'


class MarkAllReadSerializer(serializers.Serializer):
    """Тело массовой отметки старой ленты: необязательная верхняя граница.

    🔴 ЗАЧЕМ (Plane №784). «Прочитать все» отмечало ВСЮ ленту, а не показанное.
    Уведомление, прилетевшее между открытием панели и нажатием, помечалось
    прочитанным, ни разу не показавшись, — и человек не узнавал о нём никогда:
    непрочитанным оно больше не считается. №566 закрыл ровно половину кнопки:
    у ленты раздела ОМ граница уже есть, у этой не было.

    Границы ЗДЕСЬ И ТАМ обязаны совпадать по смыслу и по разбору, иначе одна
    кнопка отметила бы разное в двух лентах. Поэтому правило скопировано с
    `NotificationReadAllSerializer` раздела ОМ дословно:

    - граница НЕОБЯЗАТЕЛЬНА: «прочитать всё» — законное намерение, и требовать
      от клиента момент значило бы заставлять его выдумывать «сейчас»;
    - ЗОНА ОБЯЗАТЕЛЬНА: наивный «2026-08-05T12:00» в поясе +05 сдвигает
      границу на пять часов, и человек, отметивший «всё, что видел»,
      прочитал бы вдобавок то, чего не видел;
    - разбор идёт по СЫРОЙ строке, а не `DateTimeField`: тот молча достраивает
      наивный момент зоной проекта, то есть делает ровно то, чего мы избегаем.
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
