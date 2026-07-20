"""Idempotent seed for the facilities catalogs (14.2).

Donor DB-OPS-004: ops_post_types ← FIXED, MOBILE, CHECKPOINT, RESERVE.
update_or_create restores drifted names on re-run (seed_operations canon).
"""

from django.core.management.base import BaseCommand

from apps.operations.facilities.models import PostType

POST_TYPES = [
    ("FIXED", "Стационарный пост"),
    ("MOBILE", "Подвижный пост"),
    ("CHECKPOINT", "Контрольно-пропускной пункт"),
    ("RESERVE", "Резерв"),
]


class Command(BaseCommand):
    help = "Посев справочника типов постов (идемпотентно)."

    def handle(self, *args, **options):
        for code, name in POST_TYPES:
            # is_active only in create_defaults (seed_statuses canon): after
            # creation the flag is operator-owned — a re-run must NOT
            # resurrect a type the admin deactivated.
            PostType.objects.update_or_create(
                code=code,
                defaults={"name": name},
                create_defaults={"name": name, "is_active": True},
            )
        self.stdout.write(f"post types: {len(POST_TYPES)} seeded")
