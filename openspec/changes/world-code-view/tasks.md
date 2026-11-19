# Proposed future tasks

The embedded workbench remains research, mock and proposal. The desktop handoff
slice was separately authorized by #1010 and is implemented under the
[current desktop contract](../../specs/world-desktop-ide/spec.md). Unresolved
embedding gates remain explicit; this does not authorize IDE installation.

## 1. Settle release gates and prove the installed provider

- [ ] 1.1 Record acceptance of Microsoft's server terms for the intended integration and same-origin IDE/extension trust; verify evidence against the research and refusal scenarios before enabling Microsoft embedding.
- [ ] 1.2 Run a bounded installed `code serve-web` compatibility spike: prove base path, authenticated HTTP/WS, cookies, redirects, sign-in, workers/PWA scopes, webview origins and secure-context behavior without relaxing global CSP; record blockers and explicit handoff if any gate fails.
- [ ] 1.3 Test exact Copilot, Pylance, Remote and C# Dev Kit versions/entitlements in the supported web/remote extension hosts, plus settings/profiles/Sync and updates; publish a compatibility matrix rather than infer desktop parity.
- [ ] 1.4 Measure per-host server/cache/browser and per-project extension-host cold/warm, idle/active resource use on supported local/SSH platforms; derive tested server/window/idle limits.
- [ ] 1.5 Derive qualification, authentication, ownership and revocation invariants; map verification/coverage.json and mandatory consumers, selecting maintained models or justified platform/browser alternatives before code changes.

## 2. Extend integrations and qualified lifecycle

- [ ] 2.1 Add an IDE integration kind with read-only per-host detection, explicit enable/disable and installed-server start; test no process/download on discovery, preserved harness behavior, missing/unsupported providers and no fallback.
- [ ] 2.2 Bind project/checkout/runtime identity to server/provider/profile instances and owned local/SSH transport; test retired/late/uncertain starts, duplicate host names, unsupported Windows/Unix and external-server ownership.
- [ ] 2.3 Implement the gated same-origin proxy and revocable auth; test cross-session URLs, upstream injection/SSRF, cookies, WS logout/disable, root worker scope, webviews, redirects and no token leaks through real browser/platform consumers.
- [ ] 2.4 Implement on-demand reuse, measured limits, explicit stop and idle cleanup for owned servers; test project windows, disconnect and close without killing external servers or Herdr agents.

## 3. Compose real IDE and native terminal integrations

- [ ] 3.1 Add Code/common navigation and qualified Open in Code from rooms, keeping World attention/agent/PR context around the native workbench; test history, host filter, explicit checkout and blocked embed.
- [x] 3.2 Add World-host desktop handoffs for VS Code, Cursor, local JetBrains IDEs and Zed; detect local launchers, persist a default and test exact connection/worktree, local/SSH argument fidelity, browser phone/desktop controls, missing/failed launchers and unsupported SSH refusals (#1010).
- [ ] 3.2a Extend desktop handoff to configured Gateway backend links or the browsing device if separately authorized; do not infer browser-device installation from World-host discovery.
- [ ] 3.3 Package/pair the narrow World extension and terminal profiles; test capability scope/expiry, SSH callback transport, TUI shared-resize acknowledgment and core screen/typing fidelity with no runtime changes.
- [ ] 3.4 Test profile attach/control, focus isolation, hide/close/detach, replacement, disconnect and no key replay across VS Code and existing World viewers; refuse unsupported core adapters without substituting TUI.

## 4. Verify, document and retire the study

- [ ] 4.1 Run complete required consumer/model/browser/platform/security gates for changed production owners, retain independent review, and record measured resources and remaining exclusions before enabling the integration.
- [ ] 4.2 Update FEATURES, knowledge map, integration guide and affected architecture/deployment/tutorial docs for accepted delivered behavior; synchronize/archive only after authorized implementation and acceptance.
- [ ] 4.3 When Code ships or the proposal is rejected, delete the three public mock assets and obsolete fixture tests/references, lower the asset-count allowance by three (currently 189 to 186), and verify the build/asset gate.
