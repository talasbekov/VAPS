#!/usr/bin/env python3
"""Generate configuration without printing or replacing existing secrets."""
import argparse
import ipaddress
import os
from pathlib import Path
import secrets

parser = argparse.ArgumentParser()
parser.add_argument('--ip', default='10.15.3.187')
parser.add_argument('--frontend-port', type=int, default=3300)
parser.add_argument('--backend-port', type=int, default=8300)
parser.add_argument('--postgres-port', type=int, default=5300)
parser.add_argument('--name', default='smart-josparlau-lan')
args = parser.parse_args()
ipaddress.IPv4Address(args.ip)
ports = [args.frontend_port, args.backend_port, args.postgres_port]
if len(set(ports)) != 3 or any(not 1024 <= port <= 65535 for port in ports):
    parser.error('Use three different ports between 1024 and 65535')
import re
if not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', args.name):
    parser.error('Invalid stack name')
folder = Path(__file__).resolve().parent
text = (folder / '.env.example').read_text()
front = f'http://{args.ip}:{args.frontend_port}'
back = f'http://{args.ip}:{args.backend_port}'
values = dict(STACK_NAME=args.name, BIND_IP=args.ip, FRONTEND_PORT=args.frontend_port,
              BACKEND_PORT=args.backend_port, POSTGRES_PORT=args.postgres_port,
              NEXTAUTH_URL=front, ALLOWED_HOSTS=f'{args.ip},backend,localhost,127.0.0.1',
              CORS_ALLOWED_ORIGINS=f'{front},{back}', CSRF_TRUSTED_ORIGINS=f'{front},{back}',
              **{key: secrets.token_hex(32) for key in ('POSTGRES_PASSWORD', 'DJANGO_SECRET_KEY', 'NEXTAUTH_SECRET')})
for key, value in values.items():
    text = re.sub(rf'^{key}=.*$', f'{key}={value}', text, flags=re.M)
fd = os.open(folder / '.env', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as stream:
    stream.write(text)
print('Created private .env; secrets not displayed. Portal:', front)
