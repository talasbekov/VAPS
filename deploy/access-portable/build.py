"""Bundle host runner and Django payload into one offline bash script."""
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def build(output):
    source = (ROOT/'access_transfer.py').read_text(encoding='utf-8')
    runner = (ROOT/'run.py').read_text(encoding='utf-8')
    runner = runner.replace('HERE = Path(__file__).resolve().parent', 'HERE = Path(sys.argv.pop(1)).resolve().parent')
    runner = runner.replace("SOURCE = (HERE / 'access_transfer.py').read_text(encoding='utf-8')", 'SOURCE = '+repr(source))
    output.write_text('#!/usr/bin/env bash\nset -euo pipefail\npython3 - "$0" "$@" <<\'PY_ACCESS_1193\'\n'+runner+'\nPY_ACCESS_1193\n', encoding='utf-8')
    output.chmod(0o700)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    build(parser.parse_args().output)
