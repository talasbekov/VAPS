"""Граница «всё, что я видел» у массовой отметки СТАРОЙ ленты (Plane №784).

🔴 ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ `tests_api.py` РЯДОМ. `pytest.ini` собирает
только `tests.py`, `test_*.py` и `*_tests.py` — имя `tests_api.py` не подходит
ни под один шаблон, и файл НЕ ВЫПОЛНЯЕТСЯ вовсе: `pytest apps/notifications/`
отвечает «no tests ran». Проба, которую никто не гоняет, хуже отсутствующей:
она создаёт впечатление покрытия. Заведена отдельная карточка на сам факт
несобираемых файлов раздела.
"""
from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APITestCase

from organization_management.apps.notifications.models import Notification


class MarkAllReadBoundaryTest(APITestCase):
    """Граница «всё, что я видел» у СТАРОЙ ленты (Plane №784).

    🔴 ЧТО СТЕРЕЖЁТСЯ. «Прочитать все» отмечало ВСЮ ленту, а не показанное:
    ручка тела не принимала вовсе. Уведомление, прилетевшее между открытием
    панели и нажатием, помечалось прочитанным, НИ РАЗУ НЕ ПОКАЗАВШИСЬ, — и
    человек не узнавал о нём никогда: непрочитанным оно больше не считается.
    №566 закрыл ровно половину кнопки: у ленты раздела ОМ граница уже была.
    """

    URL = '/api/notifications/notifications/mark_all_read/'

    def setUp(self):
        self.user = User.objects.create_user(username='until-user', password='p')
        self.seen = Notification.objects.create(
            recipient=self.user,
            notification_type=Notification.NotificationType.STATUS_CHANGED,
            title='Показанное',
            message='видел',
        )
        self.fresh = Notification.objects.create(
            recipient=self.user,
            notification_type=Notification.NotificationType.STATUS_CHANGED,
            title='Прилетевшее позже',
            message='не видел',
        )
        # `created_at` стоит `auto_now_add`, поэтому моменты разводятся ЯВНО:
        # без этого обе строки родились бы в одну микросекунду, и граница
        # ничего бы не разделила — проба была бы вакуумной.
        now = timezone.now()
        Notification.objects.filter(pk=self.seen.pk).update(
            created_at=now - timezone.timedelta(minutes=5)
        )
        Notification.objects.filter(pk=self.fresh.pk).update(created_at=now)
        self.boundary = (now - timezone.timedelta(minutes=1)).isoformat()

    def test_until_leaves_what_was_not_shown_unread(self):
        self.client.force_authenticate(user=self.user)

        response = self.client.post(self.URL, {'until': self.boundary}, format='json')

        self.assertEqual(response.status_code, 204)
        self.seen.refresh_from_db()
        self.fresh.refresh_from_db()
        self.assertTrue(self.seen.is_read, 'показанное осталось непрочитанным')
        self.assertFalse(
            self.fresh.is_read,
            'непоказанное отмечено прочитанным — человек о нём не узнает',
        )

    def test_without_until_everything_is_marked(self):
        """Без границы поведение прежнее: «прочитать всё» — законное намерение."""
        self.client.force_authenticate(user=self.user)

        self.assertEqual(self.client.post(self.URL, {}, format='json').status_code, 204)

        self.seen.refresh_from_db()
        self.fresh.refresh_from_db()
        self.assertTrue(self.seen.is_read)
        self.assertTrue(self.fresh.is_read)

    def test_naive_boundary_is_refused(self):
        """Момент без зоны отбивается: в поясе +05 он сдвинул бы границу на
        пять часов, и человек отметил бы прочитанным то, чего не видел."""
        self.client.force_authenticate(user=self.user)

        response = self.client.post(
            self.URL, {'until': '2026-08-05T12:00:00'}, format='json'
        )

        self.assertEqual(response.status_code, 400)
        self.fresh.refresh_from_db()
        self.assertFalse(self.fresh.is_read)
