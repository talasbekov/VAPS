"""Наполнение реестра транспорта ГОН (Plane №215).

ЗАЧЕМ. Реестр без строк выглядит как сломанный экран: отбор по классу брони
не на чем показать, а документ «Список броней» — не из чего собрать.

ГРНЗ ВЫДУМАННЫЕ, и это не мелочь. В образце `04 Список броней в ГОН` стоят
НАСТОЯЩИЕ номера машин, возящих охраняемых лиц, — класть их в репозиторий
нельзя по той же причине, по которой из него убирали позывные и фамилии
сотрудников заказчика (Plane №164). Марки, кузова и классы брони взяты из
образца: они описывают парк, а не конкретную машину.

ИДЕМПОТЕНТНОСТЬ — по ГРНЗ: второй запуск ничего не задваивает, а правку
руками в Admin не затирает (машина ищется, а не пересоздаётся).
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from organization_management.apps.operations.models_vehicle import OpsVehicle

#: (марка, кузов, год, ГРНЗ, класс брони, дислокация, примечание)
FLEET = [
    ("Mercedes-Benz S680 Maybach 4 М (брон.)", "седан (223)", 2023, "701 AAA 01", "VR7", "Астана", "Автохозяйство"),
    ("Mercedes-Benz S680 Maybach 4 М (брон.)", "седан (223)", 2023, "702 AAA 01", "VR7", "Астана", "Автохозяйство"),
    ("Mercedes-Benz S680 Maybach 4 М (брон.)", "седан (222)", 2022, "703 AAA 01", "VR7", "Астана", "Автохозяйство"),
    ("Mercedes-Benz S600 Guard", "седан (221)", 2019, "704 AAA 01", "VR9", "Астана", "Автохозяйство"),
    ("Mercedes-Benz S600 Guard", "седан (221)", 2018, "705 AAA 01", "VR9", "Алматы", "Автохозяйство"),
    ("Mercedes-Benz G500 (брон.)", "внедорожник (463)", 2021, "706 AAA 01", "VR7", "Астана", "Сопровождение"),
    ("Mercedes-Benz G500 (брон.)", "внедорожник (463)", 2021, "707 AAA 01", "VR7", "Алматы", "Сопровождение"),
    ("Toyota Land Cruiser 300 (брон.)", "внедорожник", 2023, "708 AAA 02", "VR6", "Астана", "Сопровождение"),
    ("Toyota Land Cruiser 300 (брон.)", "внедорожник", 2022, "709 AAA 02", "VR6", "Алматы", "Сопровождение"),
    ("Mercedes-Benz V250 (брон.)", "минивэн", 2020, "710 AAA 01", "VR7", "Астана", "Делегация"),
    ("Mercedes-Benz Sprinter", "микроавтобус", 2021, "711 AAA 01", "", "Астана", "Личный состав"),
    ("Mercedes-Benz Sprinter", "микроавтобус", 2019, "712 AAA 01", "", "Алматы", "Личный состав"),
]


class Command(BaseCommand):
    help = "Заполнить реестр транспорта ГОН демонстрационным парком."

    @transaction.atomic
    def handle(self, *args, **options):
        created = 0
        for brand, body, year, plate, armor, place, note in FLEET:
            _car, was_created = OpsVehicle.objects.get_or_create(
                plate=plate,
                defaults={
                    "brand": brand,
                    "body_class": body,
                    "production_year": year,
                    "armor_class": armor,
                    "deployment": place,
                    "note": note,
                },
            )
            created += 1 if was_created else 0
            self.stdout.write(f"VEHICLE={plate} {brand}")
        total = OpsVehicle.objects.filter(is_active=True).count()
        self.stdout.write(
            self.style.SUCCESS(
                f"реестр транспорта: заведено {created}, действующих всего {total}"
            )
        )
