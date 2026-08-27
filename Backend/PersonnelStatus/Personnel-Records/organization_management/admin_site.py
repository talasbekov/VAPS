"""Django Admin, разложенный ПО СМЫСЛУ, а не по приложениям (Plane №210).

ЗАДАЧА ЗАКАЗЧИКА (№198): «Админку джанго отсортировать, если это справочник то
её перекинуть в категорию dictionaries и т.д. По смыслу разделить на категории».

ПОЧЕМУ ЭТО НЕ РЕШАЕТСЯ РАССТАНОВКОЙ МОДЕЛЕЙ ПО ПРИЛОЖЕНИЯМ. Admin группирует
модели по `app_label`, а `app_label` участвует в правах (`operations.add_…`) и
в таблице миграций. Переезд модели в другое приложение ради вида в Admin
обнулил бы выданные права и потребовал бы переписывать миграции — цена
несоразмерна. Поэтому меняется ПРЕДСТАВЛЕНИЕ: `get_app_list` собирает
категории сам, оставляя модели там, где они живут.

ОДИН РЕЕСТР. Категория модели задаётся в `admin_categories.py` — одним местом,
а не флагом у каждого `ModelAdmin`: раскладку надо видеть целиком, иначе
«Справочники» медленно наполняются всем подряд.

МОДЕЛЬ БЕЗ КАТЕГОРИИ НЕ ПРОПАДАЕТ, а уезжает в «Прочее» — и это видно на
экране. Спрятать её значило бы повторить историю, из-за которой заказчик и
попросил показать всё (Plane №182): 63 модели раздела ОМ не показывались вовсе,
и никто этого не замечал.

СТРАНИЦА ОТДЕЛЬНОГО ПРИЛОЖЕНИЯ (`/admin/operations/`) остаётся штатной: там
`app_label` задан явно, и подменять группировку — значит сломать ссылки, по
которым Admin ходит сам.
"""
from django.contrib.admin import AdminSite

from organization_management.admin_categories import (
    CATEGORIES,
    OTHER_CATEGORY,
    category_of,
)


class CategorizedAdminSite(AdminSite):
    """Admin, где верхний уровень — категории по смыслу."""

    site_header = "Smart Josparlau — администрирование"
    site_title = "Smart Josparlau"
    index_title = "Разделы"

    def get_app_list(self, request, app_label=None):
        if app_label is not None:
            # Страница одного приложения: группировка здесь чужая, штатная.
            return super().get_app_list(request, app_label)

        app_dict = self._build_app_dict(request)
        by_category: dict[str, list] = {name: [] for name in CATEGORIES}
        by_category[OTHER_CATEGORY] = []

        for app in app_dict.values():
            for model in app["models"]:
                # `object_name` — имя класса; связки «приложение.Модель» хватает,
                # чтобы различить одноимённые модели разных приложений (две
                # «Роли»: портала и раздела ОМ).
                model["category_label"] = f"{app['name']} · {model['name']}"
                by_category[category_of(app["app_label"], model["object_name"])].append(model)

        result = []
        for name in list(CATEGORIES) + [OTHER_CATEGORY]:
            models = by_category[name]
            if not models:
                continue
            # Внутри категории — по подписи «Приложение · Модель»: две «Роли»
            # (портала и раздела ОМ) иначе стояли бы рядом неразличимо.
            models.sort(key=lambda item: item["category_label"])
            result.append(
                {
                    "name": name,
                    # `app_label` в этом словаре Admin использует только как
                    # ключ шаблона; ссылки живут у самих моделей, поэтому
                    # категории хватает её имени.
                    "app_label": "category",
                    "app_url": "",
                    "has_module_perms": True,
                    "models": models,
                }
            )
        return result
