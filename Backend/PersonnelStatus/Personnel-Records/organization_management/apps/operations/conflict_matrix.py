"""Декларативная матрица конфликтов статусов + чистый детектор (порт
apps/operations/statuses/conflict_matrix.py из Backend/VAPS — ДОСЛОВНО,
включая словарь степеней и правило PLANNED→warning).

Чистый модуль (ни Django, ни ORM): правила конфликтов — данные, а не
россыпь if-ов, поэтому матрица проверяема без БД.

Это единственный python-источник набора жёстких типов: и GiST-ограничение
excl_hard_status_overlap (models_status.py), и детектор ниже читают
HARD_STATUS_TYPE_CODES отсюда. ОГОВОРКА: живое ограничение БД — снимок
миграции, предикат заморожен в неё; правка этого кортежа требует НОВОЙ
миграции, иначе python и БД разъедутся.

Словарь степеней:
  HARD       → 422 OVERLAPPING_HARD_STATUS (не обходится). GiST-ограничение
               подстраховывает именно гонку hard×HARD; hard×soft ловит
               только этот детектор (частичное ограничение покрывает лишь
               hard×hard).
  SOFT       → 409 STATUS_OVERLAP_WARNING (обходится с причиной)
  COMPATIBLE → не конфликт (пара откомандирован/прикомандирован)

Мягкое пересечение со ещё не начавшимся (PLANNED на бизнес-дату) статусом
понижается до необязывающего предупреждения. Жёсткое остаётся 422 при любом
состоянии другого статуса — согласованно с ограничением БД, которое
состояние игнорирует.
"""

from dataclasses import dataclass
from enum import Enum

# Single Python source for hard-block status types (Решение №3=A). Synced to
# StatusType.is_hard_block rows by the 2.2 seed test, AND frozen into the GiST
# constraint of migration 0001 — editing this tuple needs a NEW migration.
HARD_STATUS_TYPE_CODES = ("SICK_LEAVE", "LEAVE_BY_REPORT", "VACATION", "COMMAND")

# Declarative exceptions: unordered type pairs that may legitimately coexist.
# Story 3.10 (FR-14): the secondment pair — a seconded employee carries both
# DETACHED (home «по списку») and ATTACHED («+N» at the receiving unit) over the
# same interval, so the two legs must NOT classify as a conflict. Each entry is
# a frozenset of two type codes.
COMPATIBLE_PAIRS: frozenset = frozenset({frozenset(("DETACHED", "ATTACHED"))})


class ConflictSeverity(Enum):
    HARD = "HARD"
    SOFT = "SOFT"
    COMPATIBLE = "COMPATIBLE"


def classify_pair(type_a, type_b):
    """Severity of an overlap between two status types — pure and symmetric.

    HARD if either side is a hard-block type (matches the GiST constraint and
    FR-11 «пересечение с hard-типом → 422»); COMPATIBLE for declared exception
    pairs; SOFT otherwise.
    """
    if type_a in HARD_STATUS_TYPE_CODES or type_b in HARD_STATUS_TYPE_CODES:
        return ConflictSeverity.HARD
    if frozenset((type_a, type_b)) in COMPATIBLE_PAIRS:
        return ConflictSeverity.COMPATIBLE
    return ConflictSeverity.SOFT


@dataclass(frozen=True)
class Conflict:
    severity: ConflictSeverity
    other_status_type: str
    other_date_start: object
    other_date_end: object
    other_is_planned: bool


@dataclass(frozen=True)
class ConflictReport:
    hard: tuple = ()
    soft: tuple = ()
    warnings: tuple = ()

    def has_blocking(self):
        """True if anything blocks creation (hard → 422 or soft → 409)."""
        return bool(self.hard or self.soft)


def detect_conflicts(*, new_type, existing_rows, business_date):
    """Classify each already-overlapping existing status against ``new_type``.

    ``existing_rows`` is an iterable of mappings with ``status_type_code`` /
    ``date_start`` / ``date_end`` — already filtered to live, interval-
    overlapping rows by the caller (the half-open overlap predicate stays in the
    selector/query, exactly as in story 3.3). PURE: no ORM, no DB.

    ``business_date`` decides PLANNED: a SOFT overlap with a status whose
    ``date_start`` is in the future is a non-blocking WARNING (FR-10).
    """
    hard, soft, warnings = [], [], []
    for row in existing_rows:
        other_type = row["status_type_code"]
        severity = classify_pair(new_type, other_type)
        if severity is ConflictSeverity.COMPATIBLE:
            continue
        is_planned = row["date_start"] > business_date
        conflict = Conflict(
            severity=severity,
            other_status_type=other_type,
            other_date_start=row["date_start"],
            other_date_end=row["date_end"],
            other_is_planned=is_planned,
        )
        if severity is ConflictSeverity.HARD:
            hard.append(conflict)
        elif is_planned:
            warnings.append(conflict)
        else:
            soft.append(conflict)
    return ConflictReport(
        hard=tuple(hard), soft=tuple(soft), warnings=tuple(warnings)
    )
