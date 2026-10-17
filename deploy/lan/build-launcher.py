"""Build the small, self-contained launcher from reviewed repository files."""
import base64
import hashlib
import json
from pathlib import Path
import sys
import zlib

folder = Path(__file__).resolve().parent
source = folder.parent.parent
backend = next((source / path for path in (
    'backend', 'PersonnelStatus/Personnel-Records',
    'Backend/PersonnelStatus/Personnel-Records',
) if (source / path / 'organization_management/apps').is_dir()), None)
if backend is None:
    raise SystemExit('Cannot find backend source directories')
paths = [
    'employees/models.py', 'employees/migrations/0005_employee_import_identity.py',
    'staff_unit/models.py', 'staff_unit/migrations/0002_staffunit_import_fields.py',
    'core/api/service_employees.py', 'statuses/services.py', 'statuses/models.py',
]
compat = json.dumps({name: (backend / 'organization_management/apps' / name).read_text(encoding='utf-8')
                     for name in paths}, ensure_ascii=False).encode('utf-8')
updater = (folder / 'update-offline.py').read_bytes()
launcher = (folder / 'launch-offline.py').read_text(encoding='utf-8')
for name, data in [('UPDATER', updater), ('COMPAT', compat)]:
    launcher = launcher.replace('__' + name + '_DATA__', base64.b64encode(zlib.compress(data, 9)).decode())
    launcher = launcher.replace('__' + name + '_SHA256__', hashlib.sha256(data).hexdigest())
Path(sys.argv[1]).write_bytes(launcher.encode('utf-8'))
(folder / 'compat-files.json').write_bytes(compat)
print('Launcher written:', sys.argv[1])
