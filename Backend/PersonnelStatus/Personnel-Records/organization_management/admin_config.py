"""Подключение Admin, разложенного по категориям (Plane №210).

Штатный механизм Django: `AdminConfig.default_site`. Именно он, а не подмена
`admin.site` руками, — иначе часть модулей успевает импортировать старый сайт до
подмены, и половина моделей регистрируется не там.
"""
from django.contrib.admin.apps import AdminConfig
from django.apps import apps
from django.contrib import admin

from organization_management.admin_categories import HIDDEN_ADMIN_MODELS


class CategorizedAdminConfig(AdminConfig):
    default_site = "organization_management.admin_site.CategorizedAdminSite"

    def ready(self):
        # Сначала дать всем сторонним приложениям зарегистрировать свои admin,
        # затем снять технические модели с реестра. Таблицы и права остаются.
        super().ready()
        for label in HIDDEN_ADMIN_MODELS:
            try:
                model = apps.get_model(label)
            except LookupError:
                continue
            if admin.site.is_registered(model):
                admin.site.unregister(model)
