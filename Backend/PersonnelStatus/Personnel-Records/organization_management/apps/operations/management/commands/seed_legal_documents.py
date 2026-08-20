"""Сид нормативной базы ОМ — 8 документов мока фронта дословно.

Идемпотентен по code (update_or_create). Файлов нормативки в системе нет —
file_url остаётся null у всех записей.
"""
from django.core.management.base import BaseCommand

from organization_management.apps.operations.models_legal import OpsLegalDocument

CATALOG = [
    ("LAW", "№ 174-V ЗРК", "О государственной охране",
     "Основы правового статуса охраняемых лиц, полномочия и порядок организации охранных мероприятий.",
     "актуален с 02.2024", "IN_FORCE", 48),
    ("LAW", "№ 380-V ЗРК", "О национальной безопасности",
     "Общие принципы обеспечения безопасности при проведении охранных мероприятий.",
     "актуален с 06.2023", "IN_FORCE", 62),
    ("ORDER", "Приказ № 112", "Об утверждении Инструкции по организации ОМ",
     "Порядок бюллетеня, рекогносцировки, расстановки сил и закрытия мероприятия.",
     "обновлён 03.2025", "IN_FORCE", 34),
    ("ORDER", "Приказ № 89", "О нормах расстановки постов",
     "Нормативы плотности постов, минимального состава смены и резерва.",
     "обновлён 11.2024", "IN_FORCE", 19),
    ("REGULATION", "Регламент СШ-04", "Регламент работы штаба при ОМ",
     "Ведение журнала штаба, порядок фиксации инцидентов и санкционирования замен.",
     "обновлён 01.2026", "IN_FORCE", 15),
    ("REGULATION", "Регламент СГ-02", "Регламент согласования и подписания ЭЦП",
     "Требования к проверке конфликтов версии перед подписанием расстановки.",
     "обновлён 09.2024", "IN_FORCE", 11),
    ("INSTRUCTION", "Инструкция И-17", "Действия при инциденте на посту",
     "Алгоритм фиксации, эскалации и передачи ответственному при нарушении режима.",
     "обновлён 04.2025", "IN_FORCE", 9),
    ("INSTRUCTION", "Инструкция И-05", "Инструктаж и ознакомление личного состава",
     "Порядок подтверждения ознакомления с назначением перед заступлением.",
     "обновлён 07.2023", "UNDER_REVIEW", 7),
]


class Command(BaseCommand):
    help = "Сид нормативной базы ОМ (8 документов мока, идемпотентно)"

    def handle(self, *args, **options):
        created = 0
        for kind, code, title, description, revision, status, pages in CATALOG:
            _obj, was_created = OpsLegalDocument.objects.update_or_create(
                code=code,
                defaults={
                    "kind": kind,
                    "title": title,
                    "description": description,
                    "revision": revision,
                    "status": status,
                    "pages": pages,
                    "file_url": None,
                    "is_active": True,
                },
            )
            created += int(was_created)
        self.stdout.write(
            f"legal documents: {created} created, {len(CATALOG) - created} updated"
        )
