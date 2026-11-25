"""Disposable native channel acceptance. Uses the exact candidate archives/formula."""
import functools
import http.cookiejar
import http.server
import json
import os
from pathlib import Path
import platform
import socket
import sys
import tempfile
import threading
import urllib.request
import time

sys.path.insert(0, str(Path(__file__).parent / 'release-walk'))
from processes import run
from world import PASSWORD
from service import service_guard, launchd_exit_watch


def health(base, version):
    # The manager starts asynchronously. Retry readiness within a hard deadline;
    # require the served build identity, not the new on-disk binary's version.
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        try:
            jar = http.cookiejar.CookieJar()
            client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
            login = urllib.request.Request(base + '/api/login', data=json.dumps({'password': PASSWORD}).encode(), headers={'Content-Type': 'application/json', 'Origin': base})
            with client.open(login, timeout=2) as response: assert response.status == 200
            with client.open(base + '/api/health', timeout=2) as response:
                if json.load(response).get('version') == version: return
        except (OSError, ValueError):
            pass
        threading.Event().wait(.2)
    raise AssertionError('running service did not answer on version ' + version)


def uninstall(world, env, linux):
    if linux:
        run([world, 'service', 'uninstall'], env)
    else:
        printed = run(['launchctl', 'print', f'gui/{os.getuid()}/dev.herdr-world'], env).stdout
        with launchd_exit_watch(printed) as stopped:
            run([world, 'service', 'uninstall'], env)
            stopped()


def main(version, baseline):
    assert '--disposable-host' in sys.argv, 'requires a disposable native runner'
    home = Path.home()
    service_guard(home, True)
    linux = platform.system() == 'Linux'
    config = home / '.config/herdr-world/herdr-world.env'
    definition = (home / '.config/systemd/user/herdr-world.service' if linux
                  else home / 'Library/LaunchAgents/dev.herdr-world.plist')
    target = ('linux' if linux else 'darwin') + '-' + ('arm64' if platform.machine() in ('arm64', 'aarch64') else 'x64')
    source = Path.cwd()
    env = {key: value for key, value in os.environ.items() if not key.startswith(('HERDR_', 'HC_'))}
    env.update(HERDR_WORLD_SKIP_HERDR='1', HERDR_WORLD_SKIP_INTEGRATIONS='1', OPEN_BROWSER='0', HOMEBREW_NO_AUTO_UPDATE='1', HOMEBREW_NO_INSTALL_CLEANUP='1')
    config.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='channel-upgrade-') as temporary:
        root = Path(temporary)
        state = root / 'data'
        state.mkdir(mode=0o700)
        marker = state / 'release-upgrade-sentinel'
        marker.write_text('preserve user data')
        settings = state / 'settings.json'
        settings.write_text(json.dumps(dict(version=1, title_suffix='Channel upgrade fixture', repositories={}, workspace_auto_sync={}, custom={'channelUpgrade': True})))
        settings.chmod(0o600)
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        assert port not in (8787, 8788)
        base = f'http://127.0.0.1:{port}'
        config.write_text(f'HOST=127.0.0.1\nPORT={port}\nOPEN_BROWSER=0\nHERDR_WORLD_PASSWORD={PASSWORD}\nHERDR_WORLD_DATA_DIR={state}\nHERDR_WORLD_SKIP_HERDR=1\nHERDR_SOCKET_PATH={root / "absent-control.sock"}\nHERDR_CLIENT_SOCKET_PATH={root / "absent-render.sock"}\n')
        config.chmod(0o600)
        # Serve candidate bytes to the production installer. Only transport changes.
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(source / 'dist')))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        installed = None
        try:
            install_dir = root / 'bin'
            world = install_dir / 'herdr-world'
            installer_env = {**env, 'HERDR_WORLD_INSTALL_DIR': str(install_dir), 'HERDR_WORLD_VERSION': version,
                             'HERDR_WORLD_RELEASE_BASE_URL': f'http://127.0.0.1:{server.server_port}'}
            run(['sh', source / 'scripts/install-herdr-world.sh'], installer_env, timeout=300)
            installed = world
            run([world, 'service', 'install'], env)
            health(base, version)
            uninstall(world, env, linux)
            world.unlink()
            installer_env.pop('HERDR_WORLD_RELEASE_BASE_URL')
            installer_env['HERDR_WORLD_VERSION'] = baseline.removeprefix('v')
            run(['sh', source / 'scripts/install-herdr-world.sh'], installer_env, timeout=300)
            run([world, 'service', 'install'], env)
            health(base, baseline.removeprefix('v'))
            installer_env.update(HERDR_WORLD_VERSION=version, HERDR_WORLD_RELEASE_BASE_URL=f'http://127.0.0.1:{server.server_port}')
            run(['sh', source / 'scripts/install-herdr-world.sh'], installer_env, timeout=300)
            health(base, version)
            assert marker.read_text() == 'preserve user data' and json.loads(settings.read_text())['custom']['channelUpgrade'], 'installer upgrade lost data'
            uninstall(world, env, linux)
            # The release's own formula plus the previous release's formula,
            # on the same temporary tap, exercises brew upgrade (not reinstall).
            package = 'herdr-world-rc' if '-rc.' in version else 'herdr-world'
            tap = 'herdrworld/release-smoke'
            run(['brew', 'uninstall', '--force', f'{tap}/{package}'], env)
            tap_root = Path(run(['brew', '--repository', tap], env).stdout.strip())
            formula = tap_root / 'Formula' / (package + '.rb')
            candidate = formula.read_text()
            # Use the previous formula and launcher from the published stable
            # tap, changing only its class/name when rehearsing the RC channel.
            previous_tap = root / 'previous-tap'
            run(['gh', 'repo', 'clone', 'IvoryHeart/homebrew-tap', previous_tap, '--', '--quiet'], env)
            commits = run(['git', '-C', previous_tap, 'log', '--format=%H', '--max-count=100', '--all', '--', 'Formula/herdr-world.rb'], env).stdout.splitlines()
            old = None
            for commit in commits:
                contents = run(['git', '-C', previous_tap, 'show', commit + ':Formula/herdr-world.rb'], env).stdout
                if f'version "{baseline.removeprefix("v")}"' in contents:
                    old = contents
                    break
            assert old, 'frozen previous formula not found in bounded published tap history'
            if package == 'herdr-world-rc':
                old = old.replace('class HerdrWorld <', 'class HerdrWorldRc <').replace('conflicts_with "herdr-world-rc"', 'conflicts_with "herdr-world"')
            formula.write_text(old)
            run(['brew', 'install', '--formula', f'{tap}/{package}'], env, timeout=600)
            world = Path(run(['brew', '--prefix'], env).stdout.strip()) / 'opt' / package / 'bin/herdr-world'
            installed = world
            # Previous binary writes the old version-pinned definition. This
            # explicitly proves migration of the 0.3.7 escape as well as opt.
            run([world, 'service', 'install'], env)
            health(base, baseline.removeprefix('v'))
            formula.write_text(candidate)
            run(['brew', 'upgrade', '--formula', f'{tap}/{package}'], env, timeout=600)
            health(base, version)
            assert '/Cellar/' not in definition.read_text(), 'service pins a versioned Homebrew keg'
            run(['brew', 'cleanup', f'{tap}/{package}'], env, timeout=180)
            # Restart after the old keg is gone, proving the persisted path.
            run([world, 'service', 'restart'], env)
            health(base, version)
            assert marker.read_text() == 'preserve user data' and json.loads(settings.read_text())['custom']['channelUpgrade'], 'Homebrew upgrade lost data'
            print('PASS running installer and Homebrew upgrades: new served version, preserved data, healthy service')
        finally:
            if installed:
                run([installed, 'service', 'uninstall'], env, check=False)
            config.unlink(missing_ok=True)
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    try:
        main(sys.argv[1], sys.argv[2])
    except Exception as error:
        print('FAIL channel upgrade: ' + str(error), file=sys.stderr)
        raise SystemExit(1)
