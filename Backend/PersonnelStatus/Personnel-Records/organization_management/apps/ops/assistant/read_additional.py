"""Current workflow metadata; never opens snapshots, files or secret settings."""
from django.db.models import Q
from rest_framework.exceptions import NotFound
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.selectors import DailySubmissionSelector
from organization_management.apps.operations.models_report import OpsServiceReportJob
from organization_management.apps.operations.models_feedback import OpsFeedbackRequest
from organization_management.apps.operations.models_settings import OpsDictionaryEntry, OpsPolicySetting
from .live_data import require, page_result
from .read_catalogs import global_read, search_query


def execute_additional(authority, spec):
    op=spec['operation']
    if op=='daily_submissions':
        require(authority,'status.view')
        scope=authority.scope('status.view')
        if 'divisionId' in spec and scope is not None and spec['divisionId'] not in scope:raise NotFound()
        query=DailySubmissionSelector.list(scope=scope,division_id=spec.get('divisionId'),business_date=spec.get('date'),history=False)
        result=page_result(query,spec,lambda row:{'id':row.pk,'divisionId':row.division_id,'date':row.business_date.isoformat(),
            'revision':row.version,'state':row.event,'late':row.late,'title':'Сдача дня','sent':row.sent_at is not None})
        result['href']=('/employees?view=daily' if any(authority.has(c) for c in ('forces.command','forces.allocate','forces.select'))
                        else '/statuses' if authority.has('status.workspace') else None)
        return result
    if op=='report_jobs':
        require(authority,'report.generate')
        scope=authority.scope('report.generate')
        query=OpsServiceReportJob.objects.filter(created_by_user_id=authority.actor)
        if scope is not None:
            query=query.filter(scope_division_ids__isnull=False,scope_division_ids__contained_by=list(scope))
        query=search_query(query,spec,['job_code','report_type_code'])
        result=page_result(query.order_by('-requested_at','-pk'),spec,lambda row:{'id':row.pk,'code':row.job_code,
            'title':row.report_type_code,'state':row.state,'format':row.format,'date':row.requested_at.isoformat()})
        result['href']='/security-ops/service-reports';return result
    if op=='feedback':
        require(authority,'feedback.view')
        own=Q(author_user_id=authority.actor)
        query=OpsFeedbackRequest.objects.all()
        can_all=authority.has('feedback.view_all') and authority.scope('feedback.view_all') is None
        can_confidential=authority.has('feedback.view_confidential') and authority.scope('feedback.view_confidential') is None
        if not can_all:query=query.filter(own)
        elif not can_confidential:query=query.filter(own | Q(confidential=False))
        query=search_query(query,spec,['subject'])
        result=page_result(query.order_by('-created_at','-pk'),spec,lambda row:{'id':row.pk,'title':row.subject,
            'state':row.status_code,'priority':row.priority_code,'date':row.created_at.isoformat()})
        result['href']='/feedback';return result
    if op=='dictionaries':
        require(authority,'dictionary.view')
        scope=authority.scope('dictionary.view')
        query=OpsDictionaryEntry.objects.all()
        if scope is not None:query=query.filter(owner_division_id__in=scope)
        if 'divisionId' in spec:
            if scope is not None and spec['divisionId'] not in scope:raise NotFound()
            query=query.filter(owner_division_id=spec['divisionId'])
        query=search_query(query,spec,['dictionary_code','code','label'])
        result=page_result(query.order_by('dictionary_code','code','pk'),spec,lambda row:{'id':row.pk,'code':row.code,
            'name':row.label,'title':row.dictionary_code,'active':row.is_active})
        result['href']='/security-ops/dictionaries';return result
    if op=='settings':
        global_read(authority,'settings.view')
        query=search_query(OpsPolicySetting.objects.all(),spec,['setting_code','safe_label'])
        result=page_result(query.order_by('section_code','setting_code'),spec,lambda row:{'id':row.pk,'code':row.setting_code,
            'name':row.safe_label,'section':row.section_code,'editable':row.editable})
        result['notice']='Показаны только названия параметров; значения и серверная конфигурация не раскрываются.'
        result['href']='/security-ops/settings';return result
    from organization_management.apps.ops import ratings
    if op=='ratings':
        global_read(authority,'rating.view_aggregate')
        data=ratings.list_operational_ratings(actor=authority.actor)
        rows=data['results'];page=spec['page'];size=10
        # Reuse the screen's calculation and unpublished states, not a second
        # rating formula. No documents, evaluator comments or personnel links.
        result={'operation':op,'asOf':Clock.now().isoformat(),'count':len(rows),'page':page,'pageSize':size,'hasNext':page*size<len(rows),
            'rows':[{'name':r.get('safeLabel'),'rating':r.get('aggregateRating'),'state':r.get('dataState'),
                     'evaluationsCount':r.get('evaluationsCount')} for r in rows[(page-1)*size:page*size]],'href':'/security-ops/ratings'}
        return result
    global_read(authority,'analytics.view')
    data=ratings.rating_analytics(actor=authority.actor)
    # Keep suppression/feature/policy states authoritative. Nested figures can
    # include suppressed cells; do not flatten them into guessed zero values.
    result={'operation':op,'asOf':Clock.now().isoformat(),'count':1,'page':1,'pageSize':10,'hasNext':False,
        'rows':[{'title':'Состояние аналитики рейтинга','state':data.get('unpublishedReason') or 'AVAILABLE',
                 'published':data.get('figures') is not None}],'href':'/security-ops/ratings/analytics'}
    result['notice']='Показано состояние публикации. Защищённые агрегаты и пороги сохраняются на исходном экране.'
    return result
