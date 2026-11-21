"""Fixture regressions only; native acceptance still uses the real manager."""
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from service import services


class ServiceTests(unittest.TestCase):
    def test_native_lifecycles_use_configuration_the_real_installer_accepts(self):
        for platform in ('Linux', 'Darwin'):
            with self.subTest(platform=platform), tempfile.TemporaryDirectory(prefix='walk-service-') as directory:
                root = Path(directory)
                candidate, baseline = root / 'candidate', root / 'baseline'
                config = root / '.config/herdr-world/herdr-world.env'
                definition = root / ('.config/systemd/user/herdr-world.service' if platform == 'Linux'
                                     else 'Library/LaunchAgents/dev.herdr-world.plist')
                installed = []
                walk = MagicMock()
                def command(argv, env, check=True):
                    if argv[0] in (candidate, baseline):
                        if argv[2] == 'install':
                            # Exercise the actual installer boundary without
                            # invoking a manager or starting a World server.
                            result = subprocess.run(['bun', '-e', '''
                                import {readFileSync} from 'node:fs';
                                import {prepareServiceAccess} from './server/src/config/service-manager';
                                const [path, platform, home] = process.argv.slice(1);
                                const access = prepareServiceAccess(path, readFileSync(path, 'utf8'), platform, home);
                                console.log(JSON.stringify({host: access.host, port: access.port}));
                            ''', str(config), 'systemd' if platform == 'Linux' else 'launchd', str(root)],
                                capture_output=True, text=True)
                            self.assertEqual(result.returncode, 0, 'service fixture rejected by prepareServiceAccess')
                            access = json.loads(result.stdout)
                            self.assertEqual(access['host'], '127.0.0.1')
                            self.assertGreater(access['port'], 0)
                            self.assertNotIn(access['port'], (8787, 8788))
                            installed.append(argv[0])
                            definition.parent.mkdir(parents=True, exist_ok=True)
                            definition.write_text('synthetic native definition')
                        elif argv[2] == 'uninstall':
                            definition.unlink(missing_ok=True)
                        else:
                            self.fail('unexpected service action')
                        return SimpleNamespace(returncode=0)
                    if argv[0] == 'systemctl' and 'show' in argv:
                        return SimpleNamespace(stdout='not-found\n', returncode=0)
                    return SimpleNamespace(returncode=0 if definition.exists() else 113)
                with patch('service.Path.home', return_value=root), patch('service.platform.system', return_value=platform), \
                        patch('service.run', side_effect=command), patch('service.service_guard') as guard:
                    services(walk, candidate, baseline, root, True)
                guard.assert_called_once_with(root, True)
                self.assertEqual(installed, [candidate, baseline])
                self.assertEqual([call.args[0] for call in walk.journey.call_args_list],
                                 ['Service install and uninstall', 'Previous release service uninstall'])
                self.assertFalse(config.exists())
                self.assertFalse(definition.exists())


if __name__ == '__main__':
    unittest.main()
