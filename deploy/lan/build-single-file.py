#!/usr/bin/env python3
"""Wrap an accepted offline ZIP without changing any payload bytes."""
import argparse
import hashlib
from pathlib import Path
import shutil


def build(archive, output):
    digest = hashlib.sha256()
    with archive.open('rb') as source:
        for block in iter(lambda: source.read(4 * 1024 * 1024), b''):
            digest.update(block)
    runtime = Path(__file__).with_name('single-file-runtime.py').read_text(encoding='utf-8')
    header = ('#!/bin/sh\nset -eu\numask 077\n'
              'command -v python3 >/dev/null 2>&1 || { echo "Python 3.9+ required" >&2; exit 1; }\n'
              'python3 - "$0" "$@" <<\'SMART_UPDATE_PYTHON\'\n'
              f'PAYLOAD_BYTES = {archive.stat().st_size}\n'
              f'PAYLOAD_SHA256 = {digest.hexdigest()!r}\n'
              + runtime + '\nSMART_UPDATE_PYTHON\nexit $?\n')
    with output.open('xb') as target, archive.open('rb') as source:
        target.write(header.replace('\r\n', '\n').encode('utf-8'))
        shutil.copyfileobj(source, target, 4 * 1024 * 1024)
    output.chmod(0o700)
    print('Single-file Linux update: ' + str(output))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    build(args.archive, args.output)
