"""Сверка байт всех выпущенных документов с их дайджестами.

Сверка перед выдачей ловит порчу в тот момент, когда файл ПОНАДОБИЛСЯ. Этого
мало: документ могут не открывать месяцами, а узнать о пропаже байт лучше до
того, как их попросят, — потому что восстановление тем свежее, чем раньше о нём
узнали. Эта команда обходит хранилище целиком и сообщает, что испорчено.

ПРОВЕРКА, А НЕ ВЫДАЧА — отсюда все её отличия от `prepare_download`:

- журнал НЕ пишется. Событие «документ выдан» на каждый обход означало бы, что
  раз в сутки все документы кто-то скачивает, и лента выдач перестала бы
  отвечать на вопрос, ради которого заведена: кто ДЕЙСТВИТЕЛЬНО получал файл;
- обход НЕ ОСТАНАВЛИВАЕТСЯ на первой порче. Отказ на первом же файле сообщал бы
  об одном испорченном документе там, где их может быть двадцать, и разбирать
  инцидент пришлось бы по одному за прогон.

ВЫХОД НЕНУЛЕВОЙ, если что-то испорчено: команду ставят в расписание, и «нашли
порчу» обязано отличаться от «всё цело» не только текстом — иначе наблюдатель
этого не заметит.
"""
from django.core.management.base import BaseCommand, CommandError

from organization_management.apps.operations.document_service import verify_integrity
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_document import OpsIssuedDocument


class Command(BaseCommand):
    help = (
        "Сверить байты всех выпущенных документов с их дайджестами и сообщить "
        "об испорченных. Ничего не чинит и не пишет в журнал."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--division",
            type=int,
            help="Проверить только выпуски этого подразделения.",
        )

    def handle(self, *args, **options):
        documents = OpsIssuedDocument.objects.select_related("attachment").order_by(
            "year", "number"
        )
        if options.get("division") is not None:
            documents = documents.filter(division_id=options["division"])

        checked = 0
        damaged = []
        for document in documents:
            checked += 1
            try:
                verify_integrity(document.attachment)
            except DomainError:
                # Ловим ТОЛЬКО доменный отказ сверки. Любая другая беда (нет
                # доступа к каталогу, сломанная база) — не «испорченный
                # документ», и проглотить её значило бы отчитаться «проверено
                # 500, порчи нет», ничего на самом деле не прочитав.
                damaged.append(document)

        self.stdout.write(f"Проверено выпусков: {checked}")
        if not damaged:
            # Отдельная строка про НОЛЬ проверенных: пустое хранилище и
            # исправное дают одинаково бодрое «порчи нет», а это разные новости.
            if checked == 0:
                self.stdout.write("Выпущенных документов нет — проверять нечего.")
            else:
                self.stdout.write(self.style.SUCCESS("Порчи не обнаружено."))
            return

        for document in damaged:
            self.stdout.write(
                self.style.ERROR(
                    f"ПОРЧА: {document.doc_type} №{document.number}/{document.year} "
                    f"за {document.business_date.isoformat()} "
                    f"(подразделение {document.division_id}, "
                    f"вложение {document.attachment_id})"
                )
            )
        raise CommandError(
            f"Испорчено документов: {len(damaged)} из {checked}. "
            "Байты не совпадают с дайджестом или отсутствуют."
        )
