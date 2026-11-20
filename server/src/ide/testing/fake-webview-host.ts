/**
 * Synthetic stand-ins for VS Code's workbench page and its webview host page
 * (`…/webview/browser/pre/index.html`), shaped as VS Code serves them: the
 * configuration in an attribute-encoded meta, a CSP meta that admits the
 * host page's one inline script by hash, and the stock parent check, which
 * hands a message port only to a parent whose origin hashes to the page's
 * hostname.
 */
import { cspScriptHash, WEBVIEW_HOSTNAME_CHECK } from "../webview-host";

export const FAKE_PRODUCT_PATH =
  "/stable-0000000000000000000000000000000000000000";

/** The host page's script, after VS Code's `signalReady`. */
export const FAKE_WEBVIEW_HOST_SCRIPT = `
const searchParams = new URL(location.toString()).searchParams;
const ID = searchParams.get('id');
const webviewOrigin = searchParams.get('origin');
(async () => {
  const parentOrigin = searchParams.get('parentOrigin');
  const hostname = location.hostname;
  const strData = JSON.stringify({ parentOrigin, salt: webviewOrigin });
  const hash = await crypto.subtle.digest('sha-256', new TextEncoder().encode(strData));
  const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  const parentOriginHash = BigInt(\`0x\${hashHex}\`).toString(32).padStart(52, '0');
  if (${WEBVIEW_HOSTNAME_CHECK}) {
    const channel = new MessageChannel();
    channel.port1.onmessage = (e) => channel.port1.postMessage('echo:' + e.data);
    window.parent.postMessage({ target: ID, channel: 'webview-ready', data: {} }, parentOrigin, [channel.port2]);
    return;
  }
  throw new Error(\`Expected '\${parentOriginHash}' as hostname or subdomain!\`);
})();
`;

export function fakeWebviewHostPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy"
		content="default-src 'none'; script-src ${cspScriptHash(FAKE_WEBVIEW_HOST_SCRIPT)} 'self'; frame-src 'self'; style-src 'unsafe-inline';">
</head>
<body>
	<script async type="module">${FAKE_WEBVIEW_HOST_SCRIPT}</script>
</body>
</html>
`;
}

function attribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * A workbench page under `base` whose `openWebview(id, salt, endpoint?)`
 * frames one webview the way VS Code's webview element does, from the
 * configured endpoint unless given another; `reportScript` drives it.
 */
export function fakeWorkbenchPage(base: string, reportScript = "") {
  const settings = {
    remoteAuthority: "world.example",
    serverBasePath: base,
    productConfiguration: { embedderIdentifier: "server-distro" },
    callbackRoute: `${base}${FAKE_PRODUCT_PATH}/callback`,
  };
  return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8" />
	<meta id="vscode-workbench-web-configuration" data-settings="${attribute(JSON.stringify(settings))}">
	<meta id="vscode-workbench-web-base-url" data-settings="${attribute(`${base}${FAKE_PRODUCT_PATH}/static`)}">
</head>
<body>
<script>
const config = JSON.parse(document.getElementById('vscode-workbench-web-configuration').getAttribute('data-settings'));
// VS Code's default when nothing names an endpoint.
const template = config.webviewEndpoint || 'https://{{uuid}}.vscode-cdn.net/stable/0000/out/vs/workbench/contrib/webview/browser/pre/';
function openWebview(id, salt, base) {
  return new Promise((resolve) => {
    const endpoint = (base ?? template.replace('{{uuid}}', 'hash-' + id)).replace(/\\/$/, '');
    const contentOrigin = new URL(endpoint).origin;
    const frame = document.createElement('iframe');
    const timer = setTimeout(() => resolve({ src: frame.src, ready: false }), 4000);
    addEventListener('message', (e) => {
      if (e.data?.target !== id || e.origin !== contentOrigin) return;
      const port = e.ports[0];
      port.onmessage = (reply) => { clearTimeout(timer); resolve({ src: frame.src, ready: true, echo: reply.data }); };
      port.postMessage('ping');
    });
    frame.src = endpoint + '/index.html?' + new URLSearchParams({ id, origin: salt, parentOrigin: location.origin, swVersion: '1' });
    document.body.append(frame);
  });
}
${reportScript}
</script>
</body>
</html>
`;
}
