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
