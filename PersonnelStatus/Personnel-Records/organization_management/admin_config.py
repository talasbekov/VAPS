"""Подключение Admin, разложенного по категориям (Plane №210).

Штатный механизм Django: `AdminConfig.default_site`. Именно он, а не подмена
`admin.site` руками, — иначе часть модулей успевает импортировать старый сайт до
подмены, и половина моделей регистрируется не там.
"""
from django.contrib.admin.apps import AdminConfig


class CategorizedAdminConfig(AdminConfig):
    default_site = "organization_management.admin_site.CategorizedAdminSite"
