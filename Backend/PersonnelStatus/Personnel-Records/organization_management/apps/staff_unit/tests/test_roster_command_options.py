"""Reject malformed operator settings before parsing any personnel data."""

import json

import pytest
from django.core.management.base import CommandError

from organization_management.apps.staff_unit.management.commands.import_staffing_xlsx import (
    read_config,
)


@pytest.mark.parametrize(
    "value", [True, 123.5, {"iin": "000000000000"}, ["000000000000"]]
)
def test_iin_overrides_must_be_text_or_null(tmp_path, value):
    config = tmp_path / "config.json"
    config.write_text(json.dumps({"iin_overrides": {"42": value}}))
    with pytest.raises(CommandError, match="iin_overrides"):
        read_config(config)
