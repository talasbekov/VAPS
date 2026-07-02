import re

from apps.operations.submissions.models import (
    DailySubmission,
    DivisionNotifyRecipient,
    SubmissionControlSettings,
    TomorrowBlockOverride,
)


class DailySubmissionSelector:
    """Read access to daily submissions for the сдача service (5.3b)."""

    @staticmethod
    def current_for(division_id, business_date):
        """The current (is_current) submission for (division, day), or None.

        Drives the duplicate pre-check (409 DAY_ALREADY_SUBMITTED): a second
        сдача of a day that already has a current version is rejected before the
        INSERT (the partial-unique is only the race backstop).
        """
        return DailySubmission.objects.filter(
            division_id=division_id, business_date=business_date, is_current=True
        ).first()

    @staticmethod
    def by_id(submission_id):
        """The submission by surrogate pk, or None — the pk-resolution channel
        for the API (5.8b amend; reused by the 5.8c detail view). The view
        maps None to 404 ENTITY_NOT_FOUND (canon L442-452: views read only
        through selectors). The pk arrives raw from the URL (the router's
        pattern admits non-integers), so garbage is absorbed as «not found»
        instead of leaking a ValueError → 500 out of the int-pk lookup.
        Canonical ASCII digits only — bare int() would silently resolve alias
        spellings ("+5", " 5 ", "5_0", arabic-indic digits) into the same pk,
        forking one resource across many write-URLs (review 5.8b).
        """
        if not re.fullmatch(r"[0-9]+", str(submission_id)):
            return None
        return DailySubmission.objects.filter(pk=int(submission_id)).first()

    @staticmethod
    def current_for_many(division_ids, business_date) -> dict:
        """Bulk form of ``current_for`` for the 5.5b cascade.

        The current (is_current) submission of EACH division on ``business_date``
        in ONE query (``division_id__in``) → ``{division_id: DailySubmission}``. A
        division with no current submission is simply absent from the map (mirror
        ``current_for`` returning None). Rides ``idx_daily_submission_lookup``;
        never call ``current_for`` in a loop over a subtree (NFR-4).
        """
        return {
            row.division_id: row
            for row in DailySubmission.objects.filter(
                division_id__in=division_ids,
                business_date=business_date,
                is_current=True,
            )
        }

    @staticmethod
    def covering(employee_id, business_dates):
        """Current submissions on ``business_dates`` whose snapshot roster contains
        the employee — amendment-enforcement detection by snapshot MEMBERSHIP (5.4b).

        Detection MUST key off the immutable snapshot (which froze the employee's
        division at сдача-time), NOT a recomputed edit-time division: a transfer or
        history correction between сдача and the retro-edit moves the live division,
        so resolving via ``division_at`` would look at the wrong day's submission and
        miss the covered one (the «две правды» the invariant forbids). One JSONB
        containment query (``snapshot->'roster' @> [{"employee_id": …}]``) over all
        affected days. ``is_current=True`` means a withdrawn («ноль текущих») day has
        no active расход to keep consistent → correctly excluded.
        """
        if not business_dates:
            return []
        return list(
            DailySubmission.objects.filter(
                business_date__in=business_dates,
                is_current=True,
                snapshot__roster__contains=[{"employee_id": str(employee_id)}],
            )
        )

    @staticmethod
    def latest_for(division_id, business_date, lock=False):
        """The highest-version submission for (division, day) — current or not — or
        None. Basis for amendment (5.4a): version = latest.version + 1.

        Unlike ``current_for`` (which filters is_current), this finds the chain head
        even in the «ноль текущих» edge (a day with only non-current versions), so
        amendment never collides with ``unique_daily_submission_version``. ``lock``
        takes ``select_for_update`` on the matched row to serialize concurrent
        amendments inside the service's atomic block (constraint is the backstop).
        """
        qs = DailySubmission.objects.filter(
            division_id=division_id, business_date=business_date
        )
        if lock:
            qs = qs.select_for_update()
        return qs.order_by("-version").first()

    @staticmethod
    def previous_for(division_id, business_date):
        """The most recent current submission STRICTLY before business_date — the
        «вчерашний снапшот» diff-baseline (5.3b event).

        Most-recent prior is_current (NOT literal business_date-1): robust to
        weekends/gaps. Rides idx_daily_submission_lookup (division_id,
        business_date, -version).
        """
        return (
            DailySubmission.objects.filter(
                division_id=division_id,
                business_date__lt=business_date,
                is_current=True,
            )
            .order_by("-business_date", "-version")
            .first()
        )


class SubmissionControlSettingsSelector:
    """Read-only access to the singleton submission-control settings.

    Deviation from the list-selector convention (no actor scoping): this reads
    a single global config row, so visibility narrowing does not apply. The
    default row (control_hour=17:00, required_division_ids=[]) is seeded by
    migration 0001, so get_or_create normally just reads; it stays self-healing
    if the row is ever removed.
    """

    @classmethod
    def get(cls):
        settings, _ = SubmissionControlSettings.objects.get_or_create(singleton_key=1)
        return settings

    @classmethod
    def control_hour(cls):
        return cls.get().control_hour

    @classmethod
    def required_division_ids(cls):
        return list(cls.get().required_division_ids)


class NotifyRecipientSelector:
    """Resolve «дивизион→получатель» for lagging-submission notices (Story 5.7b1).

    Feeds the catch-up job (5.7b2): given the lagging divisions, WHO to notify.
    A per-division ``DivisionNotifyRecipient`` wins; otherwise the global
    ``SubmissionControlSettings.default_notify_recipient`` дежурный, if set; if
    neither, the division is simply absent from the result (no recipient → 5.7b2
    logs + skips). Mirrors the read-only селекторы (no actor — права на API 5.8).
    """

    @staticmethod
    def resolve_many(division_ids) -> dict:
        """``{division_id: recipient}`` for the resolvable divisions — BULK.

        ONE query over the reference table (``division_id__in``) + ONE settings
        ``get`` (the singleton) — never a per-division query in a loop (NFR-4).
        ``recipient`` is non-blank by constraint, so the ``or`` short-circuit is
        safe (no falsy-but-valid recipient masks a real one).

        Robust to input shape (5.7b1 review): the ids are materialised once (a
        generator would otherwise be drained by the ``__in`` query below, leaving
        the merge loop empty), ``None`` ids are dropped (no recipient), and
        lookups are keyed by ``str`` on both sides so string-UUID inputs resolve
        to their per-division recipient (``row.division_id`` is a ``uuid.UUID``).
        Recipients are stripped so a padded value written via ``.create`` /
        ``bulk_create`` (which skip ``clean``) is not returned as a routing key.
        """
        division_ids = [did for did in division_ids if did is not None]
        specific = {
            str(row.division_id): row.recipient
            for row in DivisionNotifyRecipient.objects.filter(
                division_id__in=division_ids
            )
        }
        default = (
            SubmissionControlSettingsSelector.get().default_notify_recipient or ""
        ).strip()
        resolved = {}
        for division_id in division_ids:
            recipient = specific.get(str(division_id)) or (default or None)
            if recipient:
                resolved[division_id] = recipient.strip()
        return resolved


class TomorrowBlockOverrideSelector:
    """Read-only access to the next-day-lock override (Story 5.6b)."""

    @staticmethod
    def active_for(business_date) -> bool:
        """Whether a legal override exists for ``business_date`` (ONE query).

        Date-level: any override on the date lifts the 5.6a block. Mirrors the
        read-only селекторы (no actor — права на API 5.8).
        """
        return TomorrowBlockOverride.objects.filter(
            business_date=business_date
        ).exists()
