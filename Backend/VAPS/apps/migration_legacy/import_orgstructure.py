"""Story 7.2 — идемпотентный импорт дерева подразделений, ставок и
справочников (должности/звания) из donor dumpdata.

Извлечено из ``import_donor_slice.Command`` (Story 1.6, walking skeleton) —
логика буквально перенесена, НЕ переписана: 1.6 уже реализовала
идемпотентность (``update_or_create``) и diff-отчёт (read/created/updated/
skipped + причины), расхождение копии с оригиналом было бы риском parity,
как и в 7.1 (профилировщик vs импортёр). Обе команды (``import_donor_slice``
для 5-7-дневного walking-skeleton прогона и ``import_donor_orgstructure``
для полного экспорта без временного окна employees/statuses) вызывают ЭТИ
функции — не свои копии.

Требует ORM (в отличие от ``transform.py``/``donor_diff.py``/
``donor_profile.py``) — сама суть этого модуля - создавать/обновлять записи.
"""

from collections import defaultdict

from apps.core.models import Division, DivisionHistoricalSlot, DivisionType
from apps.core.models import Organization, Position, Rank
from apps.core.selectors import local_midnight
from apps.migration_legacy.transform import count_staff_slots

EXAMPLE_LIMIT = 5


def _well_formed_rows(rows, report):
    """Отсеивает структурно повреждённые строки (нет 'fields'/'pk', либо
    'fields' — не dict) в report.skip("malformed_row", ...) вместо KeyError
    ниже по пайплайну — тот же принцип, что и в profiler'е 7.1: грязный
    донорский вход не должен ронять ВЕСЬ импорт (и тем самым откатывать
    транзакцию, теряя уже готовые к записи строки)."""
    good = []
    for row in rows:
        is_well_formed = (
            isinstance(row, dict)
            and isinstance(row.get("fields"), dict)
            and "pk" in row
        )
        if is_well_formed:
            good.append(row)
        else:
            pk = row.get("pk") if isinstance(row, dict) else "?"
            report.skip("malformed_row", pk)
    return good


class EntityReport:
    def __init__(self):
        self.read = 0
        self.created = 0
        self.updated = 0
        self.skips = defaultdict(list)
        self.warnings = defaultdict(list)

    def count(self, created):
        if created:
            self.created += 1
        else:
            self.updated += 1

    def skip(self, reason, donor_pk):
        self.skips[reason].append(donor_pk)

    def warn(self, reason, donor_pk):
        # The row WAS imported, but with a caveat 1.8 must see (a warning
        # is not a skip — it must not inflate the skipped counter).
        self.warnings[reason].append(donor_pk)

    @property
    def skipped(self):
        return sum(len(pks) for pks in self.skips.values())


def import_divisions(rows, org_report, div_report):
    rows = _well_formed_rows(rows, div_report)
    div_rows = {row["pk"]: row for row in rows}

    def is_org_root(row):
        f = row["fields"]
        return f["division_type"] == "organization" and f["parent"] is None

    org_map = {}
    for pk, row in sorted(div_rows.items()):
        if not is_org_root(row):
            continue
        org_report.read += 1
        org, created = Organization.objects.update_or_create(
            code=row["fields"]["code"],
            defaults={"name": row["fields"]["name"]},
        )
        org_report.count(created)
        org_map[pk] = org

    fallback_org = None

    def org_for(row):
        nonlocal fallback_org
        cur = row
        seen = {cur["pk"]}
        while (
            cur["fields"]["parent"] is not None
            and cur["fields"]["parent"] in div_rows
        ):
            parent_pk = cur["fields"]["parent"]
            if parent_pk in seen:
                # Broken donor tree (A→B→A): bail out to the fallback
                # org instead of looping forever inside the transaction.
                break
            seen.add(parent_pk)
            cur = div_rows[parent_pk]
        root_org = org_map.get(cur["pk"])
        if root_org is not None:
            return root_org
        if fallback_org is None:
            fallback_org, created = Organization.objects.update_or_create(
                code="DONOR", defaults={"name": "Импорт донора"}
            )
            org_report.count(created)
        return fallback_org

    division_map = {}
    for pk, row in sorted(div_rows.items()):
        if is_org_root(row):
            continue
        div_report.read += 1
        fields = row["fields"]
        # Literal donor type codes, no translation (Glossary STOP);
        # department/division match seed_core, directorate gets added.
        type_code, _ = DivisionType.objects.get_or_create(
            code=fields["division_type"],
            defaults={"name": fields["division_type"]},
        )
        division, created = Division.objects.update_or_create(
            organization=org_for(row),
            code=fields["code"],
            defaults={"name": fields["name"], "type_code": type_code},
        )
        div_report.count(created)
        division_map[pk] = division

    # Second pass: parents (donor MPTT order is not creation-safe).
    for pk, row in sorted(div_rows.items()):
        division = division_map.get(pk)
        if division is None:
            continue
        parent_pk = row["fields"]["parent"]
        desired = division_map.get(parent_pk)  # org root -> None
        if desired is None and parent_pk is not None and parent_pk not in div_rows:
            # Dangling parent ref (partial export): the division is
            # imported at the root, but silently flattening would be
            # indistinguishable from a legal org-root parent.
            div_report.warn("dangling_parent", pk)
        desired_pk = desired.pk if desired is not None else None
        if division.parent_id != desired_pk:
            division.parent = desired
            division.save(update_fields=["parent"])

    return division_map


def import_staffing_slots(rows, division_map, as_of, report):
    """Materialize Штат: one DivisionHistoricalSlot per division.

    ``as_of`` — точка отсчёта для ``valid_from``, СЕМАНТИКА ЗАВИСИТ ОТ
    ВЫЗЫВАЮЩЕЙ КОМАНДЫ: ``import_donor_slice`` передаёт начало 5-7-дневного
    employee/status окна, ``import_donor_orgstructure`` передаёт `--as-of`
    (по умолчанию сегодня) — у неё employee/status окна вообще нет. Функция
    не знает и не должна знать разницу — обеим достаточно "с какой даты
    считать этот штат действующим".

    Sanctioned by the 1.6 handoff («Если 1.7 упрётся в "Вакансии" —
    расширение делается в 1.7»). One timeline row per (division, as_of):
    update_or_create on (division, valid_from=local midnight of as_of)
    is idempotent for the same as_of; a different as_of adds a second row
    and the selector takes the one with max valid_from (Решение №5; the
    full timeline policy is E7).
    """
    rows = _well_formed_rows(rows, report)
    report.read = len(rows)
    counts, skips = count_staff_slots(rows)
    for reason, pks in skips.items():
        for pk in pks:
            report.skip(reason, pk)
    valid_from = local_midnight(as_of)
    # Donor divisions sharing (organization, code) collapse into ONE
    # Division (unique_org_division_code): SUM their per-donor-pk counts
    # onto the resolved Division so Штат (BR-002 STAFF_TOTAL) is the
    # total of all donor slots, not just the last pk's — and count
    # "covered" once per distinct Division (review C2/KO-2 2026-06-15).
    slots_by_division: dict = {}
    resolved: dict = {}
    for division_pk in sorted(counts):
        division = division_map.get(division_pk)
        if division is None:
            # Examples carry the donor DIVISION pk (the slot pks are
            # lost in the counting), unlike the per-row skips above.
            report.skip("slot_division_skipped", division_pk)
            continue
        resolved[division.pk] = division
        slots_by_division[division.pk] = (
            slots_by_division.get(division.pk, 0) + counts[division_pk]
        )
    covered = 0
    for div_id, allocated in slots_by_division.items():
        _, created = DivisionHistoricalSlot.objects.update_or_create(
            division=resolved[div_id],
            valid_from=valid_from,
            # allocated_slots stays in defaults: a re-run with a changed
            # slot count must UPDATE the same-window row.
            defaults={"allocated_slots": allocated},
        )
        report.count(created)
        covered += 1
    return covered


def import_ranks(rows, report):
    rank_map = {}
    for row in sorted(_well_formed_rows(rows, report), key=lambda r: r["pk"]):
        report.read += 1
        fields = row["fields"]
        # Donor has no codes (name+level only): a synthetic stable code
        # from donor_pk keeps the import idempotent (decision #9).
        # NB: donor level is "smaller = higher", seed_core rank_index is
        # "bigger = higher" — carried AS IS, no inversion; the consumer
        # arrives in 2.6 (sort canon) and decides there.
        _, created = Rank.objects.update_or_create(
            code=f"RANK_{row['pk']}",
            defaults={"name": fields["name"], "rank_index": fields["level"]},
        )
        report.count(created)
        rank_map[row["pk"]] = (f"RANK_{row['pk']}", fields["level"])
    return rank_map


def import_positions(rows, report):
    position_pks = set()
    for row in sorted(_well_formed_rows(rows, report), key=lambda r: r["pk"]):
        report.read += 1
        fields = row["fields"]
        _, created = Position.objects.update_or_create(
            code=f"POS_{row['pk']}",
            defaults={"name": fields["name"], "level": fields["level"]},
        )
        report.count(created)
        position_pks.add(row["pk"])
    return position_pks
