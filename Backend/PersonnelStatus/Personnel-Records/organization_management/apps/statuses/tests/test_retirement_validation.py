"""Malformed period amendments must return retirement, never a server error."""
from datetime import date
from types import SimpleNamespace

import pytest

from organization_management.apps.statuses.retirement import (
    FeatureRetired, refuse_retired_secondment_amendment,
)


@pytest.mark.parametrize("end", [999, [], {}, "invalid-date", None])
def test_retired_status_rejects_an_unusable_end_date(end):
    history = SimpleNamespace(status_type="ATTACHED", end_date=date(2026, 10, 19))
    with pytest.raises(FeatureRetired):
        refuse_retired_secondment_amendment(history, {"end_date": end})
