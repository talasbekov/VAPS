"""№1043: scoped personnel read model over existing status/OM registers."""
from django.db.models import Q, Value, OuterRef, Subquery, IntegerField, FloatField
from django.db.models.expressions import RawSQL
from django.db.models.functions import Coalesce

from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models import StatusType
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.services import PermissionService
from organization_management.apps.operations.api.permissions import resolve_actor_id
from organization_management.apps.ops import ratings
from organization_management.apps.operations.models_rating import OpsRatingFeatureFlags


def visible_employees(request):
    actor = resolve_actor_id(request)
    scope = PermissionService.visible_division_ids(actor, 'personnel.view')
    qs = Employee.objects.filter(is_active=True, employment_status='working')
    if scope is not None:
        qs = qs.filter(Q(staff_unit__division_id__in=scope) | Q(user=request.user))
    return qs.select_related('rank', 'staff_unit__position', 'staff_unit__division').order_by(
        'last_name', 'first_name', 'middle_name', 'id',
    )


def annotated_employees(qs, today):
    priorities = StatusType.objects.filter(code=OuterRef('status_type_code')).values('priority')[:1]
    current = OpsEmployeeStatus.objects.filter(
        employee_id=OuterRef('pk'), cancelled_at__isnull=True, period__contains=today,
    ).annotate(priority=Subquery(priorities)).order_by('priority', 'status_type_code', 'date_start', 'id')
    qs = qs.annotate(
        status_code=Coalesce(Subquery(current.values('status_type_code')[:1]), Value('IN_SERVICE')),
        status_end=Subquery(current.values('date_end')[:1]),
    )
    active_sql = '''SELECT count(*) FROM ops_security_events e,
        jsonb_array_elements(e.placement_assignments) a
        WHERE a->>'employeeId' = employees.id::text
          AND e.stage <> 'CLOSED'
          AND COALESCE(e.business_date_end, e.business_date) >= %s
          AND COALESCE(a->>'declinedAt', '') = ''
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(e.recon_sector_posts) p
            JOIN ops_security_event_visit_objects v ON v.id::text = p->>'visitObjectId'
            WHERE p->>'id' = a->>'postId' AND v.event_id = e.id AND v.stage = 'CLOSED'
          )'''
    qs = qs.annotate(active_count=RawSQL(f'({active_sql})', [today], output_field=IntegerField()))
    policy = ratings.read_rating_policy()
    flags = OpsRatingFeatureFlags.objects.filter(singleton_key=1).first()
    enabled = flags is not None and flags.operational_ratings
    if not enabled or policy is None:
        return qs.annotate(
            rating_value=Value(None, output_field=FloatField()), rating_count=Value(0), rated_events=Value(0),
            rating_state=Value('UNAVAILABLE' if flags is None else 'FEATURE_DISABLED' if not enabled else 'POLICY_UNDEFINED'),
        )
    start = ratings.period_start(today, policy['periodDays'])
    source = '''FROM ops_event_evaluations ev
        WHERE ev.participant_code IN (SELECT rp.participant_code FROM ops_rated_participants rp
            WHERE rp.employee_id = employees.id)
          AND ev.superseded_by_code IS NULL AND ev.withdrawn_at IS NULL
          AND ev.evaluated_at BETWEEN %s AND %s'''
    return qs.annotate(
        rating_state=Value('READY'),
        rated_events=RawSQL(f'(SELECT count(DISTINCT ev.event_code) {source})', [start, today], output_field=IntegerField()),
        rating_count=RawSQL(f'(SELECT count(*) {source})', [start, today], output_field=IntegerField()),
        rating_value=RawSQL(
            f'(SELECT CASE WHEN count(*) >= %s THEN round(avg(ev.score), 1) END {source})',
            [policy['minEvaluations'], start, today], output_field=FloatField(),
        ),
    )


def row_of(employee, names):
    slot = getattr(employee, 'staff_unit', None)
    division = slot.division if slot else None
    return {
        'id': employee.pk,
        'full_name': ' '.join(filter(None, [employee.last_name, employee.first_name, employee.middle_name])),
        'personnel_number': employee.personnel_number,
        'callsign': employee.callsign,
        'rank': employee.rank.name if employee.rank else None,
        'position': slot.position.name if slot and slot.position else None,
        'division': {'id': division.pk, 'name': division.name} if division else None,
        'current_status': {
            'code': employee.status_code,
            'name': names.get(employee.status_code, employee.status_code),
            'date_end': employee.status_end.isoformat() if employee.status_end else None,
        },
        'rating': employee.rating_value,
        'evaluations_count': employee.rating_count,
        'rated_events_count': employee.rated_events,
        'rating_state': 'INSUFFICIENT_DATA' if employee.rating_state == 'READY' and employee.rating_value is None else employee.rating_state,
        'active_assignments_count': employee.active_count,
        'next_assignment': None,
    }


def assignments_for(employee_ids, today):
    """One batch for the displayed page; only whitelisted assignment fields."""
    from organization_management.apps.operations.models_event import OpsSecurityEvent
    wanted = {str(pk) for pk in employee_ids}
    result = {pk: [] for pk in wanted}
    if not wanted:
        return result
    predicate = Q()
    for pk in wanted:
        predicate |= Q(placement_assignments__contains=[{'employeeId': pk}])
    events = list(OpsSecurityEvent.objects.filter(predicate).select_related('security_object').prefetch_related('visit_objects__security_object').order_by('business_date', 'id'))
    chief_ids = {event.chief_employee_id for event in events}
    chief_ids.update(visit.chief_employee_id for event in events for visit in event.visit_objects.all())
    chiefs = {e.pk: e for e in Employee.objects.filter(pk__in=[pk for pk in chief_ids if pk is not None]).only('id', 'callsign', 'work_phone')}
    for event in events:
        posts = {str(p.get('id')): p for p in event.recon_sector_posts}
        visits = {str(v.pk): v for v in event.visit_objects.all()}
        for assignment in event.placement_assignments:
            pk = str(assignment.get('employeeId'))
            if pk not in wanted:
                continue
            post = posts.get(str(assignment.get('postId')), {})
            visit = visits.get(str(post.get('visitObjectId')))
            closed = event.stage == 'CLOSED' or (visit is not None and visit.stage == 'CLOSED')
            end = event.business_date_end or event.business_date
            obj = visit.security_object if visit else event.security_object
            chief = chiefs.get(visit.chief_employee_id if visit else event.chief_employee_id)
            result[pk].append({
                'id': str(assignment.get('id', '')),
                'event_id': event.pk, 'event_code': event.code, 'event_title': event.title,
                'object_name': visit.object_name if visit else event.object_name,
                'post': post.get('post', ''), 'sector': post.get('sector', ''),
                'date_start': event.business_date.isoformat(), 'date_end': end.isoformat(),
                'closed': closed,
                'active': not closed and end >= today and not assignment.get('declinedAt'),
                'stage': visit.stage if visit else event.stage,
                'acknowledged_at': assignment.get('acknowledgedAt'),
                'declined_at': assignment.get('declinedAt'),
                'address': obj.address if obj else event.address,
                'event_time': event.event_time.isoformat() if event.event_time else None,
                'task': post.get('task', ''), 'requirements': post.get('requirements', ''),
                'uniform': post.get('uniform', ''), 'weapon': post.get('weapon', ''),
                'chief_name': visit.chief_name if visit else event.chief_name,
                'chief_callsign': chief.callsign if chief else None,
                'chief_work_phone': chief.work_phone if chief else None,
            })
    return result


def evaluations_for(employee_id):
    """New scoped card projection [СОТ-04]/[ПРФ-06]; not the global registry."""
    from django.contrib.auth.models import User
    from organization_management.apps.operations.models_rating import (
        OpsRatedParticipant, OpsEventEvaluation, OpsEvaluationEvent, OpsEvaluationWorkItem,
    )
    codes = OpsRatedParticipant.objects.filter(employee_id=employee_id).values('participant_code')
    evaluations = list(OpsEventEvaluation.objects.filter(
        participant_code__in=codes, superseded_by_code__isnull=True, withdrawn_at__isnull=True,
    ).order_by('-evaluated_at', '-id'))
    events = {e.event_code: e for e in OpsEvaluationEvent.objects.filter(event_code__in=[e.event_code for e in evaluations])}
    items = {i.submitted_evaluation_code: i for i in OpsEvaluationWorkItem.objects.filter(
        submitted_evaluation_code__in=[e.evaluation_code for e in evaluations],
    )}
    ids = {e.evaluator_user_id for e in evaluations if str(e.evaluator_user_id).isdigit()}
    users = {str(u.pk): u.get_full_name() or u.username for u in User.objects.filter(pk__in=ids)}
    return [{
        'event_id': events[e.event_code].security_event_id if e.event_code in events else None,
        'event_code': e.event_code,
        'score': e.score, 'comment': e.comment,
        'author': users.get(e.evaluator_user_id, 'Системная оценка' if not e.evaluator_user_id else 'Автор недоступен'),
        'date': e.evaluated_at.isoformat(),
        'assignment_id': items[e.evaluation_code].assignment_code if e.evaluation_code in items else None,
        'post': items[e.evaluation_code].post_label if e.evaluation_code in items else None,
    } for e in evaluations]
