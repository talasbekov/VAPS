"""Локально выдать диапазон дат для browser-проб, не публикуя API-ручку."""

import json

from django.core.management.base import BaseCommand

from organization_management.apps.ops.fixture_dates import reserve_fixture_business_dates


class Command(BaseCommand):
    help = "Атомарно выдать диапазон дат для локального e2e-прогона."

    def add_arguments(self, parser):
        parser.add_argument("--count", type=int, required=True)

    def handle(self, *args, **options):
        count = options["count"]
        business_date = reserve_fixture_business_dates(count)
        self.stdout.write(
            json.dumps({"businessDate": business_date.isoformat(), "count": count})
        )
