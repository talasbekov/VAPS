"""Сид каталога охраняемых лиц — записи мока фронта дословно.

С Plane №952 у записей есть должность, страна и данные образца («параметр =
значение»): сводка ГВО подставляет их при выборе лица, страна лица становится
страной сводки. Шестая запись — лицо из образца заказчика «Сводные данные»
(Президент Черногории), чтобы стенд показывал сводку с полным набором данных,
а не пустыми строками.

Идемпотентен по имени (update_or_create): повторный запуск обновляет
позывной/категорию/био, а не плодит дубли. Нужен стенду и live-e2e —
на проде каталог ведётся руками через Admin.
"""
from django.core.management.base import BaseCommand

from organization_management.apps.operations.models_gvo import OpsProtectedPerson

CATALOG = [
    {
        "name": "Оспанов Бахыт Дюсенбаевич",
        "country": "Казахстан",
        "callsign": "Сокол",
        "category": "OURS",
        "bio": (
            "Государственный служащий высшего звена, куратор международных "
            "визитов. Под охраной с 2019 года."
        ),
    },
    {
        "name": "Салимова Гульнара Ержановна",
        "country": "Казахстан",
        "callsign": "Гранит",
        "category": "OURS",
        "bio": (
            "Руководитель аппарата, регулярный участник протокольных "
            "мероприятий республиканского уровня."
        ),
    },
    {
        "name": "Ахметов Тимур Болатович",
        "country": "Казахстан",
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
        "country": "США",
        "position": "Глава делегации",
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
        "country": "Оман",
        "position": "Заместитель Премьер-министра по экономическим вопросам",
    },
    {
        "name": "Яков Милатович",
        "callsign": "",
        "category": "FOREIGN",
        "bio": "Президент Черногории; образец заказчика «Сводные данные».",
        "country": "Черногория",
        "position": "Президент Черногории",
        "facts": [
            {"key": "Дата и место рождения", "value": "07.12.1986 г., г. Подгорица, Черногория"},
            {"key": "Группа крови", "value": "А (II) Rh +"},
            {"key": "Рост", "value": "185 см"},
            {"key": "Размер обуви", "value": "44"},
            {"key": "Ограничения в питании", "value": "тунец, баранина, свежее мясо, майонез"},
            {"key": "Предпочтения в питании", "value": "курица, рыба, телятина, стейк полной прожарки"},
            {"key": "Аллергии", "value": "отсутствуют"},
        ],
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
                    "country": row.get("country", ""),
                    "position": row.get("position", ""),
                    "facts": row.get("facts", []),
                    "is_active": True,
                },
            )
            created += int(was_created)
        self.stdout.write(
            f"protected persons: {created} created, {len(CATALOG) - created} updated"
        )
