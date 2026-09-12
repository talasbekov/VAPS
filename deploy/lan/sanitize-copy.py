#!/usr/bin/env python3
"""Prepare only a disposable LAN copy: retain users and reference catalogs."""
import argparse
import hashlib
import json
import os

import psycopg2
from psycopg2 import sql

parser = argparse.ArgumentParser()
parser.add_argument('--confirm-copy-only', action='store_true', required=True)
args = parser.parse_args()
name = os.environ.get('POSTGRES_DB', '')
if not name.startswith('lan1172_') or os.environ.get('POSTGRES_HOST') != 'db':
    raise SystemExit('Refusing: only the dedicated db service and lan1172_* COPY database are allowed')

# Mirrors admin_categories.py: all Dictionaries, access catalogs and current settings.
# OpsVehicle and OpsRatingGroup belong to Dictionaries even though they look operational.
KEEP = {
    'auth_user', 'auth_group', 'auth_permission', 'auth_group_permissions',
    'auth_user_groups', 'auth_user_user_permissions',
    'django_content_type', 'django_migrations',
    'dictionaries_dismissalreason', 'dictionaries_documenttype',
    'dictionaries_educationtype', 'dictionaries_position', 'dictionaries_rank',
    'dictionaries_statustype', 'dictionaries_systemsetting',
    'dictionaries_transferreason', 'dictionaries_vacancyreason',
    'operations_opscity', 'operations_opscountry', 'operations_opslegaldocument',
    'ops_analytics_metric_definitions', 'ops_analytics_period_presets',
    'ops_approval_route_steps', 'ops_attention_detectors', 'ops_combat_duty_types',
    'ops_combat_routes', 'ops_dictionary_entries', 'ops_duty_conflict_policy',
    'ops_duty_types', 'ops_feedback_registry', 'ops_passport_freshness_policy',
    'ops_permissions', 'ops_policy_section_versions', 'ops_policy_settings',
    'ops_rating_feature_flags', 'ops_rating_groups', 'ops_role_permissions',
    'ops_roles', 'ops_service_report_types', 'ops_status_types',
    'ops_submission_control_settings', 'ops_user_roles', 'ops_vehicles',
}
connection = psycopg2.connect(host='db', port=5432, dbname=name,
    user=os.environ['POSTGRES_USER'], password=os.environ['POSTGRES_PASSWORD'])
with connection, connection.cursor() as cur:
    cur.execute('SELECT tablename FROM pg_tables WHERE schemaname=%s', ('public',))
    tables = {row[0] for row in cur.fetchall()}
    if KEEP - tables:
        raise SystemExit('Schema mismatch; missing preserved tables: '+', '.join(sorted(KEEP-tables)))
    def count(table):
        cur.execute(sql.SQL('SELECT count(*) FROM {}').format(sql.Identifier(table)))
        return cur.fetchone()[0]
    def fingerprint(table):
        cur.execute(sql.SQL('SELECT row_to_json(t)::text FROM {} t').format(sql.Identifier(table)))
        rows = sorted(row[0] for row in cur.fetchall())
        return hashlib.sha256('\n'.join(rows).encode()).hexdigest()
    before = {table: count(table) for table in sorted(tables)}
    hashes = {table: fingerprint(table) for table in sorted(KEEP)}
    # These are grants over removed divisions. NULL would broaden them to global:
    # delete the grants, retaining users/roles for explicit reassignment later.
    cur.execute('DELETE FROM ops_user_roles WHERE scope_division_id IS NOT NULL')
    removed_scoped_grants = cur.rowcount
    # Keep the dictionary value, detach its removed division owner.
    cur.execute('UPDATE ops_dictionary_entries SET owner_division_id=NULL WHERE owner_division_id IS NOT NULL')
    detached_owners = cur.rowcount
    cur.execute("UPDATE ops_submission_control_settings SET required_division_ids='{}'")
    cur.execute('SET CONSTRAINTS ALL DEFERRED')
    # Append-only audit triggers are correct for the running app. This guarded,
    # isolated copy is intentionally reset; preserve each trigger enable state.
    cur.execute("SELECT c.relname,t.tgname,t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal")
    triggers = [row for row in cur.fetchall() if row[0] not in KEEP]
    for table, trigger, state in triggers:
        cur.execute(sql.SQL('ALTER TABLE {} DISABLE TRIGGER {}').format(sql.Identifier(table), sql.Identifier(trigger)))
    # DELETE (not TRUNCATE CASCADE): preserved FK tables must never be emptied.
    # Sequence counters stay ahead of previous IDs, avoiding accidental reuse.
    for table in sorted(tables - KEEP):
        cur.execute(sql.SQL('DELETE FROM {}').format(sql.Identifier(table)))
    for table, trigger, state in triggers:
        command = {'O': 'ENABLE', 'A': 'ENABLE ALWAYS', 'R': 'ENABLE REPLICA', 'D': 'DISABLE'}[state]
        cur.execute(sql.SQL('ALTER TABLE {} ' + command + ' TRIGGER {}').format(sql.Identifier(table), sql.Identifier(trigger)))
    cur.execute('SET CONSTRAINTS ALL IMMEDIATE')
    after = {table: count(table) for table in sorted(tables)}
    assert all(after[t] == 0 for t in tables - KEEP)
    exceptions = {'ops_user_roles', 'ops_dictionary_entries', 'ops_submission_control_settings'}
    assert all(fingerprint(t) == hashes[t] for t in KEEP-exceptions), 'Preserved data changed'
    assert after['auth_user'] == before['auth_user']
    assert after['ops_dictionary_entries'] == before['ops_dictionary_entries']
    cur.execute('SELECT count(*) FROM ops_user_roles WHERE scope_division_id IS NOT NULL')
    assert cur.fetchone()[0] == 0
    cur.execute('SELECT count(*) FROM ops_dictionary_entries WHERE owner_division_id IS NOT NULL')
    assert cur.fetchone()[0] == 0
    report = dict(database=name, preserved_tables=sorted(KEEP),
        users_preserved=after['auth_user'], auth_users_sha256=hashes['auth_user'],
        removed_scoped_grants=removed_scoped_grants, detached_dictionary_owners=detached_owners,
        before=before, after=after, empty_operational_tables=len(tables-KEEP),
        original_database_modified=False)
print(json.dumps(report, ensure_ascii=False, indent=2))
