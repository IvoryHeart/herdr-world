"""The packaged World process and its actual browser WebSocket API."""
import json
import re
import subprocess
import threading
import time
import urllib.error
import urllib.request
from processes import Events

PASSWORD = 'release-walk-synthetic-password'


class World:
    def __init__(self, binary, home, env, cookie=None):
        self.env = {**env, 'HERDR_WORLD_DATA_DIR': str(home / 'world'),
                    'HOST': '127.0.0.1', 'PORT': '0', 'OPEN_BROWSER': '0',
                    'HERDR_WORLD_PASSWORD': PASSWORD}
        self.binary = binary
        self.home = home
        self.previous_cookie = cookie
        self.messages = Events()
        self.logs = Events()
        self.sequence = 0

    def __enter__(self):
        import websocket
        self.process = subprocess.Popen([str(self.binary)], env=self.env, cwd=self.home,
                                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                        text=True, bufsize=1)

        def read():
            for line in self.process.stdout:
                match = re.search(r'listening\b[^\r\n]*https?://(?:127\.0\.0\.1|localhost):(\d+)', line)
                if match:
                    self.logs.add('http://127.0.0.1:' + match[1])
            self.logs.add(None)

        threading.Thread(target=read, daemon=True).start()
        try:
            _, self.base = self.logs.wait(lambda _: True, timeout=60, reason='release binary never listened')
            assert self.base, 'release binary exited before listening'
            assert self.request('/').status == 401, 'World allowed access without sign-in'
            if self.previous_cookie:
                assert self.request('/', cookie=self.previous_cookie).status == 200, 'upgrade lost the signed-in session'
            response = self.request('/api/login', {'password': PASSWORD})
            assert response.status == 200, 'configured password no longer signs in'
            self.cookie = response.headers['Set-Cookie'].split(';')[0]
            self.ws = websocket.create_connection(self.base.replace('http:', 'ws:') + '/ws',
                                                   cookie=self.cookie, origin=self.base, timeout=90)
            self.ws.settimeout(None)

            def receive():
                try:
                    while True:
                        self.messages.add(json.loads(self.ws.recv()))
                except Exception:
                    self.messages.add({'closed': True})

            threading.Thread(target=receive, daemon=True).start()
            self.messages.wait(lambda message: message.get('hello'), reason='World did not greet its client')
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def request(self, path, body=None, cookie=None):
        headers = {'Origin': self.base, 'Content-Type': 'application/json'}
        if cookie:
            headers['Cookie'] = cookie
        request = urllib.request.Request(self.base + path, headers=headers,
                                         data=None if body is None else json.dumps(body).encode())
        try:
            return urllib.request.urlopen(request, timeout=20)
        except urllib.error.HTTPError as error:
            return error

    def rpc(self, method, params=None, connection=None):
        self.sequence += 1
        request_id = f'walk-{self.sequence}'
        request = dict(id=request_id, method=method, params=params or {})
        if connection:
            request.update(connection_id=connection['connection_id'],
                           connection_generation=connection['generation'])
        self.ws.send(json.dumps(request))
        _, reply = self.messages.wait(lambda message: message.get('id') == request_id,
                                      reason=f'{method} did not reply')
        assert not reply.get('error'), f'{method} refused the request'
        return reply.get('result')

    def snapshot(self):
        return self.rpc('world.snapshot')['connections']

    def observe(self, read, predicate, reason, timeout=90):
        """Read once, then read again only when the real server pushes a change."""
        cursor = len(self.messages.items)
        deadline = time.monotonic() + timeout
        while True:
            value = read()
            if predicate(value):
                return value
            cursor, _ = self.messages.wait(
                lambda message: 'id' not in message and not message.get('closed'), cursor,
                timeout=max(0, deadline - time.monotonic()), reason=reason)
            cursor += 1

    def ready(self, runtime):
        rows = self.observe(self.snapshot, lambda rows: any(
            item.get('runtime', 'herdr') == runtime and item['state'] == 'ready' and not item['stale']
            for item in rows), f'{runtime} never connected')
        return next(item for item in rows if item.get('runtime', 'herdr') == runtime and item['state'] == 'ready')

    def __exit__(self, *_):
        if hasattr(self, 'ws'):
            self.ws.close()
        self.process.terminate()
        try:
            self.process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=10)
