import ast
import argparse
import json
import os
from collections import defaultdict
from pathlib import Path

# Target files and directories to scan
TARGETS = [
    'organization_management/apps/reports/utils.py',
    'organization_management/apps/reports/infrastructure/data_aggregator.py',
    'organization_management/apps/reports/api/views.py',
    'organization_management/apps/reports/tasks.py',
]

def analyze_queries(base_dir):
    findings = defaultdict(list)

    class QueryVisitor(ast.NodeVisitor):
        def __init__(self, filename):
            self.filename = filename
            self.loop_depth = 0
            self.in_loop = False

        def visit_For(self, node):
            self.loop_depth += 1
            self.in_loop = True
            self.generic_visit(node)
            self.loop_depth -= 1
            if self.loop_depth == 0:
                self.in_loop = False

        def visit_While(self, node):
            self.loop_depth += 1
            self.in_loop = True
            self.generic_visit(node)
            self.loop_depth -= 1
            if self.loop_depth == 0:
                self.in_loop = False

        def visit_Call(self, node):
            if isinstance(node.func, ast.Attribute):
                method_name = node.func.attr
                if method_name in ['filter', 'count', 'exists', 'get_descendants', 'aggregate', 'annotate', 'all']:
                    if self.in_loop:
                        finding = {
                            "file": self.filename,
                            "line": node.lineno,
                            "method": method_name,
                            "context": "inside loop"
                        }
                        findings[self.filename].append(finding)
                    else:
                        finding = {
                            "file": self.filename,
                            "line": node.lineno,
                            "method": method_name,
                            "context": "outside loop"
                        }
                        findings[self.filename].append(finding)
            self.generic_visit(node)


    for target in TARGETS:
        file_path = Path(base_dir) / target
        if not file_path.exists():
            print(f"Warning: {file_path} not found.")
            continue

        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                tree = ast.parse(f.read(), filename=str(file_path))
                visitor = QueryVisitor(target)
                visitor.visit(tree)
        except Exception as e:
            print(f"Failed to parse {file_path}: {e}")

    return findings

def main():
    parser = argparse.ArgumentParser(description="Audit query performance in reports.")
    parser.add_argument('--json', action='store_true', help="Output in JSON format")
    args = parser.parse_args()

    base_dir = os.path.join(os.path.dirname(__file__), '..')
    base_dir = os.path.abspath(base_dir)

    deps = analyze_queries(base_dir)

    if args.json:
        print(json.dumps(deps, indent=4))
    else:
        if not deps:
            print("No query hotspots found.")
            return

        for file, file_findings in sorted(deps.items()):
            print(f"\nFile: {file}")
            print("-" * 40)
            in_loop = [f for f in file_findings if f['context'] == 'inside loop']
            out_loop = [f for f in file_findings if f['context'] == 'outside loop']

            if in_loop:
                print("⚠️ HIGH RISK: Queries inside loops:")
                for f in in_loop:
                    print(f"   - Line {f['line']}: .{f['method']}()")

            if out_loop:
                print("Info: Queries outside loops:")
                counts = defaultdict(int)
                for f in out_loop:
                    counts[f['method']] += 1
                for method, count in counts.items():
                    print(f"   - .{method}(): {count} calls")

if __name__ == '__main__':
    main()
