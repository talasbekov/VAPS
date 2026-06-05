import ast
import os
import sys
from collections import defaultdict

APPS_DIR = "Backend/PersonnelStatus/Personnel-Records/organization_management/apps"
TARGET_APPS = {
    "common", "divisions", "employees", "statuses",
    "staff_unit", "reports", "secondments", "notifications",
    "audit", "dictionaries"
}

def analyze_file(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        try:
            tree = ast.parse(f.read(), filename=filepath)
        except SyntaxError:
            return []

    dependencies = set()

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                parts = alias.name.split('.')
                if parts[0] == "organization_management" and len(parts) > 2 and parts[1] == "apps":
                     app_name = parts[2]
                     if app_name in TARGET_APPS:
                         dependencies.add(app_name)
                elif parts[0] == "apps" and len(parts) > 1:
                    app_name = parts[1]
                    if app_name in TARGET_APPS:
                        dependencies.add(app_name)
                elif parts[0] in TARGET_APPS:
                    dependencies.add(parts[0])

        elif isinstance(node, ast.ImportFrom):
            if node.module:
                parts = node.module.split('.')
                if parts[0] == "organization_management" and len(parts) > 2 and parts[1] == "apps":
                     app_name = parts[2]
                     if app_name in TARGET_APPS:
                         dependencies.add(app_name)
                elif parts[0] == "apps" and len(parts) > 1:
                    app_name = parts[1]
                    if app_name in TARGET_APPS:
                        dependencies.add(app_name)
                elif parts[0] in TARGET_APPS:
                    dependencies.add(parts[0])

    return list(dependencies)

def get_app_name(filepath):
    rel_path = os.path.relpath(filepath, APPS_DIR)
    parts = rel_path.split(os.sep)
    if len(parts) > 0 and parts[0] in TARGET_APPS:
        return parts[0]
    return None

def main():
    if not os.path.exists(APPS_DIR):
        print(f"Error: Could not find directory {APPS_DIR}")
        sys.exit(1)

    app_dependencies = defaultdict(set)

    for root, _, files in os.walk(APPS_DIR):
        for file in files:
            if file.endswith(".py"):
                filepath = os.path.join(root, file)
                app_name = get_app_name(filepath)
                if not app_name:
                    continue

                deps = analyze_file(filepath)
                for dep in deps:
                    if dep != app_name:
                        app_dependencies[app_name].add(dep)

    print("--- App Dependencies ---")
    for app in sorted(TARGET_APPS):
        deps = sorted(list(app_dependencies.get(app, [])))
        if deps:
            for dep in deps:
                print(f"{app} -> {dep}")
        else:
             print(f"{app} -> (no internal dependencies)")

if __name__ == "__main__":
    main()
