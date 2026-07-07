"""Tests for the notify-recipient config (Story 5.7b1).

The «дивизион→получатель» mapping the catch-up job (5.7b2) needs to resolve WHO
to notify about a lagging division. A per-division reference table
(``DivisionNotifyRecipient``) + a global fallback
(``SubmissionControlSettings.default_notify_recipient``) + a bulk selector
(``NotifyRecipientSelector.resolve_many``) whose result is specific → fallback →
absent. Flat UUID (ARCH-003, no FK to core), ``recipient`` non-blank (DB
CheckConstraint + ``clean`` edit-safety), one recipient per division. No
catch-up/detect (5.7b2), no ``notify()`` (5.7a), no API (5.7c).
"""

from uuid import uuid4

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext

from apps.operations.submissions.models import (
    DivisionNotifyRecipient,
    SubmissionControlSettings,
)
from apps.operations.submissions.selectors import (
    NotifyRecipientSelector,
    SubmissionControlSettingsSelector,
)

pytestmark = pytest.mark.django_db


def set_default(recipient):
    s = SubmissionControlSettings.objects.get_or_create(singleton_key=1)[0]
    s.default_notify_recipient = recipient
    s.save(update_fields=["default_notify_recipient"])


# --- AC-1: model shape -------------------------------------------------------


def test_db_table():
    assert DivisionNotifyRecipient._meta.db_table == "division_notify_recipients"


def test_create_and_str():
    did = uuid4()
    rec = DivisionNotifyRecipient.objects.create(division_id=did, recipient="boss")
    assert rec.division_id == did
    assert rec.recipient == "boss"
    assert rec.created_at is not None  # from TimeStampedModel
    assert str(did) in str(rec)


# --- AC-1/AC-6: one recipient per division -----------------------------------


def test_one_recipient_per_division():
    did = uuid4()
    DivisionNotifyRecipient.objects.create(division_id=did, recipient="boss")
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            DivisionNotifyRecipient.objects.create(division_id=did, recipient="boss2")


# --- AC-6: recipient non-blank on the DB (rejects "" AND whitespace-only) -----


@pytest.mark.parametrize("bad", ["", "   ", "\t\n"])
def test_recipient_non_blank_at_db(bad):
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            DivisionNotifyRecipient.objects.create(division_id=uuid4(), recipient=bad)


# --- AC-6: clean() strips + rejects blank (admin edit-safety) -----------------


def test_clean_strips_recipient():
    rec = DivisionNotifyRecipient(division_id=uuid4(), recipient="  boss  ")
    rec.full_clean()
    assert rec.recipient == "boss"


@pytest.mark.parametrize("bad", ["", "   "])
def test_clean_rejects_blank_recipient(bad):
    rec = DivisionNotifyRecipient(division_id=uuid4(), recipient=bad)
    with pytest.raises(ValidationError):
        rec.full_clean()


# --- AC-2: global fallback field ---------------------------------------------


def test_default_notify_recipient_defaults_blank():
    s = SubmissionControlSettingsSelector.get()
    assert s.default_notify_recipient == ""


def test_default_notify_recipient_field_shape():
    field = SubmissionControlSettings._meta.get_field("default_notify_recipient")
    assert field.blank is True
    assert field.max_length == 100
    assert field.default == ""


# --- AC-4: resolve_many semantics (specific → fallback → absent) --------------


def test_resolve_many_specific_wins_over_fallback():
    did = uuid4()
    DivisionNotifyRecipient.objects.create(division_id=did, recipient="specific")
    set_default("fallback")
    assert NotifyRecipientSelector.resolve_many([did]) == {did: "specific"}


def test_resolve_many_falls_back_when_unmapped():
    did = uuid4()
    set_default("duty")
    assert NotifyRecipientSelector.resolve_many([did]) == {did: "duty"}


def test_resolve_many_absent_when_no_specific_and_no_fallback():
    did = uuid4()
    # default_notify_recipient defaults to "" → no duty → division absent.
    assert NotifyRecipientSelector.resolve_many([did]) == {}


def test_resolve_many_mixed():
    mapped = uuid4()
    unmapped = uuid4()
    DivisionNotifyRecipient.objects.create(division_id=mapped, recipient="own")
    set_default("duty")
    assert NotifyRecipientSelector.resolve_many([mapped, unmapped]) == {
        mapped: "own",
        unmapped: "duty",
    }


def test_resolve_many_empty_input():
    assert NotifyRecipientSelector.resolve_many([]) == {}


# --- AC-4/NFR-4: bulk, not N+1 -----------------------------------------------


def test_resolve_many_is_bulk_not_n_plus_1():
    SubmissionControlSettingsSelector.get()  # stabilize: settings row pre-exists
    one = [uuid4()]
    DivisionNotifyRecipient.objects.create(division_id=one[0], recipient="r")
    with CaptureQueriesContext(connection) as ctx1:
        NotifyRecipientSelector.resolve_many(one)
    n1 = len(ctx1)

    many = [uuid4() for _ in range(6)]
    for did in many:
        DivisionNotifyRecipient.objects.create(division_id=did, recipient="r")
    with CaptureQueriesContext(connection) as ctx6:
        NotifyRecipientSelector.resolve_many(many)
    n6 = len(ctx6)

    assert n1 == n6, f"N+1: {n1} vs {n6}"
    # one filter (division_id__in) + one settings get — invariant to input size.
    assert n6 == 2, f"unexpected query count: {n6}"


# --- Review-hardening (5.7b1 code-review 2026-07-01) --------------------------


def test_default_notify_recipient_rejects_whitespace_only():
    # «нет дежурного» must be blank (""), never whitespace-only (would be truthy
    # and resolve every unmapped division to a garbage recipient). DB guards it.
    s = SubmissionControlSettingsSelector.get()
    s.default_notify_recipient = "   "
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            s.save(update_fields=["default_notify_recipient"])


def test_default_notify_recipient_allows_blank():
    # "" (the default) must stay valid — the constraint rejects only non-empty
    # all-whitespace values.
    s = SubmissionControlSettingsSelector.get()
    s.default_notify_recipient = ""
    s.save(update_fields=["default_notify_recipient"])  # no IntegrityError
    s.refresh_from_db()
    assert s.default_notify_recipient == ""


def test_resolve_many_strips_padded_specific_recipient():
    # A padded value can be persisted via .create() (bypasses clean); the DB
    # constraint rejects only fully-blank, so "  boss  " survives. resolve_many
    # must strip it so it is not returned as a padded routing key.
    did = uuid4()
    DivisionNotifyRecipient.objects.create(division_id=did, recipient="  boss  ")
    assert NotifyRecipientSelector.resolve_many([did]) == {did: "boss"}


def test_resolve_many_accepts_generator_input():
    # A generator would be drained by the __in query, leaving the merge loop
    # empty if the ids were not materialised first.
    did = uuid4()
    DivisionNotifyRecipient.objects.create(division_id=did, recipient="own")
    result = NotifyRecipientSelector.resolve_many(d for d in [did])
    assert result == {did: "own"}


def test_resolve_many_resolves_string_uuid_input():
    # Callers may pass string UUIDs (JSON/DRF); the per-division recipient must
    # still resolve (keys are normalised to str on both sides). The result key
    # is the original input element (the string).
    did = uuid4()
    DivisionNotifyRecipient.objects.create(division_id=did, recipient="own")
    sid = str(did)
    assert NotifyRecipientSelector.resolve_many([sid]) == {sid: "own"}


def test_resolve_many_drops_none_ids():
    set_default("duty")
    did = uuid4()
    result = NotifyRecipientSelector.resolve_many([did, None])
    assert None not in result
    assert result == {did: "duty"}


def test_resolve_many_fallback_only_is_bulk():
    SubmissionControlSettingsSelector.get()  # pre-warm singleton row
    set_default("duty")
    with CaptureQueriesContext(connection) as ctx1:
        NotifyRecipientSelector.resolve_many([uuid4()])
    with CaptureQueriesContext(connection) as ctx6:
        NotifyRecipientSelector.resolve_many([uuid4() for _ in range(6)])
    # Fallback-only path (no specific rows) is still 1 filter + 1 settings get.
    assert len(ctx1) == len(ctx6) == 2


def test_division_notify_recipient_field_shape():
    recipient = DivisionNotifyRecipient._meta.get_field("recipient")
    assert recipient.max_length == 100
    division_id = DivisionNotifyRecipient._meta.get_field("division_id")
    assert division_id.unique is True
