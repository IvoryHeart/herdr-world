import { expect, test } from "bun:test";
import {
  cspScriptHash,
  isWebviewHostPage,
  WEBVIEW_HOST_DIR,
  WEBVIEW_HOSTNAME_CHECK,
  WEBVIEW_SAME_ORIGIN_CHECK,
  withSameOriginWebviewHost,
  withWorldWebviewEndpoint,
} from "./webview-host";
import {
  FAKE_PRODUCT_PATH,
  FAKE_WEBVIEW_HOST_SCRIPT,
  fakeWebviewHostPage,
  fakeWorkbenchPage,
} from "./testing/fake-webview-host";

const BASE = "/ide/AbCdEfGhIjKlMnOpQrStUv";
const ORIGIN = "https://world.example:8443";

function settingsOf(html: string) {
  const raw =
    /id="vscode-workbench-web-configuration" data-settings="([^"]*)"/.exec(
      html,
    )![1];
  return JSON.parse(
    raw
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&"),
  );
}

test("the workbench gets VS Code's webviewEndpoint on World's origin and keeps the rest", () => {
  const page = fakeWorkbenchPage(BASE);
  const rewritten = withWorldWebviewEndpoint(page, ORIGIN, BASE)!;
  const settings = settingsOf(rewritten);
  expect(settings.webviewEndpoint).toBe(
    `${ORIGIN}${BASE}${FAKE_PRODUCT_PATH}/static${WEBVIEW_HOST_DIR}`,
  );
  expect({
    ...settingsOf(page),
    webviewEndpoint: settings.webviewEndpoint,
  }).toEqual(settings);
  // Only the configuration attribute changed.
  expect(rewritten.replace(/data-settings="[^"]*"/, "")).toBe(
    page.replace(/data-settings="[^"]*"/, ""),
  );
});

test("a workbench whose static route leaves the instance route is not edited", () => {
  const other = fakeWorkbenchPage("/ide/ZZZZZZZZZZZZZZZZZZZZZZ");
  expect(withWorldWebviewEndpoint(other, ORIGIN, BASE)).toBeNull();
  const escaping = fakeWorkbenchPage(`${BASE}/../elsewhere`);
  expect(withWorldWebviewEndpoint(escaping, ORIGIN, BASE)).toBeNull();
  expect(
    withWorldWebviewEndpoint("<html>not a workbench</html>", ORIGIN, BASE),
  ).toBeNull();
});

test("the webview host page swaps only the hostname check and its CSP hash", () => {
  const page = fakeWebviewHostPage();
  const rewritten = withSameOriginWebviewHost(page)!;
  const edited = FAKE_WEBVIEW_HOST_SCRIPT.replace(
    WEBVIEW_HOSTNAME_CHECK,
    WEBVIEW_SAME_ORIGIN_CHECK,
  );
  expect(rewritten).toBe(
    page
      .replace(FAKE_WEBVIEW_HOST_SCRIPT, edited)
      .replace(cspScriptHash(FAKE_WEBVIEW_HOST_SCRIPT), cspScriptHash(edited)),
  );
  expect(rewritten).not.toContain(WEBVIEW_HOSTNAME_CHECK);
  // The rest of the policy is the IDE's, byte for byte.
  expect(rewritten).toContain("default-src 'none'; script-src 'sha256-");
  expect(rewritten).toContain(
    "'self'; frame-src 'self'; style-src 'unsafe-inline';",
  );
});

test("a host page World can't prove it understands is served as it is", () => {
  const page = fakeWebviewHostPage();
  // A policy hash that isn't the browser's hash of the script.
  const wrongHash = page.replace(
    cspScriptHash(FAKE_WEBVIEW_HOST_SCRIPT),
    "'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='",
  );
  expect(withSameOriginWebviewHost(wrongHash)).toBeNull();
  // A different check, or the stock one twice.
  expect(
    withSameOriginWebviewHost(
      page.replace(WEBVIEW_HOSTNAME_CHECK, "hostname === parentOriginHash"),
    ),
  ).toBeNull();
  expect(
    withSameOriginWebviewHost(
      page.replace(
        "</body>",
        `<script>if (${WEBVIEW_HOSTNAME_CHECK}) {}</script></body>`,
      ),
    ),
  ).toBeNull();
});

test("the browser hashes LF text, so a CRLF page is hashed as LF", () => {
  const crlf = fakeWebviewHostPage().replace(/\n/g, "\r\n");
  const rewritten = withSameOriginWebviewHost(crlf)!;
  expect(rewritten).not.toContain("\r");
  expect(rewritten).toContain(
    cspScriptHash(
      FAKE_WEBVIEW_HOST_SCRIPT.replace(
        WEBVIEW_HOSTNAME_CHECK,
        WEBVIEW_SAME_ORIGIN_CHECK,
      ),
    ),
  );
});

test("only VS Code's webview host pages are host pages", () => {
  const pre = `${BASE}${FAKE_PRODUCT_PATH}/static/out/vs/workbench/contrib/webview/browser/pre`;
  expect(isWebviewHostPage(`${pre}/index.html`)).toBe(true);
  expect(isWebviewHostPage(`${pre}/index-no-csp.html`)).toBe(true);
  expect(isWebviewHostPage(`${pre}/fake.html`)).toBe(false);
  expect(isWebviewHostPage(`${pre}/service-worker.js`)).toBe(false);
  expect(isWebviewHostPage(`${BASE}/index.html`)).toBe(false);
});
