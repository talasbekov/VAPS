"""Export organizational links from one Docker Compose PostgreSQL in a read-only transaction."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import sys

SQL = """BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL client_encoding='UTF8';
SELECT json_build_object('postgres_version',current_setting('server_version'),
  'divisions',coalesce(json_agg(row_to_json(d) ORDER BY tree_id,lft),'[]'::json))
FROM (SELECT id,name,code,division_type,parent_id,tree_id,level,lft,rght,is_active
      FROM divisions) d;
COMMIT;
"""


def analyze(rows):
    by_id = {row['id']: row for row in rows}
    findings, divisions = [], []
    for row in rows:
        chain, seen, current = [], set(), row
        while current is not None:
            if current['id'] in seen:
                findings.append({'kind': 'parent_cycle', 'division_id': row['id']})
                break
            seen.add(current['id'])
            chain.insert(0, {'id': current['id'], 'name': current['name']})
            parent_id = current['parent_id']
            if parent_id is not None and parent_id not in by_id:
                findings.append({'kind': 'missing_parent', 'division_id': row['id'], 'parent_id': parent_id})
                break
            current = by_id.get(parent_id)
        parent = by_id.get(row['parent_id'])
        if parent is not None:
            if parent['tree_id'] != row['tree_id'] or not (parent['lft'] < row['lft'] < row['rght'] < parent['rght']):
                findings.append({'kind': 'mptt_parent_interval_mismatch', 'division_id': row['id'], 'parent_id': parent['id']})
            if row['level'] != parent['level'] + 1:
                findings.append({'kind': 'mptt_level_mismatch', 'division_id': row['id'], 'parent_id': parent['id']})
        elif row['parent_id'] is None and row['level'] != 0:
            findings.append({'kind': 'mptt_root_level_mismatch', 'division_id': row['id']})
        divisions.append(dict(row, path=chain))
    return {
        'division_count': len(rows),
        'roots': [{'id': row['id'], 'name': row['name'], 'division_type': row['division_type']}
                  for row in rows if row['parent_id'] is None],
        'counts_by_type': dict(Counter(row['division_type'] for row in rows)),
        'findings': findings,
        'divisions': divisions,
    }


def docker_output(arguments, **kwargs):
    result = subprocess.run(['docker', *arguments], check=True, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, encoding='utf-8', timeout=30, **kwargs)
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser(description='Read-only report of division parents/types/MPTT; no employee data.')
    parser.add_argument('--stack', default='smart-josparlau-lan', help='Existing Docker Compose project name')
    parser.add_argument('--output', type=Path, help='New JSON file; existing files are never overwritten')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,62}', args.stack):
        parser.error('Invalid Compose project name')
    target = args.output or Path('org-structure-' + datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S') + '.json')
    if target.exists():
        parser.error('Output file already exists; choose a new file name')
    ids = docker_output(['ps', '-q', '--no-trunc', '--filter', 'label=com.docker.compose.project=' + args.stack,
                         '--filter', 'label=com.docker.compose.service=db']).splitlines()
    if len(ids) != 1:
        raise RuntimeError('Expected exactly one running db service for the selected stack; found ' + str(len(ids)))
    labels = json.loads(docker_output(['inspect', '--format', '{{json .Config.Labels}}', ids[0]]))
    if labels.get('com.docker.compose.project') != args.stack or labels.get('com.docker.compose.service') != 'db':
        raise RuntimeError('Database container identity changed')
    raw = json.loads(docker_output(['exec', '-i', ids[0], 'sh', '-c',
        'exec psql -U "$POSTGRES_USER" -d "${POSTGRES_DB:-$POSTGRES_USER}" -X -qAt -v ON_ERROR_STOP=1 -f -'], input=SQL))
    report = analyze(raw['divisions'])
    report.update(schema_version=1, generated_at=datetime.now(timezone.utc).isoformat(),
                  stack=args.stack, postgres_version=raw['postgres_version'], read_only_transaction=True)
    with target.open('x', encoding='utf-8') as output:
        json.dump(report, output, ensure_ascii=False, indent=2)
        output.write('\n')
    print('Report: ' + str(target.resolve()))
    print('Divisions: {}; roots: {}; integrity findings: {}'.format(report['division_count'], len(report['roots']), len(report['findings'])))
    print('No database changes made.')


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.SubprocessError) as error:
        print('ERROR: ' + str(error), file=sys.stderr)
        sys.exit(1)
