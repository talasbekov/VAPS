from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import path, include
from django.views.decorators.cache import cache_page
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from drf_spectacular.views import SpectacularAPIView, SpectacularRedocView, SpectacularSwaggerView

urlpatterns = [
    path("admin/", admin.site.urls),

    # JWT Authentication
    path("api/token/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("api/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),

    # API Documentation (короткие URL)
    path('docs', SpectacularSwaggerView.as_view(url_name='schema'), name='docs'),
    path('redoc', SpectacularRedocView.as_view(url_name='schema'), name='redoc-short'),

    # API Schema (cached to avoid heavy regen on each request):
    path('api/schema/', cache_page(60 * 60)(SpectacularAPIView.as_view()), name='schema'),

    # Optional UI (длинные URL для обратной совместимости):
    path('api/schema/swagger-ui', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    path('api/schema/redoc', SpectacularRedocView.as_view(url_name='schema'), name='redoc'),

    # API Endpoints:
    path("api/common/", include("organization_management.apps.common.api.urls")),
    # Раздел «Охранные мероприятия» — нативный переезд из Backend/VAPS
    path("api/operations/", include("organization_management.apps.operations.api.urls")),
    # Ядро оргструктуры в контракте нового бэка. Модели НЕ переносятся: те же
    # сущности уже живут в divisions/employees/dictionaries, core отдаёт над
    # ними донорскую форму (см. apps/core/api/serializers.py).
    path("api/core/", include("organization_management.apps.core.api.urls")),
    # Вложения в контракте нового бэка — над теми же строками, что отдаёт
    # байты /api/operations/attachments/{id}/download/ (см.
    # apps/documents/api/views.py про область по владельцу байт).
    path(
        "api/documents/",
        include("organization_management.apps.documents.api.urls"),
    ),
    # Собственные ресурсы раздела «Охранные мероприятия». В отличие от core и
    # documents это НЕ перенос контракта поверх старых таблиц: под /api/ops/
    # заводятся сущности, которых в целевом бэке не было (охраняемый объект и
    # далее по плану docs/ops-backend-plan.md). Модели живут в apps/operations
    # рядом с остальными ОМ, здесь — только адреса.
    path("api/ops/", include("organization_management.apps.ops.api.urls")),
    path("api/staff_unit/", include("organization_management.apps.staff_unit.urls")),
    path("api/statuses/", include("organization_management.apps.statuses.api.urls")),
    # Прикомандирования: донорский роут был выключен с импорта — вьюхи ходили
    # в кастомного пользователя (user.role/division), которого тут нет; после
    # порта области на User→Employee→StaffUnit→Division роут включён (его
    # зовёт виджет входящих запросов на /statuses).
    path("api/secondments/", include("organization_management.apps.secondments.api.urls")),
    path("api/reports/", include("organization_management.apps.reports.api.urls")),
    path("api/notifications/", include("organization_management.apps.notifications.api.urls")),
    path("api/audit/", include("organization_management.apps.audit.urls")),
    path("api/dictionaries/", include("organization_management.apps.dictionaries.api.urls")),
    path("api/divisions/", include("organization_management.apps.divisions.api.urls")),
    # path("api/employees/", include("organization_management.apps.employees.api.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)