# Decision: where stock VS Code's webviews load

Issue #1038, design question 2 of #988. Status: decided, option (a).
Contract: [world-code-view delta](../../../openspec/changes/world-code-view/specs/world-code-view/spec.md),
requirement "Embedding feasibility and full authority admission".

## The problem

Webviews are the VS Code panels that render HTML: Markdown preview, notebook
outputs, and the custom panels many extensions draw. VS Code runs each one in
an iframe on its own origin, so extension HTML and document content cannot
touch the workbench page. Stock VS Code (`code serve-web`) and OpenVSCode
Server take that origin from `webviewContentExternalBaseUrlTemplate` in their
`product.json`: `https://{{uuid}}.vscode-cdn.net/…`, a Microsoft host. The
server has no flag or setting to change it, and its own CSP admits
`frame-src 'self' https://*.vscode-cdn.net`.

`{{uuid}}` is not random. It is a hash of the parent page's origin and a
per-webview salt, and the webview host page (`pre/index.html`) refuses to run
unless its own host name is that hash or a subdomain of it. Every webview
therefore needs its own host name under a wildcard.

World keeps the browser on one origin (AGENTS.md) and adds
`frame-src 'self' blob: data:` to every IDE response, so those frames never
load. Since #1009 (PR #1036) World embeds stock VS Code and OpenVSCode anyway:
editing, terminals, Git, search and debugging work, webviews stay blank, and
the integration row says so before Enable. code-server serves webviews from
its own route on World's origin, so they show.

## Options

### (a) Keep one origin; webviews stay outside World (recommended)

Stock VS Code and OpenVSCode embed as #1036 ships them, with webviews blank.
Work that needs a webview uses code-server inside World, or VS Code on the
desktop outside World.

- **Authority.** Unchanged. The workbench already runs on World's address with
  World's authority, and the Enable dialog says so. No new code gets it.
- **Isolation.** Webview HTML never runs in World, because it never runs.
- **Licence.** Nothing in Microsoft's server is changed or worked around.
- **Cost.** Markdown preview, notebook outputs and webview-based extensions
  are blank in stock VS Code inside World. That is the visible price.

### (b) A second World-owned origin for webviews

World serves the webview host page from another origin with its own CSP and
points the template there.

- **Authority.** The best isolation of the three: webview code is
  cross-origin to World, and World already refuses browser requests whose
  Origin is not its own host.
- **What it needs.** The host-name hash check means one extra port is not
  enough: each webview needs `<hash>.<webview host>`. On World's own computer
  `*.localhost` resolves without DNS and is a secure context. From another
  device it needs a wildcard DNS name and a wildcard HTTPS certificate,
  because webviews need a secure context; World has neither for a LAN
  address. A second port on the same host would also share World's cookies
  (cookies are scoped by host, not port) and count as the same site.
- **Licence and product files.** For stock VS Code the template can only change
  by rewriting `product.json` or the configuration the server sends, which
  changes Microsoft's product. Its [server licence](https://code.visualstudio.com/license/server)
  says you "must comply with any technical limitations in the software that only
  allow you to use it in certain ways" (section 5). OpenVSCode Server is MIT, so
  this question only applies to stock VS Code.
- **Rules it changes.** AGENTS.md's one-origin rule, World's frame policy for
  IDE responses, a second listener (LAN binding is security-sensitive) and a
  second service-worker scope.

### (c) Rewrite the template to a route on World's origin

World points the template at its own path, as code-server does.

- **Authority.** The worst of the three. Webview HTML (extension panels,
  notebook outputs, previews of files from any repository opened) runs as
  World: it can call every World API with the browser's session, which means
  shells on every connected host and every agent. VS Code put webviews on
  another origin to prevent exactly this.
- **It is not one setting.** The webview host page's host-name check fails on
  World's origin; code-server's `webview.diff` patch also edits `pre/index.html`
  to skip it ("Since our webview origin is the parent authority, we can bypass
  this check"). For stock VS Code that is patching Microsoft's product, the
  same licence problem as (b), and World's spec already says it never rewrites
  product files.
- **Note.** code-server already works this way inside World. Choosing it is a
  separate, visible decision on its Enable dialog; (c) would add that risk to
  IDEs that do not carry it today.

### Not offered: admit `*.vscode-cdn.net`

Letting the IDE's own frame policy through is upstream's default and isolates
well, but it is the cross-origin CSP AGENTS.md forbids, makes the browser load
every webview host page from Microsoft, and still needs a secure context. It is
recorded so it is not rediscovered as new.

## Decision

Option (a). One origin stays. Stock VS Code and OpenVSCode Server embed with
webviews blank; World does not open a second origin, admit Microsoft's, or
rewrite or patch either product's webview template or host page. code-server
remains the in-World choice for webviews. Option (c) is rejected: it hands
extension and document HTML World's authority to fix a preview.

Revisit (b) only when World has an HTTPS name with a wildcard certificate and
a separate change to the one-origin rule admits a webview origin. It would
apply to OpenVSCode Server first, since only stock VS Code carries the licence
question.
