"""Оценки сотрудников на этапе 5 «Проведение» (`[МД-08]`/`[ЗАК-02]`/`[ЗАК-05]`,
Plane №433, Ш-17 плана P2).

Модель рейтинга (`models_rating`) ОСТАЁТСЯ — расширяем, не подменяем: оценка
этапа — та же строка `OpsEventEvaluation`, что и оценка из модуля рейтинга,
поэтому средний балл сотрудника считает один и тот же `included_evaluations`.
Отличие пути — правила формы: спецификация этапа не требует основания и
комментария (при ≤ 5 экран лишь подсвечивает «желательно пояснить»), а
модуль рейтинга требует и то и другое — поэтому у этапа своя запись, а не
`submit_evaluation`. Метод строки — ручной (`MANUAL`), основание — «Исполнение
обязанностей».

Задания оценщика (`OpsEvaluationWorkItem`) заводятся входом объекта в этап 5
(`security_events.advance_visits`), а не закрытием ОМ — иначе на этапе
оценивать было бы нечего.
"""
from django.db import transaction

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_rating import (
    OpsEvaluationWorkItem,
    OpsEventEvaluation,
)
from organization_management.apps.ops import ratings
from organization_management.apps.ops import security_events as events

# Метод — из допустимых CHECK-ограничением модели (MANUAL, SYSTEM_DEFAULT):
# оценку ставит человек на этапе, это ручная оценка.
STAGE_METHOD = "MANUAL"
STAGE_BASIS = "EXECUTION_OF_DUTIES"


def _event_code(event):
    return f"security-event-{event.pk}"


def _current_evaluations(event):
    """Действующие оценки ОМ по коду участника."""
    rows = OpsEventEvaluation.objects.filter(
        event_code=_event_code(event), superseded_by_code__isnull=True
    ).order_by("pk")
    return {row.participant_code: row for row in rows}


def _replaced_rows(event):
    """Снятые заменой — только в журнале (`replace_assignment` убирает строку
    назначения). Имя берётся из описания «X → Y — причина: …»."""
    out = []
    for entry in event.journal_entries or []:
        if entry.get("type") != "REPLACEMENT":
            continue
        head = str(entry.get("description") or "").split(" → ", 1)[0].strip()
        out.append({
            "assignmentId": None,
            "postId": None,
            "post": str(entry.get("title") or "").replace("Замена: ", "", 1),
            "sector": "",
            "employeeId": None,
            "employeeName": head,
            "divisionName": "",
            "acknowledgedAt": None,
            "replaced": True,
            "score": None,
            "comment": "",
        })
    return out


def visit_evaluations(event, visit):
    """Сводка оценок объекта: строки по секторам и постам + «Оценено K из N»."""
    posts = {str(p.get("id")): p for p in events.visit_object_posts(event, visit)}
    current = _current_evaluations(event)
    rows = []
    for a in event.placement_assignments or []:
        post = posts.get(str(a.get("postId")))
        if post is None:
            continue
        employee_id = str(a.get("employeeId") or "")
        code = ratings._participant_code_for(int(employee_id)) if employee_id.isdigit() else None
        row = current.get(code) if code else None
        rows.append({
            "assignmentId": a.get("id"),
            "postId": str(a.get("postId")),
            "post": post.get("post") or "",
            "sector": post.get("sector") or "",
            "employeeId": employee_id or None,
            "employeeName": a.get("employeeName") or "",
            "divisionName": a.get("divisionName") or "",
            "acknowledgedAt": a.get("acknowledgedAt"),
            "replaced": False,
            "score": row.score if row is not None else None,
            "comment": (row.comment or "") if row is not None else "",
        })
    rows.sort(key=lambda r: (r["sector"], r["post"], r["employeeName"]))
    total = len(rows)
    evaluated = sum(1 for r in rows if r["score"] is not None)
    return {
        "rows": rows + _replaced_rows(event),
        "evaluated": evaluated,
        "total": total,
        "incidents": sum(
            1 for e in (event.journal_entries or []) if e.get("type") == "INCIDENT"
        ),
    }


def _require_open(event, visit):
    events._require_stage(
        event, "CONDUCT", "Оценки ставятся на этапе «Проведение»."
    )
    if visit.stage == "CLOSED":
        raise DomainError(
            "VISIT_OBJECT_ALREADY_CLOSED",
            422,
            message="Объект закрыт — изменения после закрытия невозможны.",
        )


def _validate_score(score):
    if score is None:
        return None
    if isinstance(score, bool) or not isinstance(score, int):
        raise DomainError(
            "SCORE_NOT_INTEGER", 422,
            message="Оценка выставляется целым значением шкалы.",
        )
    if score < ratings.RATING_SCALE_MIN or score > ratings.RATING_SCALE_MAX:
        raise DomainError(
            "SCORE_OUT_OF_SCALE", 422,
            message=f"Оценка вне шкалы {ratings.RATING_SCALE_MIN}–{ratings.RATING_SCALE_MAX}.",
        )
    return score


def _write(event, assignment, *, score, comment, actor):
    """Одна оценка одному назначению: прежняя строка помечается
    `superseded_by_code`, чтобы средний балл считал только действующую.
    `score=None` — снять оценку (повторный клик по цифре)."""
    employee_id = str(assignment.get("employeeId") or "")
    if not employee_id.isdigit():
        raise DomainError(
            "EVALUATION_TARGET_UNKNOWN", 422,
            message="У назначения нет сотрудника — оценивать некого.",
        )
    ratings.open_evaluation_for_event(event, actor=actor)
    code = ratings._participant_code_for(int(employee_id))
    event_code = _event_code(event)
    previous = list(
        OpsEventEvaluation.objects.filter(
            event_code=event_code, participant_code=code,
            superseded_by_code__isnull=True,
        )
    )
    work_item = OpsEvaluationWorkItem.objects.filter(
        work_item_code=f"{event_code}-{code}"
    ).first()
    if score is None:
        for row in previous:
            row.superseded_by_code = "withdrawn"
            row.save(update_fields=["superseded_by_code", "updated_at"])
        if work_item is not None:
            work_item.status = "PENDING"
            work_item.submitted_evaluation_code = None
            work_item.submitted_at = None
            work_item.save(update_fields=[
                "status", "submitted_evaluation_code", "submitted_at", "updated_at",
            ])
        return None
    evaluation = OpsEventEvaluation.objects.create(
        evaluation_code=ratings._tmp_code(),
        event_code=event_code,
        participant_code=code,
        evaluator_user_id=str(actor or ""),
        score=score,
        comment=(comment or "").strip() or None,
        evaluation_direction="SENIOR_TO_EMPLOYEE",
        method=STAGE_METHOD,
        basis_code=STAGE_BASIS,
        basis_note=None,
        evaluated_at=Clock.today_local(),
        superseded_by_code=None,
    )
    ratings._stamp_code(evaluation, "evaluation_code", "evaluation")
    for row in previous:
        row.superseded_by_code = evaluation.evaluation_code
        row.save(update_fields=["superseded_by_code", "updated_at"])
    if work_item is not None:
        work_item.status = "SUBMITTED"
        work_item.submitted_evaluation_code = evaluation.evaluation_code
        work_item.submitted_at = Clock.now()
        work_item.save(update_fields=[
            "status", "submitted_evaluation_code", "submitted_at", "updated_at",
        ])
    return evaluation


def _assignment_of(event, visit, assignment_id):
    posts = {str(p.get("id")) for p in events.visit_object_posts(event, visit)}
    for a in event.placement_assignments or []:
        if a.get("id") == assignment_id and str(a.get("postId")) in posts:
            return a
    raise DomainError(
        "ASSIGNMENT_NOT_FOUND", 404,
        message="Назначение не найдено у этого объекта.",
    )


@transaction.atomic
def set_score(event_id, visit_object_id, *, assignment_id, score, comment, actor):
    event = events.lock_event(event_id)
    visit = events._visit_object_or_404(event, visit_object_id)
    _require_open(event, visit)
    assignment = _assignment_of(event, visit, assignment_id)
    _write(event, assignment, score=_validate_score(score), comment=comment, actor=actor)
    return visit_evaluations(event, visit)


@transaction.atomic
def score_all(event_id, visit_object_id, *, score, actor):
    """«Всем 10» (`[ЗАК-02]`): оценка всем НЕОЦЕНЁННЫМ строкам объекта —
    уже поставленные вручную не перезаписываются."""
    event = events.lock_event(event_id)
    visit = events._visit_object_or_404(event, visit_object_id)
    _require_open(event, visit)
    value = _validate_score(score)
    if value is None:
        raise DomainError(
            "SCORE_NOT_INTEGER", 422,
            message="Оценка выставляется целым значением шкалы.",
        )
    summary = visit_evaluations(event, visit)
    unscored = {r["assignmentId"] for r in summary["rows"] if not r["replaced"] and r["score"] is None}
    for a in event.placement_assignments or []:
        if a.get("id") in unscored:
            _write(event, a, score=value, comment="", actor=actor)
    return visit_evaluations(event, visit)
