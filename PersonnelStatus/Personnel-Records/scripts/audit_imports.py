import ast
import argparse
import json
import os
from collections import defaultdict
from pathlib import Path

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

def analyze_imports(base_dir):
    dependencies = defaultdict(set)

    apps_dir = Path(base_dir)
    if not apps_dir.exists():
        print(f"Directory not found: {apps_dir}")
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
                except Exception as e:
                    print(f"Failed to parse {file_path}: {e}")
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
                            elif node.level and node.level > 0:
                                # Relative imports. Not expected to cross apps normally, but could check.
                                pass

    # Convert sets to sorted lists for deterministic output
    return {k: sorted(list(v)) for k, v in dependencies.items()}

def main():
    parser = argparse.ArgumentParser(description="Audit cross-app imports.")
    parser.add_argument('--json', action='store_true', help="Output in JSON format")
    args = parser.parse_args()

    base_dir = os.path.join(os.path.dirname(__file__), '..', 'organization_management', 'apps')
    base_dir = os.path.abspath(base_dir)

    deps = analyze_imports(base_dir)

    if args.json:
        print(json.dumps(deps, indent=4))
    else:
        if not deps:
            print("No cross-app dependencies found.")
            return

        for app, targets in sorted(deps.items()):
            for target in targets:
                print(f"{app} -> {target}")

if __name__ == '__main__':
    main()
