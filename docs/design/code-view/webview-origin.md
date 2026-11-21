# Decision: where stock VS Code's webviews load

Issue #1038, design question 2 of #988. Status: decided. Webviews load from
VS Code's own webview origin, which only the frame rule on IDE pages admits
(PR #1124, #1053). Same-origin webviews, a second World origin and blank
webviews are rejected.
Contract: [world-code-view delta](../../../openspec/changes/world-code-view/specs/world-code-view/spec.md),
requirement "Embedding feasibility and full authority admission".

## The problem

Webviews are the VS Code panels that render HTML: Markdown preview, notebook
outputs, and the panels many extensions draw (GitLens, Copilot Chat). VS Code
runs each one in an iframe on its own origin, so extension HTML and document
content cannot touch the workbench page. Stock VS Code (`code serve-web`) and
OpenVSCode Server take that origin from `webviewContentExternalBaseUrlTemplate`
in their `product.json`: `https://{{uuid}}.vscode-cdn.net/…`, a Microsoft host.
Their own CSP admits `frame-src 'self' https://*.vscode-cdn.net`.

`{{uuid}}` is not random. It is a hash of the parent page's origin and a
per-webview salt, and the webview host page (`pre/index.html`) refuses to run
unless its own host name is that hash or a subdomain of it. Every webview
therefore needs its own host name under a wildcard.

World keeps the browser on one origin (AGENTS.md) and adds
`frame-src 'self' blob: data:` to every IDE response, so those frames never
load. Before this decision (#1009, PR #1036) stock VS Code and OpenVSCode
embedded with webviews blank. code-server serves webviews from its own route
on World's origin, so they always showed.

## Decision

Let IDE pages frame VS Code's own webview origin.

- The frame rule World adds to every IDE route response (`/ide/<id>/`)
  becomes `frame-src 'self' blob: data: https://*.vscode-cdn.net`. Stock
  VS Code and OpenVSCode Server load webviews, and their web worker extension
  host, from `https://<hash>.vscode-cdn.net` as they do anywhere else.
- No product file is rewritten: not `product.json`, not the webview host
  page. code-server is left as it is.
- World's own pages and every other route keep the one-origin rule; this is
  the one exception AGENTS.md names.
- Webviews need internet access to vscode-cdn.net and a secure page (HTTPS
  or localhost), because the host-name hash uses browser cryptography. On
  plain HTTP, OpenVSCode Server's webviews stay blank.

## Threat model

**What is at stake.** A page on World's origin holds World's browser session:
it can call every World API, which reaches shells on every connected host and
every agent.

**Webview content is untrusted.** Extension panels, notebook outputs and
previews of files from any opened repository are written by people other than
the owner. The threat is that content, not the extensions: extensions already
run with the owner's full rights in VS Code, and the Enable dialog grants the
workbench World's browser authority.

**Why the exception is safe.** Webview content stays on another origin, so
the browser keeps it out of World:

- it cannot read World's window, storage or cookies;
- its requests to World's API and WebSocket carry no World session cookie and
  are refused;
- its service worker's scope is its own origin, never World's pages;
- the IDE still cannot widen a service worker's scope over World's pages or
  set cookies outside its route.

**Hostile-webview test (PR #1124).**
`server/src/ide/webview-origin.browser.test.ts` runs World over HTTPS in
headless Chrome. A fake workbench on World's IDE route frames a hostile page
on a `vscode-cdn.net` name (mapped to a local HTTPS server) and a page on any
other origin. It checks that:

- the `vscode-cdn.net` page loads and any other origin is refused;
- the hostile page cannot read World's cookie, storage or window;
- its calls to World's API and WebSocket carry no session cookie and fail;
- it cannot register a service worker over World's pages.

A failure in this test blocks the change.

## Rejected options

### (a) Keep one origin; webviews stay blank

Markdown preview, notebooks and webview-based extensions (GitLens, Copilot
Chat) would be blank in the two IDEs most people use, which pushes them out
of World to a desktop editor.

### (b) A second World-owned origin for webviews

It isolates as well as vscode-cdn.net on paper. In practice:

- The host-name hash check means one extra port is not enough: each webview
  needs `<hash>.<webview host>`. From another device that takes a wildcard DNS
  name and a wildcard HTTPS certificate (webviews need a secure context).
  World has neither for a LAN or Tailscale address.
- A second port on the same host shares World's cookies (cookies are scoped
  by host, not port) and counts as the same site, so the cheap form of (b)
  isolates far less than it seems.
- It changes AGENTS.md's one-origin rule, adds a second listener (LAN binding
  is security-sensitive) and a second service-worker scope, and still needs
  the webview template rewritten in the product's configuration.

### (c) Serve webviews from World's own origin

Built first in PR #1124 and withdrawn. World set the workbench's
`webviewEndpoint` option to a copy of the webview host page under the
instance route, with its host-name check and CSP hash rewritten. VS Code's
host page writes content into a same-origin frame, calls into it directly
and loads resources through a service worker that controls that frame, so
the content must share World's origin. Script-running content (notebook HTML
output, extension panels showing untrusted HTML) could then reach World's
window, storage and API, and no cookie, CSP, sandbox, origin check or
service-worker rule separates two documents on one origin. Making the frame
opaque leaves every webview blank.

## Licence

World admits the webview origin VS Code already uses and changes none of its
files, so no product file is edited. Recording acceptance of Microsoft's
server terms (OpenSpec task 1.1) stays open.

## Revisit when

- VS Code ships a supported way to self-host webviews on an embedder-chosen
  isolated origin.
- World gains an HTTPS name with a wildcard certificate: (b) could remove the
  dependency on vscode-cdn.net, through a reviewed change to the one-origin
  rule.
