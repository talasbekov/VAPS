from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    EmployeeStatusViewSet,
    StatusDocumentViewSet,
    StatusTypeCatalogView,
)

router = DefaultRouter()
router.register(r'statuses', EmployeeStatusViewSet, basename='employee-status')
# router.register(r'status-documents', StatusDocumentViewSet, basename='status-document')

urlpatterns = [
    # Приложение примонтировано на `api/statuses/`, поэтому полный адрес —
    # `/api/statuses/types/`. Объявлен ДО роутера: иначе `statuses/<pk>/`
    # перехватил бы «types» и увёл его в поиск статуса по идентификатору.
    path('types/', StatusTypeCatalogView.as_view(), name='status-type-catalog'),
    path('', include(router.urls)),
]
