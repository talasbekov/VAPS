from django.db import models

from apps.core.models import UUIDTimeStampedModel


class Attachment(UUIDTimeStampedModel):
    """Единая запись о файле в приватном хранилище (Story 6.1, AR-7).

    Байты лежат вне MEDIA_URL под именем ``{root}/{id}`` (UUID PK = имя файла
    на диске, Д2); отдача — только через X-Accel-Redirect (сервисный контракт в
    ``apps.documents.services``). Метаданные (``original_name``/``content_type``/
    ``size``/``sha256``) — единственный источник Content-* заголовков скачивания.

    Контракт связей (Ловушка №1, «явные FK — не GenericFK» × ARCH-003):
    у Attachment НЕТ owner-полей — направление связи всегда «владелец →
    Attachment». Владелец внутри app ``documents`` (например, документ выпуска
    6.5) ссылается обычным FK; сущность другого контекста (core/operations) —
    плоским ``UUIDField attachment_id``, НИКОГДА не FK через границу.
    ``GenericForeignKey``/``ContentType``-полиморфизм — запрещён.

    Бизнес-модель — НЕ регистрировать в Django Admin (Admin = только
    справочники; мимо сервиса = мимо аудита/прав).
    """

    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100)
    # BigInteger (Д10): снимает вопрос >2ГБ навсегда; floor ≥ 1 — DB-констрейнт.
    size = models.BigIntegerField()
    sha256 = models.CharField(max_length=64)

    class Meta:
        db_table = "documents_attachments"
        constraints = [
            # Поля без дефолта → `.objects.create()` не валидирует форму
            # (урок chk_daily_submission_event): DB-гард держит канонический
            # lowercase-hex дайджест и непустые метаданные.
            models.CheckConstraint(
                condition=models.Q(sha256__regex=r"^[0-9a-f]{64}$"),
                name="chk_attachment_sha256_format",
            ),
            # Пустой файл (size=0) отбит формой (Д9); floor — DB-backstop.
            models.CheckConstraint(
                condition=models.Q(size__gte=1),
                name="chk_attachment_size_min",
            ),
            # `\S` (хоть один НЕ-пробельный символ) отвергает и "" и
            # whitespace-only (зеркало chk_daily_submission_amended_*).
            models.CheckConstraint(
                condition=models.Q(original_name__regex=r"\S"),
                name="chk_attachment_original_name_not_blank",
            ),
            models.CheckConstraint(
                condition=models.Q(content_type__regex=r"\S"),
                name="chk_attachment_content_type_not_blank",
            ),
        ]
        indexes = [
            # Поиск по дайджесту (сверка байт-в-байт 6.7, будущая дедупликация).
            models.Index(fields=["sha256"], name="idx_attachment_sha256"),
        ]
        verbose_name = "Вложение"
        verbose_name_plural = "Вложения"

    def __str__(self):
        return f"{self.original_name} ({self.id})"


class DocumentSequence(models.Model):
    """Счётчик номеров документов по паре (doc_type, year) — Story 6.2, AR-7.

    Internal bookkeeping (зеркало ``core.Watermark``): bare-модель без API,
    Admin и аудита; наружу не отдаётся. Номер выдаётся ТОЛЬКО через
    ``apps.documents.services.allocate_number`` ВНУТРИ транзакции финализации
    вызывающего (6.5): сервис берёт row-лок ``select_for_update`` и держит его
    до коммита — откат транзакции отменяет и инкремент, дырки в нумерации нет
    (gap-tolerant). Прямой UPDATE строки = мимо лока = lost update / дубль
    номера — запрещён.

    MUST NOT: Postgres SEQUENCE в любой форме (``CREATE SEQUENCE``,
    ``GENERATED … AS IDENTITY``, ``AutoField``/``serial`` для номера) —
    ``nextval()`` не транзакционен: взятый номер при откате не возвращается →
    дырка. Наша механика — обычная integer-колонка ``last_number`` + row-лок
    (architecture.md §Process Patterns «Нумерация документов»). PK самой
    строки счётчика — неявный BigAutoField: это НЕ номер документа, его
    транзакционность не важна.

    Year-rollover (§82.3): новый ``(doc_type, year)`` бутстрапится
    ``get_or_create`` под защитой ``uq_document_sequence_doc_type_year``
    (unique-констрейнт load-bearing — гонка двух транзакций сериализуется на
    unique-индексе + row-локе); счётчик нового года стартует с 1.
    """

    doc_type = models.CharField(max_length=50)
    year = models.PositiveIntegerField()
    last_number = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "documents_document_sequences"
        constraints = [
            # Load-bearing для bootstrap-гонки: get_or_create в сервисе
            # опирается на этот unique при проигрыше INSERT-гонки (savepoint
            # → повторный get). Не декорация.
            models.UniqueConstraint(
                fields=["doc_type", "year"],
                name="uq_document_sequence_doc_type_year",
            ),
            # Осознанный дубль встроенного чека позитив-филда именованным
            # констрейнтом (зеркало chk_daily_submission_version_min):
            # greppable и переживает смену типа поля.
            models.CheckConstraint(
                condition=models.Q(last_number__gte=0),
                name="chk_document_sequence_last_number_min",
            ),
            # Диапазон-гвард против перепутанных аргументов (year=6,
            # year=20026); в сервисе продублирован на границе.
            models.CheckConstraint(
                condition=models.Q(year__gte=2000) & models.Q(year__lte=2200),
                name="chk_document_sequence_year_range",
            ),
            # `\S` (хоть один НЕ-пробельный символ) отвергает и "" и
            # whitespace-only (зеркало chk_attachment_*_not_blank).
            models.CheckConstraint(
                condition=models.Q(doc_type__regex=r"\S"),
                name="chk_document_sequence_doc_type_not_blank",
            ),
        ]
        verbose_name = "Счётчик номеров документов"
        verbose_name_plural = "Счётчики номеров документов"

    def __str__(self):
        return f"{self.doc_type}/{self.year}: {self.last_number}"
