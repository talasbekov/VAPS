"""Check a roster with packaged parser, before installing code or migrations."""

import importlib.util
import sys
from pathlib import Path

import django

sys.path.insert(0, "/app")
django.setup()
root = Path(__file__).parent / "files"
modules = [
    "organization_management.apps.staff_unit.roster_xlsx",
    "organization_management.apps.staff_unit.roster_import",
    "organization_management.apps.staff_unit.management.commands.import_staffing_xlsx",
]
for name in modules:
    spec = importlib.util.spec_from_file_location(
        name, root / (name.replace(".", "/") + ".py")
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
command = sys.modules[modules[-1]].Command()
command.run_from_argv(
    ["manage.py", "import_staffing_xlsx", *sys.argv[1:], "--check-file"]
)
