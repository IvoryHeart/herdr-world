"""Bounded filesystem protocol, executed on the owning host; stdout is JSON only."""
import os
import sys
import json
import stat
import hashlib
import fcntl
import secrets
import errno
import re


class Refusal(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


def refuse(code, message):
    raise Refusal(code, message)


def directory(path, create=False):
    if not isinstance(path, str) or not path.startswith('/') or '\x00' in path:
        refuse('invalid', 'Expected an absolute host path')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.split('/'):
            if part in ('', '.'):
                continue
            if part == '..':
                refuse('refused', 'Parent traversal is refused')
            if create:
                try:
                    os.mkdir(part, 0o700, dir_fd=fd)
                except FileExistsError:
                    pass
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def relative(value, rule=False):
    if (not isinstance(value, str) or len(value) > 1024 or value.startswith('/')
            or '\\' in value or any(ord(c) < 32 for c in value)
            or any(p in ('', '.', '..') for p in value.split('/'))
            or not (value.lower().endswith('.md') or (rule and value.lower().endswith('.mdc')))):
        refuse('invalid', 'Entry must be a relative Markdown filename without traversal')
    return value


def target(source, path):
    relative(path, source['kind'] == 'rules' and any(h in source['harnesses'] for h in ('cursor', 'omp')))
    if source['shape'] == 'file':
        if path != os.path.basename(source['path']):
            refuse('refused', 'Entry is outside this instruction source')
        return source['path']
    if len(path.split('/')) > LIMITS['depth'] + 1:
        refuse('refused', 'Entry exceeds the directory depth limit')
    return source['path'] + '/' + path


def opened(parent, name):
    # O_NONBLOCK prevents a replaced FIFO from hanging before fstat rejects it.
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        os.close(fd)
        refuse('refused', 'Only regular files with one link are supported')
    return fd, info


def read_at(parent, name, limit):
    fd, before = opened(parent, name)
    try:
        if before.st_size > limit:
            refuse('too_large', 'Memory entry exceeds the byte limit')
        data = b''
        while len(data) <= limit:
            chunk = os.read(fd, min(65536, limit + 1 - len(data)))
            if not chunk:
                break
            data += chunk
        after = os.fstat(fd)
        if len(data) > limit:
            refuse('too_large', 'Memory entry exceeds the byte limit')
        if signature(before) != signature(after):
            refuse('conflict', 'Memory changed while reading; refresh it')
        if b'\x00' in data:
            refuse('refused', 'Binary memory entries are refused')
        try:
            text = data.decode('utf-8')
        except UnicodeDecodeError:
            refuse('refused', 'Memory entries must be UTF-8 text')
        revision = hashlib.sha256((signature(after) + ':').encode() + data).hexdigest()
        return text, after, revision
    finally:
        os.close(fd)


def signature(info):
    return ':'.join(str(v) for v in (info.st_dev, info.st_ino, info.st_size,
                                    info.st_mtime_ns, info.st_ctime_ns, info.st_mode))


def safe_small(path):
    """Read config/path metadata, never return its raw contents to World."""
    try:
        parent = directory(os.path.dirname(path))
        try:
            return read_at(parent, os.path.basename(path), 65536)[0]
        finally:
            os.close(parent)
    except (OSError, Refusal):
        return ''


def environment(paths):
    home = os.path.realpath(os.path.expanduser('~'))
    def configured(key, default):
        raw = os.environ.get(key) or default
        return os.path.abspath(os.path.expanduser(raw))
    claude = configured('CLAUDE_CONFIG_DIR', home + '/.claude')
    contexts = {}
    for original in paths:
        path = original
        path = os.path.realpath(path)
        root, memory_root = path, path
        current = path
        for _ in range(64):
            marker = current + '/.git'
            if os.path.lexists(marker):
                root = memory_root = current
                if os.path.isfile(marker) and not os.path.islink(marker):
                    raw = safe_small(marker).strip()
                    if raw.startswith('gitdir: '):
                        gitdir = os.path.realpath(os.path.join(current, raw[8:]))
                        common = safe_small(gitdir + '/commondir').strip()
                        common = os.path.realpath(os.path.join(gitdir, common)) if common else gitdir
                        if os.path.basename(common) == '.git':
                            memory_root = os.path.dirname(common)
                break
            parent = os.path.dirname(current)
            if current == parent:
                break
            current = parent
        contexts[original] = {'path': path, 'root': root, 'memory_root': memory_root}
    settings = {}
    try:
        settings = json.loads(safe_small(claude + '/settings.json') or '{}')
        if not isinstance(settings, dict):
            settings = {}
    except ValueError:
        pass
    custom = settings.get('autoMemoryDirectory')
    custom = os.path.expanduser(custom) if isinstance(custom, str) else None
    if custom and not os.path.isabs(custom):
        custom = None
    return {'home': home, 'codex': configured('CODEX_HOME', home + '/.codex'),
            'claude': claude, 'pi': configured('PI_CODING_AGENT_DIR', home + '/.pi/agent'),
            'claude_memory': custom,
            'claude_project_name': os.environ.get('CLAUDE_CODE_PROJECT_DIR_NAME'),
            'config_home': configured('XDG_CONFIG_HOME', home + '/.config'),
            'copilot': configured('COPILOT_HOME', home + '/.copilot'),
            'hermes': configured('HERMES_HOME', home + '/.hermes'),
            'kimi': configured('KIMI_CODE_HOME', home + '/.kimi-code'),
            'qwen': configured('QWEN_HOME', home + '/.qwen'),
            'contexts': contexts}


def rule_name(source, name):
    harnesses = source['harnesses']
    if source['kind'] == 'rules' and name.lower().endswith('.mdc'):
        return any(h in harnesses for h in ('cursor', 'omp'))
    if source['kind'] == 'rules' and harnesses == ['copilot']:
        return name.lower().endswith('.instructions.md')
    # Cursor's rules system ignores plain .md files; other adapters accept them.
    return name.lower().endswith('.md') and harnesses != ['cursor']


def rule_loads(source, path, info):
    # Read only bounded rule metadata; never interpret YAML tags, imports or globs.
    harnesses = [h for h in source['harnesses'] if h in ('cursor', 'omp', 'qwen', 'antigravity-cli')]
    if source['kind'] != 'rules' or not harnesses or info.st_size > LIMITS['file_bytes']:
        return {}
    try:
        full = target(source, path)
        fd = directory(os.path.dirname(full))
        try:
            text = read_at(fd, os.path.basename(full), LIMITS['file_bytes'])[0]
        finally:
            os.close(fd)
    except (OSError, Refusal):
        return {}
    header = re.match(r'\A---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)', text)
    front = header.group(1) if header else ''
    always = bool(re.search(r"(?m)^alwaysApply:\s*['\"]?true['\"]?\s*(?:\#.*)?$", front))
    modes = {}
    for harness in harnesses:
        startup = always
        if harness == 'qwen':
            startup = not re.search(r'(?m)^paths\s*:', front)
        elif harness == 'antigravity-cli':
            startup = bool(re.search(r"(?m)^trigger:\s*['\"]?always_on['\"]?\s*(?:\#.*)?$", front))
        modes[harness] = {'mode': 'startup-candidate' if startup else 'on-demand'}
    return modes


def entry(source, path, info):
    normal = stat.S_ISREG(info.st_mode) and info.st_nlink == 1
    size_ok = info.st_size <= LIMITS['file_bytes']
    full = target(source, path)
    return {'id': hashlib.sha256(full.encode()).hexdigest()[:24],
            'source_id': source['id'], 'path': path, 'size': info.st_size,
            'harness_loads': rule_loads(source, path, info) if normal and size_ok else {},
            'modified_at': info.st_mtime_ns // 1000000,
            'state': 'available' if normal and size_ok else 'refused',
            **({} if normal and size_ok else {'reason': 'unsupported_file' if not normal else 'too_large'}),
            'load': 'on-demand' if source['shape'] == 'directory' and source['kind'] == 'memory' and path != 'MEMORY.md' else source['load']}


def listing(sources):
    entries, states = [], []
    truncated = False
    # Bound visited directory items too, including non-Markdown files.
    visited = 0
    def walk(source, fd, prefix, depth):
        nonlocal visited, truncated
        with os.scandir(fd) as items:
            for item in items:
                visited += 1
                if visited > LIMITS['entries'] * 4 or len(entries) >= LIMITS['entries']:
                    truncated = True
                    return
                path = prefix + item.name
                info = item.stat(follow_symlinks=False)
                if stat.S_ISDIR(info.st_mode):
                    if source['harnesses'] == ['antigravity-cli']:
                        continue  # Maker's default rules scan is flat; configured extras are not expanded.
                    if depth >= LIMITS['depth']:
                        truncated = True
                        continue
                    child = os.open(item.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                    try:
                        walk(source, child, path + '/', depth + 1)
                    finally:
                        os.close(child)
                elif rule_name(source, path):
                    entries.append(entry(source, path, info))
    for source in sources:
        state = {'id': source['id'], 'state': 'available'}
        try:
            if source['shape'] == 'file':
                fd = directory(os.path.dirname(source['path']))
                try:
                    name = os.path.basename(source['path'])
                    info = os.stat(name, dir_fd=fd, follow_symlinks=False)
                    if len(entries) < LIMITS['entries']:
                        entries.append(entry(source, name, info))
                    else:
                        truncated = True
                finally:
                    os.close(fd)
            else:
                fd = directory(source['path'])
                try:
                    walk(source, fd, '', 0)
                finally:
                    os.close(fd)
        except FileNotFoundError:
            state['state'] = 'missing'
        except (OSError, Refusal):
            state.update(state='refused', reason='Source is unreadable or contains a refused path')
        states.append(state)
    return {'states': states, 'entries': entries, 'truncated': truncated}


def search(request):
    sources = {s['id']: s for s in request['sources']}
    result = {'query': request['query'], 'matches': [], 'scanned_bytes': 0,
              'skipped': 0, 'truncated': request.get('truncated', False)}
    query = request['query'].lower()
    seen = set()
    for item in request['entries']:
        if item['id'] in seen:
            continue
        seen.add(item['id'])
        if item['state'] != 'available':
            result['skipped'] += 1
            continue
        if result['scanned_bytes'] + item['size'] > LIMITS['search_bytes']:
            result['truncated'] = True
            break
        full = target(sources[item['source_id']], item['path'])
        try:
            parent = directory(os.path.dirname(full))
            try:
                content, info, _ = read_at(parent, os.path.basename(full), LIMITS['file_bytes'])
            finally:
                os.close(parent)
        except (OSError, Refusal):
            result['skipped'] += 1
            continue
        if result['scanned_bytes'] + info.st_size > LIMITS['search_bytes']:
            result['truncated'] = True
            break
        result['scanned_bytes'] += info.st_size
        lines = content.split('\n')
        for index, line in enumerate(lines):
            match = line.lower().find(query)
            if match < 0:
                continue
            start = max(0, match - 60)
            result['matches'].append({'entry': item, 'line': index + 1,
                                      'excerpt': line[start:start + 240]})
            if len(result['matches']) >= LIMITS['search_results']:
                result['truncated'] = True
                return result
    return result


def operate(request):
    action = request['action']
    if action == 'environment':
        return environment(request['paths'])
    if action == 'list':
        return listing(request['sources'])
    if action == 'search':
        return search(request)
    if action in ('create', 'update', 'delete'):
        if request.get('user_action') is not True:
            refuse('refused', 'An explicit user action is required')
        if action == 'delete' and request.get('confirmed') is not True:
            refuse('refused', 'Deletion requires confirmation')
    source, path = request['source'], request['path']
    if action in ('create', 'update', 'delete'):
        relative(path)  # MDC rules remain browse-only.
    full = target(source, path)
    parent = directory(os.path.dirname(full), action == 'create')
    name = os.path.basename(full)
    temp = None
    try:
        if action == 'read':
            content, info, revision = read_at(parent, name, LIMITS['file_bytes'])
            return {'content': content, 'size': info.st_size,
                    'modified_at': info.st_mtime_ns // 1000000, 'revision': revision}
        if action not in ('create', 'update', 'delete'):
            refuse('invalid', 'Unknown memory action')
        if request.get('user_action') is not True:
            refuse('refused', 'An explicit user action is required')
        if action == 'delete' and request.get('confirmed') is not True:
            refuse('refused', 'Deletion requires confirmation')
        fcntl.flock(parent, fcntl.LOCK_EX)
        if action == 'create':
            try:
                os.stat(name, dir_fd=parent, follow_symlinks=False)
                refuse('conflict', 'Memory already exists; refresh it')
            except FileNotFoundError:
                pass
            mode = 0o600
            info = None
        else:
            _, info, revision = read_at(parent, name, LIMITS['file_bytes'])
            if request.get('revision') != revision:
                refuse('conflict', 'Memory changed; read it again before editing')
            mode = stat.S_IMODE(info.st_mode) & 0o777
        if action == 'delete':
            if signature(os.stat(name, dir_fd=parent, follow_symlinks=False)) != signature(info):
                refuse('conflict', 'Memory changed before deletion')
            os.unlink(name, dir_fd=parent)
            os.fsync(parent)
            return {'status': 'deleted', 'revision': None}
        content = request.get('content')
        if not isinstance(content, str) or '\x00' in content:
            refuse('invalid', 'Memory content must be UTF-8 text without NUL')
        data = content.encode('utf-8')
        if len(data) > LIMITS['file_bytes']:
            refuse('too_large', 'Memory entry exceeds the byte limit')
        temp = '.world-memory-' + secrets.token_hex(16)
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode, dir_fd=parent)
        try:
            os.fchmod(fd, mode)
            with os.fdopen(fd, 'wb', closefd=False) as output:
                output.write(data)
                output.flush()
                os.fsync(fd)
        finally:
            os.close(fd)
        if action == 'create':
            # Hard-link then unlink is an atomic no-clobber publication.
            try:
                os.link(temp, name, src_dir_fd=parent, dst_dir_fd=parent, follow_symlinks=False)
            except FileExistsError:
                refuse('conflict', 'Memory already exists; refresh it')
            os.unlink(temp, dir_fd=parent)
        else:
            if signature(os.stat(name, dir_fd=parent, follow_symlinks=False)) != signature(info):
                refuse('conflict', 'Memory changed before replacement')
            os.replace(temp, name, src_dir_fd=parent, dst_dir_fd=parent)
        temp = None
        os.fsync(parent)
        _, _, revision = read_at(parent, name, LIMITS['file_bytes'])
        return {'status': 'created' if action == 'create' else 'updated', 'revision': revision}
    finally:
        if temp:
            try:
                os.unlink(temp, dir_fd=parent)
            except FileNotFoundError:
                pass
        os.close(parent)


try:
    request = json.loads(sys.stdin.buffer.read(2 * 1024 * 1024))
    LIMITS = request['limits']
    print(json.dumps({'ok': True, 'result': operate(request)}, ensure_ascii=True))
except Refusal as error:
    print(json.dumps({'ok': False, 'code': error.code, 'error': error.message}))
except FileNotFoundError:
    print(json.dumps({'ok': False, 'code': 'not_found', 'error': 'Memory path no longer exists'}))
except OSError as error:
    code = 'refused' if error.errno in (errno.EACCES, errno.ELOOP, errno.ENOTDIR, errno.EPERM) else 'unavailable'
    print(json.dumps({'ok': False, 'code': code, 'error': 'Memory filesystem operation refused or unavailable'}))
except (ValueError, KeyError, TypeError):
    print(json.dumps({'ok': False, 'code': 'invalid', 'error': 'Invalid memory filesystem request'}))
