from django.urls import path, include
from rest_framework.routers import DefaultRouter
from organization_management.apps.dictionaries.api.views import (
    CountryViewSet, CityViewSet,
    PositionViewSet,
    RankViewSet,
    StatusTypeViewSet
)


router = DefaultRouter()
router.register(r"countries", CountryViewSet, basename="dictionary-countries")
router.register(r"cities", CityViewSet, basename="dictionary-cities")
router.register(r"positions", PositionViewSet, basename="positions")
router.register(r"ranks", RankViewSet, basename="ranks")
router.register(r"status_types", StatusTypeViewSet, basename="status-types")


urlpatterns = [
    path("", include(router.urls)),
]
