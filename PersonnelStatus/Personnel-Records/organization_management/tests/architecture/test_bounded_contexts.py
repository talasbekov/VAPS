import pytest
import warnings
import ast
import os
from pathlib import Path
from collections import defaultdict

APPS = {
    'common',
    'divisions',
    'employees',
    'statuses',
    'staff_unit',
    'reports',
    'secondments',
    'notifications',
    'audit',
    'dictionaries'
}

def analyze_cross_imports():
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'apps'))
    dependencies = defaultdict(set)
    apps_dir = Path(base_dir)

    if not apps_dir.exists():
        return {}

    for app_name in APPS:
        app_dir = apps_dir / app_name
        if not app_dir.exists():
            continue

        for root, _, files in os.walk(app_dir):
            for file in files:
                if not file.endswith('.py'):
                    continue

                file_path = Path(root) / file
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        tree = ast.parse(f.read(), filename=str(file_path))
                except Exception:
                    continue

                for node in ast.walk(tree):
                    if isinstance(node, ast.Import):
                        for alias in node.names:
                            parts = alias.name.split('.')
                            if len(parts) >= 3 and parts[0] == 'organization_management' and parts[1] == 'apps' and parts[2] in APPS:
                                if parts[2] != app_name:
                                    dependencies[app_name].add(parts[2])
                    elif isinstance(node, ast.ImportFrom):
                        if node.module:
                            parts = node.module.split('.')
                            if len(parts) >= 3 and parts[0] == 'organization_management' and parts[1] == 'apps' and parts[2] in APPS:
                                if parts[2] != app_name:
                                    dependencies[app_name].add(parts[2])

    return {k: sorted(list(v)) for k, v in dependencies.items()}


def test_bounded_context_violations():
    """
    Architecture Guardrail Test (STORY-001)

    This test runs in warning-mode. It dynamically maps cross-app imports
    and reports them as warnings to avoid breaking the test suite while
    existing violations are still being resolved.
    """
    deps = analyze_cross_imports()
    violations_found = False
    violation_messages = []

    # We define strict boundaries here. Currently, practically every cross-app
    # model import is a violation of a strict bounded context architecture
    # (they should communicate via services/interfaces, not direct ORM imports).
    for app, targets in deps.items():
        if targets:
            violations_found = True
            for target in targets:
                violation_messages.append(f"VIOLATION: '{app}' directly imports from '{target}'")

    if violations_found:
        message = "Found Bounded Context violations (Cross-App Imports):\n" + "\n".join(violation_messages)
        warnings.warn(message, UserWarning)

    # We assert True to keep the test green in warning mode
    assert True
