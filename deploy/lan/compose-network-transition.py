"""Bounded, byte-preserving transition for the reviewed LAN Compose topology.

Docker Compose, not this module, interprets YAML and resolves server settings.
Only absent or plain inline target network lists are edited. The normalized
candidate must differ solely by adding ingress to backend and/or worker.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile


def expected_configuration(config):
    networks = config.get('networks', {})
    if set(networks) != {'default', 'ingress'}:
        raise RuntimeError('Network transition requires the reviewed default/ingress topology')
    for name in ('default', 'ingress'):
        network = networks[name]
        if (not isinstance(network, dict) or
                set(network) - {'name', 'driver', 'internal', 'external', 'labels', 'ipam'} or
                network.get('ipam') not in (None, {}) or
                network.get('driver', 'bridge') != 'bridge' or network.get('external', False) or
                network.get('internal', False) is not (name == 'default')):
            raise RuntimeError('Custom network topology requires review before updating: ' + name)
    if networks['default'].get('name') == networks['ingress'].get('name'):
        raise RuntimeError('Default and ingress must be separate existing networks')
    expected = copy.deepcopy(config)
    changed = []
    for name in ('backend', 'worker'):
        service = expected.get('services', {}).get(name, {})
        memberships = service.get('networks')
        if (service.get('network_mode') is not None or not isinstance(memberships, dict) or
                set(memberships) not in ({'default'}, {'default', 'ingress'})):
            raise RuntimeError('Custom service networks require review before updating: ' + name)
        if 'ingress' not in memberships:
            if memberships['default'] not in (None, {}):
                raise RuntimeError('Custom default network options require review: ' + name)
            memberships['ingress'] = None
            changed.append(name)
    return expected, changed


def patch_source(original, changed):
    if not changed:
        return original
    try:
        source = original.decode('utf-8-sig')
    except UnicodeDecodeError:
        raise RuntimeError('Compose must be UTF-8 for the reviewed network transition') from None
    lines = source.splitlines(keepends=True)
    if any(re.match(r'^[ \t]*\t', line) for line in lines):
        raise RuntimeError('Ambiguous Compose indentation requires review')
    roots = [i for i, line in enumerate(lines) if re.match(r'^services\s*:', line)]
    if len(roots) != 1 or not re.fullmatch(r'services:[ \t]*(?:#[^\r\n]*)?\r?\n', lines[roots[0]]):
        raise RuntimeError('Expected one plain services mapping in installed Compose')
    start = roots[0]
    end = next((i for i in range(start + 1, len(lines)) if re.match(r'^[^ \t\r\n#]', lines[i])), len(lines))
    edits = []
    for name in changed:
        matches = [i for i in range(start + 1, end) if re.match(r'^  ' + name + r'\s*:', lines[i])]
        if len(matches) != 1 or not re.fullmatch(r'  ' + name + r':[ \t]*(?:#[^\r\n]*)?\r?\n', lines[matches[0]]):
            raise RuntimeError('Expected one plain service mapping: ' + name)
        first = matches[0]
        last = next((i for i in range(first + 1, end) if re.match(r'^  [^ \t\r\n#]', lines[i])), end)
        direct = [i for i in range(first + 1, last)
                  if re.match(r'^    [\'\"]?networks[\'\"]?\s*:', lines[i])]
        if not direct:
            ending = '\r\n' if lines[first].endswith('\r\n') else '\n'
            edits.append((first + 1, first + 1, '    networks: [default, ingress]' + ending))
        elif len(direct) == 1:
            index = direct[0]
            match = re.fullmatch(r'(    networks:[ \t]*)\[[ \t]*default[ \t]*\]([ \t]*(?:#[^\r\n]*)?)(\r?\n)', lines[index])
            if match is None:
                raise RuntimeError('Custom or duplicate network syntax requires review: ' + name)
            edits.append((index, index + 1, match[1] + '[default, ingress]' + match[2] + match[3]))
        else:
            raise RuntimeError('Duplicate service networks require review: ' + name)
    for first, last, replacement in sorted(edits, reverse=True):
        lines[first:last] = [replacement]
    bom = b'\xef\xbb\xbf' if original.startswith(b'\xef\xbb\xbf') else b''
    return bom + ''.join(lines).encode('utf-8')


class NetworkTransition:
    def __init__(self, path, config, render):
        self.path = Path(path)
        self.metadata = self._metadata()
        self.original = self.path.read_bytes()
        self.config = copy.deepcopy(config)
        self.render = render
        self.expected, self.changed = expected_configuration(config)
        self.updated = patch_source(self.original, self.changed)
        self.applied = False
        if render(self.updated) != self.expected:
            raise RuntimeError('Network transition would change unrelated server settings; no services stopped')

    def _metadata(self):
        value = self.path.lstat()
        if not stat.S_ISREG(value.st_mode) or value.st_nlink != 1:
            raise RuntimeError('Compose must be one regular file, without symlinks or hardlinks')
        return stat.S_IMODE(value.st_mode), value.st_uid, value.st_gid

    def require_original(self):
        if self._metadata() != self.metadata or self.path.read_bytes() != self.original:
            raise RuntimeError('Installed Compose changed after preflight; review before updating')
        if self.render(self.original) != self.config:
            raise RuntimeError('Server settings changed after network preflight; review before continuing')

    def _replace(self, content):
        descriptor, name = tempfile.mkstemp(prefix='.sj-compose-network-', suffix='.tmp', dir=self.path.parent)
        temporary = Path(name)
        try:
            with os.fdopen(descriptor, 'wb') as stream:
                stream.write(content)
                stream.flush()
                mode, uid, gid = self.metadata
                if hasattr(os, 'fchown'):
                    os.fchown(stream.fileno(), uid, gid)
                if hasattr(os, 'fchmod'):
                    os.fchmod(stream.fileno(), mode)
                else:
                    temporary.chmod(mode)
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
        finally:
            temporary.unlink(missing_ok=True)

    def apply(self, folder):
        self.require_original()
        backup = Path(folder) / 'docker-compose.yml'
        if backup.is_symlink() or backup.read_bytes() != self.original:
            raise RuntimeError('Exact original Compose backup is required before network changes')
        report = Path(folder) / 'compose-network-transition.json'
        descriptor = os.open(report, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            json.dump({'changed_services': self.changed,
                'original_sha256': hashlib.sha256(self.original).hexdigest(),
                'updated_sha256': hashlib.sha256(self.updated).hexdigest(),
                'original_mode': oct(self.metadata[0]), 'original_uid': self.metadata[1],
                'original_gid': self.metadata[2]}, stream, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        if self.updated != self.original:
            # Set before replacement: even an interrupted write must enter the
            # rollback guard, which accepts only our original/proposed bytes.
            self.applied = True
            self._replace(self.updated)

    def rollback(self):
        if not self.applied:
            return
        content = self.path.read_bytes()
        if self._metadata() != self.metadata or content not in (self.original, self.updated):
            raise RuntimeError('Compose changed during maintenance; preserve backup and review recovery')
        if content != self.original:
            self._replace(self.original)
        self.applied = False
