#!/usr/bin/env python3
"""Online preparation only; never invoked by the offline installer."""
import hashlib
import json
from pathlib import Path
import sys
import urllib.request

folder = Path(sys.argv[1]) if len(sys.argv)>1 else Path.home()/'.cache/smart-josparlau/lan-wheelhouse'
lock = json.loads((Path(__file__).parent/'ui-assets.lock.json').read_text())
folder.mkdir(parents=True,exist_ok=True)
target = folder/lock['filename']
if target.exists():
    data=target.read_bytes()
else:
    data=urllib.request.urlopen(lock['url'],timeout=60).read()
if hashlib.sha256(data).hexdigest()!=lock['sha256']:
    raise SystemExit('UI assets checksum mismatch')
target.write_bytes(data)
print('Prepared verified offline Swagger/Redoc assets:',target)
