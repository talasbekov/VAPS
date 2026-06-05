import ast
import argparse
import os
from collections import defaultdict
from pathlib import Path

TARGETS = [
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
]

# Patterns we want to find in the AST
PATTERNS = [
    'role_info',
    'get_user_division',
    'get_descendants',
    'check_permission',
    'SYSTEM_ADMIN',
    'DIRECTORATE_HEAD',
    'ROLE_4',
    'is_admin',
    'is_hr_admin',
    'is_manager',
    'is_observer',
    'has_permission',
    'has_object_permission'
]

def analyze_permissions(base_dir):
    findings = defaultdict(list)

    class PermVisitor(ast.NodeVisitor):
        def __init__(self, filename):
            self.filename = filename

        def visit_Attribute(self, node):
            if node.attr in PATTERNS:
                findings[self.filename].append({
                    "line": node.lineno,
                    "pattern": node.attr,
                    "type": "Attribute"
                })
            self.generic_visit(node)

        def visit_Name(self, node):
            if node.id in PATTERNS:
                findings[self.filename].append({
                    "line": node.lineno,
                    "pattern": node.id,
                    "type": "Name/Call"
                })
            self.generic_visit(node)

        def visit_Constant(self, node):
            if isinstance(node.value, str) and node.value in PATTERNS:
                findings[self.filename].append({
                    "line": node.lineno,
                    "pattern": node.value,
                    "type": "Constant"
                })
            self.generic_visit(node)

    apps_dir = Path(base_dir) / 'organization_management' / 'apps'
    for app in TARGETS:
        app_dir = apps_dir / app
        if not app_dir.exists():
            continue

        for root, _, files in os.walk(app_dir):
            for file in files:
                if not file.endswith('.py') or 'tests' in root:
                    continue

                file_path = Path(root) / file
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        tree = ast.parse(f.read(), filename=str(file_path))
                        visitor = PermVisitor(str(file_path.relative_to(base_dir)))
                        visitor.visit(tree)
                except Exception as e:
                    print(f"Failed to parse {file_path}: {e}")

    return findings

def main():
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    deps = analyze_permissions(base_dir)

    if not deps:
        print("No permission usage found.")
        return

    for file, file_findings in sorted(deps.items()):
        print(f"\nFile: {file}")
        print("-" * 40)

        # Group by pattern
        pattern_counts = defaultdict(int)
        lines_by_pattern = defaultdict(list)

        for f in file_findings:
            p = f['pattern']
            pattern_counts[p] += 1
            lines_by_pattern[p].append(f['line'])

        for p, count in pattern_counts.items():
            lines = ", ".join(map(str, sorted(set(lines_by_pattern[p]))))
            print(f"   - {p}: {count} occurrences (Lines: {lines})")

if __name__ == '__main__':
    main()
