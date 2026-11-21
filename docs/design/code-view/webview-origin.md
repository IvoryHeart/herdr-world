# Decision: where stock VS Code's webviews load

Issue #1038, design question 2 of #988. Status: decided. Webviews load from
World's own origin, by the mechanism in PR #1124 (#1053). Options (a) and (b)
are rejected.
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

Serve stock VS Code and OpenVSCode webviews from World's own origin.

- World sets VS Code's own embedder option `webviewEndpoint` in the workbench
  configuration it forwards, pointing at the IDE's copy of its webview host
  page under `/ide/<id>/`. `product.json` is not touched.
- World serves that one page with one edit: its host-name hash check becomes
  "the parent is on this page's own origin", and the page's CSP script hash is
  recomputed, after World proves the old hash is the browser's hash of the
  original script. The rest of its CSP and every other product file reach the
  browser unchanged.
- If either page does not look as World expects, World forwards it unchanged
  and webviews stay blank. code-server is left as it is.
- World's own origin rule and CSP do not change: no second origin, no
  `vscode-cdn.net` in any policy, nothing fetched from Microsoft.

This is option (c)'s result (a same-origin route) reached by a narrower means:
VS Code's own option plus one checked edit, instead of rewriting the product
template.

## Threat model

**What is at stake.** A page on World's origin holds World's browser session:
it can call every World API, which reaches shells on every connected host and
every agent.

**Webview content is untrusted.** Extension panels, notebook outputs and
previews of files from any opened repository are written by people other than
the owner. On World's origin that HTML runs with World's authority, exactly as
code-server's webviews already do. World accepts this, for three reasons:

- The Enable dialog already grants the IDE and its extensions World's
  browser authority and full shell and file access on the IDE's host;
  extensions that draw webviews are the same code.
- The webview host page keeps upstream's CSP, and each webview keeps the CSP
  its extension sets; Markdown preview, for example, blocks document scripts
  by default.
- The added reach is World's other hosts and agents. The owner admits that
  per IDE when enabling it, and code-server users already live with it.

**Other origins.** A web page on another origin (a site the owner visits, a
LAN page) may frame World's host page to obtain its message port and drive a
webview. The page hands its port only to a parent on its own origin, so it
refuses every other parent, whichever parent origin the framing page names.

**Wrong edits.** A future VS Code may change the page. World edits only a page
whose check and hash it can match exactly, and otherwise forwards the page
unchanged, which fails closed to blank webviews.

**Hostile-webview tests (PR #1124).**

- `server/src/ide/webview-host.browser.test.ts`, in headless Chrome:
  - the workbench's webview loads from World's origin under the recomputed CSP
    and gets its port;
  - nothing names `vscode-cdn.net`;
  - the page as shipped refuses a same-origin parent (control);
  - another origin that frames World's host page never gets the port, whether
    it names itself or World as parent.
- `server/src/ide/webview-host.test.ts` and `server/src/ide/proxy.test.ts`:
  - a static route outside the instance, a wrong hash, a different check or a
    duplicated check leave the page unedited;
  - code-server's pages pass byte for byte.

A failure in any of these blocks the change. A new way for another origin to
obtain the port is a security bug, not a known gap.

## Rejected options

### (a) Keep one origin; webviews stay blank

The isolation it buys is small: extension code already runs with World's
authority inside the workbench, and code-server already shows webviews on
World's origin. The price is large: Markdown preview, notebooks and
webview-based extensions (GitLens, Copilot Chat) are blank in the two IDEs
most people use, which pushes them out of World to a desktop editor.

### (b) A second World-owned origin for webviews

It isolates best on paper: webview code would be cross-origin to World. In
practice:

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

### Not offered: admit `*.vscode-cdn.net`

Upstream's default, but it is the cross-origin CSP AGENTS.md forbids and makes
the browser load every webview host page from Microsoft.

## Licence

World edits one Microsoft file in transit, not on disk. The VS Code Server
[licence](https://code.visualstudio.com/license/server) says you "must comply
with any technical limitations in the software that only allow you to use it
in certain ways" (section 5). Whether this edit fits that clause is part of
recording acceptance of Microsoft's server terms (OpenSpec task 1.1), which
stays open. OpenVSCode Server is MIT, so the question applies only to stock
VS Code.

## Revisit when

- VS Code ships a supported way to self-host webviews on the embedder's
  origin: use it and drop the edit.
- World gains an HTTPS name with a wildcard certificate: (b) can be
  reconsidered for stronger isolation, through a reviewed change to the
  one-origin rule.
