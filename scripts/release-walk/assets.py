import json
import os
from pathlib import Path
import shlex
import shutil
import sys
import tarfile
from contract import CORE_VERSION, HARNESS_VERSIONS, digest
from processes import run

SOURCE = Path(__file__).resolve().parent


def download(url, destination, sha=None):
    run(['curl', '--proto', '=https', '--proto-redir', '=https', '-fsSL',
         '--connect-timeout', '15', '--max-time', '120', url, '-o', destination])
    if sha:
        assert digest(destination) == sha, 'download checksum mismatch'


def executable(archive, destination):
    with tarfile.open(archive) as package:
        entries = [entry for entry in package.getmembers()
                   if Path(entry.name).name == 'herdr-world' and entry.isfile()]
        assert len(entries) == 1, 'release archive must contain exactly one World binary'
        destination.write_bytes(package.extractfile(entries[0]).read())
    destination.chmod(0o755)
    return destination


def published(root, tag, target):
    assert __import__('re').fullmatch(r'v\d+\.\d+\.\d+', tag), 'baseline must be a published stable tag'
    directory = root / tag
    directory.mkdir(exist_ok=True)
    archive = directory / f'herdr-world-{tag}-{target}.tar.xz'
    if not archive.exists():
        run(['gh', 'release', 'download', tag, '--repo', 'IvoryHeart/herdr-world',
             '--pattern', archive.name, '--pattern', archive.name + '.sha256', '--dir', directory])
    expected = Path(str(archive) + '.sha256').read_text().split()[0]
    assert digest(archive) == expected, 'published baseline checksum mismatch'
    return executable(archive, directory / 'herdr-world')


def tools(root, config):
    directory = root / 'tools'
    directory.mkdir()
    bin_dir = directory / 'bin'
    bin_dir.mkdir()
    for name in ('node', 'bun'):
        found = shutil.which(name)
        assert found, f'{name} is required to exercise the normal launcher'
        (bin_dir / name).symlink_to(found)
    run(['npm', 'install', '--no-audit', '--no-fund', '--prefix', directory,
         f'@anthropic-ai/claude-code@{HARNESS_VERSIONS["claude"]}',
         f'@openai/codex@{HARNESS_VERSIONS["codex"]}'], timeout=600)
    # Separate PATH entries make a core-only installation genuinely lack Herdr.
    herdr_bin = directory / 'tui'
    herdr_bin.mkdir()
    download(config['herdr_url'], herdr_bin / 'herdr', config['herdr_sha256'])
    (herdr_bin / 'herdr').chmod(0o755)
    target = config['runtime_target']
    manifest_path = directory / 'core-manifest.json'
    download(f'https://releases.herdr.dev/core/{CORE_VERSION}/manifest.json', manifest_path)
    manifest = json.loads(manifest_path.read_text())
    assert manifest['version'] == CORE_VERSION, 'core manifest version mismatch'
    entry = manifest['targets'][target]
    assert entry['url'].startswith(f'https://releases.herdr.dev/core/{CORE_VERSION}/'), 'untrusted core asset URL'
    core_bin = directory / 'core'
    core_bin.mkdir()
    archive = directory / 'core.tar.gz'
    download(entry['url'], archive, entry['sha256'])
    with tarfile.open(archive) as package:
        member = next(item for item in package.getmembers() if item.name == 'herdr-core' and item.isfile())
        (core_bin / 'herdr-core').write_bytes(package.extractfile(member).read())
    (core_bin / 'herdr-core').chmod(0o755)
    (core_bin / 'hc').symlink_to('herdr-core')
    for kind in HARNESS_VERSIONS:
        wrapper = bin_dir / kind
        wrapper.write_text('#!/bin/sh\nexec ' + shlex.join([sys.executable, str(SOURCE / 'observe.py'), kind]) + ' "$@"\n')
        wrapper.chmod(0o755)
    return directory


def environment(root, tools_dir, session, tui, telemetry, signed_home=None, core=True):
    root.mkdir(parents=True, exist_ok=True)
    state = root / 'state'
    state.mkdir(mode=0o700, exist_ok=True)
    # Core's fallback repeats HC_SESSION under state, exceeding macOS's
    # socket-path limit. Keep even holder sockets short and private here.
    runtime = root / 'run'
    runtime.mkdir(mode=0o700, exist_ok=True)
    shell_rc = root / 'shell-rc'
    shell_rc.write_text('set +o emacs 2>/dev/null; set +o vi 2>/dev/null\nstty icanon\n'
                        "PS1='WALK_READY>'; PS2='WALK_CONTINUATION>'; export PS1 PS2\n")
    config = root / '.config'
    config.mkdir(exist_ok=True)
    for name in ('.claude', '.codex'):
        (root / name).mkdir(mode=0o700, exist_ok=True)
    (config / 'herdr-core').mkdir(exist_ok=True)
    (config / 'herdr-core/config.toml').write_text('notes = false\nshell = ["/bin/sh"]\n')
    # Allowlist: never inherit owner sockets, sessions, credentials or config roots.
    env = dict(HOME=str(root), XDG_CONFIG_HOME=str(config), XDG_STATE_HOME=str(state),
               XDG_RUNTIME_DIR=str(runtime),
               XDG_CACHE_HOME=str(root / 'cache'), TMPDIR=str(root), SHELL='/bin/sh',
               ENV=str(shell_rc), TERM='xterm-256color', LANG='en_US.UTF-8',
               PATH=os.pathsep.join([str(tools_dir / 'bin'),
                                     *([str(tools_dir / 'core')] if core else []),
                                     *([str(tools_dir / 'tui')] if tui else []),
                                     '/usr/bin', '/bin', '/usr/sbin', '/sbin']),
               HC_SESSION=session, HC_INSTALL_DIR=str(tools_dir / 'core') if core else str(root / 'absent-core'),
               HERDR_INSTALL_DIR=str(root / 'absent-tui'),
               WALK_TELEMETRY=str(telemetry),
               WALK_REAL_CLAUDE=str(tools_dir / 'node_modules/.bin/claude'),
               WALK_REAL_CODEX=str(tools_dir / 'node_modules/.bin/codex'),
               CLAUDE_CONFIG_DIR=str(root / '.claude'), CODEX_HOME=str(root / '.codex'),
               DISABLE_AUTOUPDATER='1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1',
               OPEN_BROWSER='0')
    if tui:
        env['HERDR_SESSION'] = session
    if signed_home:
        assert (signed_home / '.claude').is_dir() and (signed_home / '.codex').is_dir(), 'dedicated signed-in harness home is not initialized'
        env['CLAUDE_CONFIG_DIR'] = str(signed_home / '.claude')
        env['CODEX_HOME'] = str(signed_home / '.codex')
    return env
