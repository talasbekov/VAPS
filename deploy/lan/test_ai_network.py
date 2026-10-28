"""Resolve the real LAN Compose without starting containers or reading server env."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest


class AiNetworkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which('docker'):
            raise unittest.SkipTest('Docker Compose CLI required; no daemon is used')
        version = subprocess.run(['docker', 'compose', 'version'], capture_output=True)
        if version.returncode:
            raise unittest.SkipTest('Docker Compose CLI required; no daemon is used')
        compose = Path(__file__).with_name('docker-compose.yml').resolve()
        variables = set(re.findall(r'\$\{([A-Z_]+)', compose.read_text(encoding='utf-8')))
        env = {key: value for key, value in os.environ.items()
               if key not in variables and not key.startswith('COMPOSE_')}
        env.update({
            'STACK_NAME': 'ai-network-test',
            'DJANGO_SECRET_KEY': 'test-only', 'NEXTAUTH_SECRET': 'test-only',
            'POSTGRES_PASSWORD': 'test-only',
            'DJANGO_SECRET_KEY_FALLBACKS': 'previous-test-secret',
            'OPS_ASSISTANT_CREDENTIAL_KEYS': 'test-key-one,test-key-two',
            'ALLOWED_HOSTS': 'localhost',
            'CORS_ALLOWED_ORIGINS': 'http://localhost',
            'CSRF_TRUSTED_ORIGINS': 'http://localhost',
            'NEXTAUTH_URL': 'http://localhost', 'BIND_IP': '127.0.0.1',
            **{name + '_IMAGE': 'test/' + name.lower() + ':local'
               for name in ('BACKEND', 'FRONTEND', 'PROXY', 'POSTGRES', 'REDIS')},
        })
        with tempfile.TemporaryDirectory() as directory:
            empty_env = Path(directory) / 'empty.env'
            empty_env.write_text('', encoding='utf-8')
            result = subprocess.run(
                ['docker', 'compose', '--project-directory', directory,
                 '--env-file', str(empty_env), '-f', str(compose),
                 'config', '--format', 'json'],
                env=env, capture_output=True, text=True, encoding='utf-8', check=True,
            )
        cls.config = json.loads(result.stdout)

    def test_api_and_worker_have_a_route_to_the_lan_model(self):
        networks = self.config['networks']
        for name in ('backend', 'worker'):
            with self.subTest(service=name):
                attached = self.config['services'][name]['networks']
                self.assertIn('default', attached, 'Database and Redis must remain reachable')
                self.assertTrue(
                    any(not networks[network].get('internal', False) for network in attached),
                    name + ' cannot reach the model through internal-only networks',
                )

    def test_internal_services_remain_isolated(self):
        self.assertTrue(self.config['networks']['default']['internal'])
        for name in ('redis', 'frontend'):
            with self.subTest(service=name):
                self.assertEqual(set(self.config['services'][name]['networks']), {'default'})

    def test_model_egress_does_not_publish_application_ports(self):
        for name in ('backend', 'worker', 'redis', 'frontend'):
            with self.subTest(service=name):
                self.assertFalse(self.config['services'][name].get('ports'))

    def test_api_and_worker_share_configured_credential_rotation_keys(self):
        for name in ('backend', 'worker'):
            with self.subTest(service=name):
                environment = self.config['services'][name]['environment']
                self.assertEqual(environment['DJANGO_SECRET_KEY_FALLBACKS'], 'previous-test-secret')
                self.assertEqual(environment['OPS_ASSISTANT_CREDENTIAL_KEYS'], 'test-key-one,test-key-two')
        self.assertNotIn('OPS_ASSISTANT_CREDENTIAL_KEYS', self.config['services']['frontend']['environment'])


if __name__ == '__main__':
    unittest.main()
