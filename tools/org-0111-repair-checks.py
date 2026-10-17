"""Exact, idempotent data repair for the production links reported on 16 October.

Imports Django only in the database functions. No employee values are returned.
"""
import hashlib
import json


ANCHORS = {
    690: ('СГО РК', 'organization', None),
    716: ('Воинская часть 0111', 'department', 690),
    761: ('1 управление Воинской части 0111', 'directorate', 716),
    762: ('2 управление Воинской части 0111', 'directorate', 716),
    767: ('3 управление Воинской части 0111', 'directorate', 716),
}
INTERMEDIATES = (
    ('hq', 'Управление части Воинской части 0111', 'SJ-ORG-0111-HQ', 'directorate', 716,
     ('Управление части',)),
    ('u1d1', '1 отдел 1 управления Воинской части 0111', 'SJ-ORG-0111-U1-D1', 'division', 761,
     ('1 отдел', '1 отдел 1 управления', '1 отдел 1 управление Воинской части 0111')),
    ('u2d1', '1 отдел 2 управления Воинской части 0111', 'SJ-ORG-0111-U2-D1', 'division', 762,
     ('1 отдел', '1 отдел 2 управления', '1 отдел 2 управление Воинской части 0111')),
)
MOVES = {
    693: ('Отдел служебно-боевой работы и связи Управление части Воинской части 0111', 'hq'),
    694: ('Отдел боевой и специальной подготовки Управление части Воинской части 0111', 'hq'),
    695: ('1 группа 1 отдела 1 управления Воинской части 0111', 'u1d1'),
    696: ('2 группа 1 отдела 1 управления Воинской части 0111', 'u1d1'),
    702: ('1 группа 1 отдела 2 управления Воинской части 0111', 'u2d1'),
    703: ('2 группа 1 отдела 2 управления Воинской части 0111', 'u2d1'),
    704: ('Отделение строевого учета управления части Воинской части 0111', 'hq'),
    711: ('Отделение защиты государственных секретов управления части Воинской части 0111', 'hq'),
}
MPTT_FIELDS = {'tree_id', 'level', 'lft', 'rght'}


def normalized(value):
    return ' '.join(value.casefold().replace('ё', 'е').split())


def validate_graph(rows, *, intervals=False):
    by_id = {row['id']: row for row in rows}
    if len(rows) != len(by_id):
        raise RuntimeError('Duplicate division IDs')
    coordinates = set()
    for row in rows:
        seen, node = set(), row
        while node is not None:
            if node['id'] in seen:
                raise RuntimeError('Division parent cycle: ' + str(row['id']))
            seen.add(node['id'])
            if node['parent_id'] is not None and node['parent_id'] not in by_id:
                raise RuntimeError('Missing division parent: ' + str(node['id']))
            node = by_id.get(node['parent_id'])
        if intervals:
            if row['lft'] >= row['rght'] or row['lft'] < 1:
                raise RuntimeError('Invalid MPTT interval: ' + str(row['id']))
            for boundary in (row['lft'], row['rght']):
                point = row['tree_id'], boundary
                if point in coordinates:
                    raise RuntimeError('Duplicate MPTT coordinate')
                coordinates.add(point)
            parent = by_id.get(row['parent_id'])
            if parent is None:
                if row['level'] != 0:
                    raise RuntimeError('Invalid MPTT root level')
            elif (row['tree_id'] != parent['tree_id'] or row['level'] != parent['level'] + 1 or
                  not parent['lft'] < row['lft'] < row['rght'] < parent['rght']):
                raise RuntimeError('MPTT does not match the actual parent: ' + str(row['id']))


def build_plan(rows):
    validate_graph(rows)
    by_id = {row['id']: row for row in rows}
    for pk, (name, kind, parent) in ANCHORS.items():
        row = by_id.get(pk)
        if row is None or (normalized(row['name']), row['division_type'], row['parent_id']) != (normalized(name), kind, parent):
            raise RuntimeError('Unexpected or changed anchor: ' + str(pk))
    refs, create = {}, []
    for ref, name, code, kind, parent, short_names in INTERMEDIATES:
        full_names = {normalized(name)} | {normalized(text) for text in short_names if '0111' in text}
        sibling_names = full_names | {normalized(text) for text in short_names}
        candidates = [row for row in rows if row['code'] == code or normalized(row['name']) in full_names or
                      row['parent_id'] == parent and normalized(row['name']) in sibling_names]
        if len(candidates) > 1:
            raise RuntimeError('Intermediate division is ambiguous: ' + ref)
        if candidates:
            row = candidates[0]
            if row['parent_id'] != parent or row['division_type'] != kind or normalized(row['name']) not in sibling_names:
                raise RuntimeError('Intermediate exists elsewhere or has an unexpected parent/type: ' + str(row['id']))
            refs[ref] = row['id']
        else:
            refs[ref] = ref
            create.append({'ref': ref, 'name': name, 'code': code, 'division_type': kind, 'parent_id': parent})
    changes = []
    for pk, (name, target) in MOVES.items():
        row = by_id.get(pk)
        if row is None or normalized(row['name']) != normalized(name):
            raise RuntimeError('Unexpected or changed source division: ' + str(pk))
        old = {'parent_id': row['parent_id'], 'division_type': row['division_type']}
        new = {'parent_id': refs[target], 'division_type': 'division'}
        if old == new:
            continue
        if old != {'parent_id': 690, 'division_type': 'department'}:
            raise RuntimeError('Unexpected or changed source parent/type: ' + str(pk))
        changes.append({'id': pk, 'name': row['name'], 'code': row['code'], 'before': old, 'after': new})
    return {'version': 1, 'organization_id': 690, 'military_unit_id': 716,
            'refs': refs, 'create': create, 'changes': changes,
            'kept_reporting_types': {'716': 'department', '691': 'department'}}


def capture():
    from django.db import connection
    quote = connection.ops.quote_name
    result = {'tables': {}, 'sequences': {}, 'divisions': []}
    with connection.cursor() as cursor:
        cursor.execute("SELECT table_name,column_name,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")
        result['schema'] = [list(row) for row in cursor.fetchall()]
        cursor.execute("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname")
        tables = [row[0] for row in cursor.fetchall()]
        for table in tables:
            cursor.execute('SELECT md5(ROW(t.*)::text) FROM ' + quote(table) + ' t ORDER BY 1')
            digest, count = hashlib.sha256(), 0
            for batch in iter(lambda: cursor.fetchmany(2000), []):
                for value, in batch:
                    digest.update(value.encode('ascii'))
                    count += 1
            result['tables'][table] = {'rows': count, 'sha256': digest.hexdigest()}
        cursor.execute('SELECT * FROM divisions ORDER BY id')
        columns = [item[0] for item in cursor.description]
        result['divisions'] = [dict(zip(columns, row)) for row in cursor.fetchall()]
        cursor.execute("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S' ORDER BY c.relname")
        for sequence in [row[0] for row in cursor.fetchall()]:
            cursor.execute('SELECT last_value,is_called FROM ' + quote(sequence))
            result['sequences'][sequence] = list(cursor.fetchone())
        cursor.execute("SELECT pg_get_serial_sequence('divisions','id')")
        result['division_sequence'] = cursor.fetchone()[0].split('.')[-1].strip('"')
    return json.loads(json.dumps(result, default=str))


def verify_preserved(before, after, plan):
    if before['schema'] != after['schema']:
        raise RuntimeError('Database schema changed')
    if {key: value for key, value in before['tables'].items() if key != 'divisions'} != {
            key: value for key, value in after['tables'].items() if key != 'divisions'}:
        raise RuntimeError('A table outside divisions changed; repair refused')
    old = {row['id']: row for row in before['divisions']}
    new = {row['id']: row for row in after['divisions']}
    if not old.keys() <= new.keys():
        raise RuntimeError('An existing division disappeared')
    created = {ref: value for ref, value in plan['refs'].items() if isinstance(value, int)}
    for node in plan['create']:
        candidates = [row for pk, row in new.items() if pk not in old and row['code'] == node['code']]
        if len(candidates) != 1:
            raise RuntimeError('Expected exactly one newly created intermediate: ' + node['ref'])
        row = candidates[0]
        if any(row[key] != node[key] for key in ('name', 'code', 'division_type', 'parent_id')):
            raise RuntimeError('Unexpected new intermediate contents')
        created[node['ref']] = row['id']
    if len(new) - len(old) != len(plan['create']):
        raise RuntimeError('Unexpected added divisions')
    intended = {item['id']: item['after'] for item in plan['changes']}
    for pk, original in old.items():
        expected = {key: value for key, value in original.items() if key not in MPTT_FIELDS}
        if pk in intended:
            expected.update({key: created.get(value, value) for key, value in intended[pk].items()})
        if expected != {key: value for key, value in new[pk].items() if key not in MPTT_FIELDS}:
            raise RuntimeError('An existing division changed outside the approved fields: ' + str(pk))
    for name, state in before['sequences'].items():
        if name != before['division_sequence'] and after['sequences'].get(name) != state:
            raise RuntimeError('An unrelated sequence changed: ' + name)
    if not plan['create'] and after['sequences'] != before['sequences']:
        raise RuntimeError('An existing sequence changed without new divisions')
    validate_graph(after['divisions'], intervals=True)
    remaining = build_plan(after['divisions'])
    if remaining['create'] or remaining['changes']:
        raise RuntimeError('Repair is incomplete')


def apply_atomic(before, plan):
    from django.db import connection, transaction
    from organization_management.apps.divisions.models import Division
    if plan != build_plan(before['divisions']):
        raise RuntimeError('Repair plan was modified')
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL lock_timeout='15s'")
            cursor.execute("SET LOCAL statement_timeout='5min'")
            cursor.execute('LOCK TABLE ' + ','.join(connection.ops.quote_name(name) for name in sorted(before['tables'])) + ' IN ACCESS EXCLUSIVE MODE')
        if capture() != before:
            raise RuntimeError('Database changed before repair; no changes committed')
        refs = dict(plan['refs'])
        with Division.objects.disable_mptt_updates():
            for node in plan['create']:
                fields = {key: node[key] for key in ('name', 'code', 'division_type', 'parent_id')}
                refs[node['ref']] = Division.objects.create(**fields).pk
            for change in plan['changes']:
                fields = {key: refs.get(value, value) for key, value in change['after'].items()}
                if Division.objects.filter(pk=change['id'], **change['before']).update(**fields) != 1:
                    raise RuntimeError('Division changed before update: ' + str(change['id']))
        Division.objects.rebuild()
        after = capture()
        verify_preserved(before, after, plan)
    return after
