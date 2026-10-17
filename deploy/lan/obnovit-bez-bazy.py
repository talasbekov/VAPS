#!/usr/bin/env python3
"""One-command application update; keep this script beside the extracted package."""
from pathlib import Path
import runpy

if __name__ == '__main__':
    runpy.run_path(str(Path(__file__).resolve().with_name('update.py')), run_name='__main__')
