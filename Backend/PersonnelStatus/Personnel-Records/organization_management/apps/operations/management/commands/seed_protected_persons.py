"""Сид каталога охраняемых лиц — 5 записей мока фронта дословно.

Идемпотентен по имени (update_or_create): повторный запуск обновляет
позывной/категорию/био, а не плодит дубли. Нужен стенду и live-e2e —
на проде каталог ведётся руками через Admin.
"""
from django.core.management.base import BaseCommand

from organization_management.apps.operations.models_gvo import OpsProtectedPerson

CATALOG = [
    {
        "name": "Оспанов Бахыт Дюсенбаевич",
        "callsign": "Сокол",
        "category": "OURS",
        "bio": (
            "Государственный служащий высшего звена, куратор международных "
            "визитов. Под охраной с 2019 года."
        ),
    },
    {
        "name": "Салимова Гульнара Ержановна",
        "callsign": "Гранит",
        "category": "OURS",
        "bio": (
            "Руководитель аппарата, регулярный участник протокольных "
            "мероприятий республиканского уровня."
        ),
    },
    {
        "name": "Ахметов Тимур Болатович",
        "callsign": "Беркут",
        "category": "OURS",
        "bio": (
            "Член правительственной делегации, курирует вопросы регионального "
            "взаимодействия."
        ),
    },
    {
        "name": "James Miller",
        "callsign": "Дельта-1",
        "category": "FOREIGN",
        "bio": (
            "Глава иностранной делегации. Визит согласован по линии МИД, "
            "повышенные требования к сопровождению."
        ),
    },
    {
        "name": "Hassan Al-Farsi",
        "callsign": "Оазис",
        "category": "FOREIGN",
        "bio": (
            "Официальный представитель иностранного государства, прибывает с "
            "собственной группой сопровождения."
        ),
    },
]


class Command(BaseCommand):
    help = "Сид каталога охраняемых лиц (5 записей мока, идемпотентно)"

    def handle(self, *args, **options):
        created = 0
        for row in CATALOG:
            _obj, was_created = OpsProtectedPerson.objects.update_or_create(
                name=row["name"],
                defaults={
                    "callsign": row["callsign"],
                    "category": row["category"],
                    "bio": row["bio"],
                    "is_active": True,
                },
            )
            created += int(was_created)
        self.stdout.write(
            f"protected persons: {created} created, {len(CATALOG) - created} updated"
        )
