"""Справочники «Страна → Город» (Plane №417, `[МД-09]`, шаг Ш-1 плана P2).

До этого локация мероприятия была свободной строкой (`OpsSecurityEvent.
location`), и «Астана», «г. Астана» и «Astana» были тремя разными местами.
Справочник — данные, которые администратор заводит и правит руками, поэтому
правка — Django Admin (см. `operations/admin.py`), фронт только читает.

Город принадлежит стране; уникальность имени — внутри страны (Александрия
есть в Египте и в США). Мягкое скрытие вместо удаления: на строку сошлётся
мероприятие (Ш-2), и удаление стёрло бы её из истории.
"""
from django.db import models

from organization_management.apps.operations.models import TimeStampedModel


class OpsCountry(TimeStampedModel):
    # ISO 3166-1 alpha-2 — единственный код, который не придумывается: он
    # есть у каждой страны, и по нему же ходят паспорта и авиабилеты.
    code = models.CharField(max_length=2, unique=True)
    name = models.CharField(max_length=120, unique=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name", "id"]
        verbose_name = "Страна"
        verbose_name_plural = "Страны"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(code__regex=r"^[A-Z]{2}$"),
                name="chk_ops_country_code_iso2",
            ),
        ]

    def __str__(self):
        return self.name


class OpsCity(TimeStampedModel):
    # PROTECT: город без страны — не справочник, а строка; снять страну можно
    # только сняв её города.
    country = models.ForeignKey(
        OpsCountry, on_delete=models.PROTECT, related_name="cities"
    )
    name = models.CharField(max_length=120)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["country__name", "name", "id"]
        verbose_name = "Город"
        verbose_name_plural = "Города"
        constraints = [
            models.UniqueConstraint(
                fields=["country", "name"], name="uq_ops_city_country_name"
            ),
        ]

    def __str__(self):
        return f"{self.name} ({self.country.code})"
