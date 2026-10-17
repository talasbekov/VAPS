#!/usr/bin/env python3
"""Copy only tracked application source; never copy a developer's environment."""
import shutil
import subprocess
import sys
from pathlib import Path

root, dest = map(Path, sys.argv[1:])
layouts = (
    ('PersonnelStatus/Personnel-Records/', 'PersonnelStatus/PersonalRecordFront/'),
    ('Backend/PersonnelStatus/Personnel-Records/', 'Backend/PersonnelStatus/PersonalRecordFront/'),
    ('backend/', 'frontend/'),
)
layout = next((pair for pair in layouts if all((root / path).is_dir() for path in pair)), None)
if layout is None:
    raise SystemExit('Cannot find backend/frontend source directories')
prefixes = {layout[0]: 'backend', layout[1]: 'frontend', 'deploy/contour/': 'deploy/contour'}
excluded_dirs = {
    'node_modules', '.venv', 'venv', '.git', '__pycache__', 'media',
    'private_storage', 'staticfiles', 'logs', 'e2e', 'tests', '__tests__',
    'playwright-report', 'test-results', '.vercel', '.cache', 'docs',
}
names = subprocess.check_output(
    ['git', '-C', str(root), 'ls-files', '-z', '--', *prefixes],
).decode('utf-8').split('\0')
count = 0
for name in filter(None, names):
    prefix = next(p for p in prefixes if name.startswith(p))
    relative = Path(name[len(prefix):])
    if any(p in excluded_dirs or p.startswith('.next') for p in relative.parts):
        continue
    base = relative.name
    if (base.startswith('.env') or base.startswith('docker-compose')
            or base == 'Dockerfile' or base.endswith(('.log', '.sqlite3', '.db', '.sql', '.dump', '.tar', '.tar.gz', '.tsbuildinfo'))):
        continue
    source = root / name
    if source.is_symlink():
        raise SystemExit(f'Refusing tracked symlink: {name}')
    target = dest / prefixes[prefix] / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    count += 1
# Deployment files are an explicit allowlist, including tracked .env.example.
deploy = dest / 'deploy/contour'
deploy.mkdir(parents=True, exist_ok=True)
for name in (
    'build-bundle.sh', 'install.sh', 'snapshot.py', 'docker-compose.yml', '.env.example',
    'Dockerfile.python-deps', 'Dockerfile.node-deps', 'Dockerfile.backend',
    'Dockerfile.frontend', 'Dockerfile.proxy', 'Dockerfile.runtime-base', 'entrypoint.sh', 'nginx.conf', 'README.md',
    'proxy-entrypoint.sh', 'nginx-error-filter.awk',
):
    shutil.copy2(root / 'deploy/contour' / name, deploy / name)
print(f'Snapshot: {count} tracked application/deployment files; no local environment')
