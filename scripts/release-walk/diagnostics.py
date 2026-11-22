"""Failure-only evidence from the disposable fixture; never upload raw traffic."""
import json
import re
from processes import run


def redact(value, screen=False):
    if isinstance(value, dict):
        return {key: ('[redacted]' if re.search(
            r'token|secret|password|cookie|authorization|credential|url|uri|path|cwd|argv|command|settings', key, re.I)
            else redact(item, screen=key in ('text', 'output_tail'))) for key, item in value.items()}
    if isinstance(value, list):
        return [redact(item, screen=screen) for item in value[:256]]
    if not isinstance(value, str):
        return value
    # Remove OSC hyperlinks and styling before matching visible URLs/tokens.
    text = re.sub(r'\x1b\].*?(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]', '', value, flags=re.S)
    text = re.sub(r'(?:https?|wss?)://[^\s<>"\']+', '[redacted-url]', text, flags=re.I)
    text = re.sub(r'(?im)(?:authorization|bearer|[\w-]*(?:token|secret|password|api[_-]?key))["\']*\s*[:= ]\s*[^\r\n]+', '[redacted-credential]', text)
    text = re.sub(r'\b(?:sk-[\w-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+|[A-Z0-9]{4,6}-[A-Z0-9]{4,6})\b', '[redacted-code]', text)
    if screen:
        # Terminal wrapping may separate a URL's query from its scheme. Remove
        # opaque credential fragments there without hiding snapshot identities
        # or the exact-commit/package digests used to bind the artifact.
        text = re.sub(r'\b[A-Za-z0-9_-]{24,}\b', '[redacted-token]', text)
    text = re.sub(r'(?<![\w:])/(?:[^\s/]+/)*[^\s]*', '[redacted-path]', text)
    return text[-131072:]


def capture_listing(rows, agents, fixture):
    """Read once before teardown, qualified by the failed observation's generation."""
    destination = getattr(fixture, 'failure_artifact', None)
    if destination is None:
        return
    agent = next(item for item in agents if item['runtime'] == 'herdr-core' and item['kind'] == 'codex')
    connection = next((row for row in rows if row['connection_id'] == agent['connection']['connection_id']), None)
    terminal = dict(status='generation-changed')
    if connection and connection['generation'] == agent['connection']['generation']:
        try:
            result = run([fixture.tools / 'core/herdr-core', 'read', '--json', agent['result']['terminal_id']],
                         fixture.env, check=False, timeout=10)
            terminal = (dict(status='captured', text=json.loads(result.stdout)['text']) if result.returncode == 0
                        else dict(status='unavailable', exit_code=result.returncode))
        except Exception:
            terminal = dict(status='unavailable')
    # Copy under the collector lock. Never dump invocation/settings/input events.
    with fixture.telemetry.condition:
        ended = next((item for item in reversed(fixture.telemetry.items)
                      if item.get('identity') == agent['invocation']['identity'] and
                      item.get('event') == 'terminated'), None)
    fields = ('reason', 'source', 'signal', 'errno', 'error_type', 'output_tail')
    recorder = ({key: ended[key] for key in fields if key in ended} if ended
                else dict(reason='no-termination-observed'))
    evidence = dict(schema=1, journey='Every runtime is listed',
                    context=fixture.failure_context, runtime=agent['runtime'], harness=agent['kind'],
                    terminal_id=agent['result']['terminal_id'],
                    expected_generation=agent['connection']['generation'],
                    terminal=terminal, recorder=recorder, aggregate=connection)
    destination.write_text(json.dumps(redact(evidence), indent=2, sort_keys=True) + '\n')
