# Tasks

The first version of Code shipped in #1009: installed VS Code, code-server or
OpenVSCode Server on World's own computer, per project, on World's origin.
Checked tasks are delivered; notes mark what a partly delivered task covers.
Everything else stays open.

## 1. Settle release gates and prove the installed provider

- [ ] 1.1 Record acceptance of Microsoft's server terms for the intended integration and same-origin IDE/extension trust; verify evidence against the research and refusal scenarios before enabling Microsoft embedding.
- [ ] 1.2 (#1009: base path, authenticated HTTP and WebSocket, cookie scoping and the workbench assets proved against installed VS Code 1.146 through the proxy; sign-in, workers/PWA scopes and webview origins remain unverified.) Run a bounded installed `code serve-web` compatibility spike: prove base path, authenticated HTTP/WS, cookies, redirects, sign-in, workers/PWA scopes, webview origins and secure-context behavior without relaxing global CSP; record blockers and explicit handoff if any gate fails.
- [ ] 1.3 Test exact Copilot, Pylance, Remote and C# Dev Kit versions/entitlements in the supported web/remote extension hosts, plus settings/profiles/Sync and updates; publish a compatibility matrix rather than infer desktop parity.
- [ ] 1.4 Measure per-host server/cache/browser and per-project extension-host cold/warm, idle/active resource use on supported local/SSH platforms; derive tested server/window/idle limits.
- [ ] 1.5 Derive qualification, authentication, ownership and revocation invariants; map verification/coverage.json and mandatory consumers, selecting maintained models or justified platform/browser alternatives before code changes.

## 2. Extend integrations and qualified lifecycle

- [x] 2.1 (World's own computer only; SSH projects refuse with a desktop handoff.) Add an IDE integration kind with read-only per-host detection, explicit enable/disable and installed-server start; test no process/download on discovery, preserved harness behavior, missing/unsupported providers and no fallback.
- [ ] 2.2 Bind project/checkout/runtime identity to server/provider/profile instances and owned local/SSH transport; test retired/late/uncertain starts, duplicate host names, unsupported Windows/Unix and external-server ownership.
- [ ] 2.3 (#1009: proxy, cookies, WebSocket and connection-token handling with route tests; logout/disable revocation and webview/worker checks remain.) Implement the gated same-origin proxy and revocable auth; test cross-session URLs, upstream injection/SSRF, cookies, WS logout/disable, root worker scope, webviews, redirects and no token leaks through real browser/platform consumers.
- [ ] 2.4 (#1009: on-demand start and reuse per folder, an unmeasured cap of four, explicit stop, stop on disable, removal and shutdown; idle cleanup and measured limits remain.) Implement on-demand reuse, measured limits, explicit stop and idle cleanup for owned servers; test project windows, disconnect and close without killing external servers or Herdr agents.

## 3. Compose real IDE and native terminal integrations

- [ ] 3.1 (#1009: Code view and navigation, project picker, agent/terminal rail; Open in Code from rooms remains.) Add Code/common navigation and qualified Open in Code from rooms, keeping World attention/agent/PR context around the native workbench; test history, host filter, explicit checkout and blocked embed.
- [ ] 3.2 Add validated desktop provider handoffs for VS Code, Cursor, Gateway and Zed; test browser-device availability unknown, local/remote path encoding, exact connection and no credentials/command injection.
- [ ] 3.3 Package/pair the narrow World extension and terminal profiles; test capability scope/expiry, SSH callback transport, TUI shared-resize acknowledgment and core screen/typing fidelity with no runtime changes.
- [ ] 3.4 Test profile attach/control, focus isolation, hide/close/detach, replacement, disconnect and no key replay across VS Code and existing World viewers; refuse unsupported core adapters without substituting TUI.

## 4. Verify, document and retire the study

- [ ] 4.1 Run complete required consumer/model/browser/platform/security gates for changed production owners, retain independent review, and record measured resources and remaining exclusions before enabling the integration.
- [ ] 4.2 Update FEATURES, knowledge map, integration guide and affected architecture/deployment/tutorial docs for accepted delivered behavior; synchronize/archive only after authorized implementation and acceptance.
- [x] 4.3 When Code ships or the proposal is rejected, delete the three public mock assets and obsolete fixture tests/references, lower the asset-count allowance, and verify the build/asset gate. (#1009: 189 to 188; Code's own lazy chunk adds two files.)
