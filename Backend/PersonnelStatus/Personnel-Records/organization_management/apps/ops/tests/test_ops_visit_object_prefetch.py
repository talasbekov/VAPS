"""Регрессии общего загрузчика объектов посещения (Plane SJ-1049)."""

from types import SimpleNamespace

import django.db.models

from organization_management.apps.ops.api import serializers


class _VisitRelation:
    def __init__(self, visits):
        self.visits = visits
        self.lookups = None

    def all(self):
        return self.visits

    def prefetch_related(self, *lookups):
        self.lookups = lookups
        return self.visits


def test_cached_visit_objects_prefetch_security_object_for_event_response(monkeypatch):
    """Внешний prefetch списка не должен оставить фото с N запросами."""

    visits = [SimpleNamespace(id=1), SimpleNamespace(id=2)]
    relation = _VisitRelation(visits)
    event = SimpleNamespace(
        visit_objects=relation,
        _prefetched_objects_cache={"visit_objects": visits},
    )
    calls = []
    monkeypatch.setattr(
        django.db.models,
        "prefetch_related_objects",
        lambda instances, *lookups: calls.append((instances, lookups)),
    )

    assert serializers.visit_objects_of(event) == visits
    assert calls == [
        (visits, ("security_object", "deputies", "document_versions"))
    ]


def test_uncached_visit_objects_prefetch_security_object_for_event_response():
    """Detail и mutation-ответы используют тот же полный набор связей."""

    visits = [SimpleNamespace(id=1)]
    relation = _VisitRelation(visits)
    event = SimpleNamespace(visit_objects=relation)

    assert serializers.visit_objects_of(event) == visits
    assert relation.lookups == (
        "security_object",
        "deputies",
        "document_versions",
    )
