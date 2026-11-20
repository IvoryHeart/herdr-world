# Security Policy

## Supported Versions

Security fixes cover the latest release.

## Dependency alerts and ownership

Maintainers own dependency alerts and the `dependency-security` issue queue.
Shipped high or critical vulnerabilities must be fixed or have an approved,
reasoned exception **before the next release**; development-only alerts must be
resolved or explicitly tracked with a mitigation **within one week**. A red
dependency check blocks publication and must not be bypassed for a release.

Run `bun run security:check` to audit the committed Bun and Quint locks against
the [public npm advisory service](https://docs.npmjs.com/cli/v11/commands/npm-audit/#bulk-advisory-endpoint).
It reports package/version, GHSA advisory, severity, the first published newer
stable version outside the affected range, and any exception. Advisory range
matching includes prereleases, using the locked npm semver policy library. The release gate
fails for fixable high/critical advisories in the runtime dependency closure.
All server/web runtime, optional and peer dependencies across target platforms
are potentially shipped: the executable embeds the service and web assets, npm
packages wrap that executable, and Pages reuses web art. This deliberately makes
no claim that tree shaking removes a vulnerable dependency. Root development
dependencies and isolated Quint tooling are reported separately and do not block
shipping. Build tools themselves are not runtime dependencies. The npm launcher
has no third-party runtime imports.

The check runs in protected PR delivery checks (including metadata reruns), daily
on main, and before release or Pages publication. Registry errors fail closed.
The daily/main workflow creates a `crew:ready`, `dependency-security` issue with
`Priority: high` for new shipped high/critical findings, even when no fix exists.
Issues deduplicate by package/advisory; a new affected version after a closed
issue queues another item. Inspect the workflow artifact for the complete report.

Exceptions live in `security/dependency-exceptions.json`. Each entry requires
`package`, exact `version`, `advisory` (the GHSA URL), a specific `reason` and
`expires` (`YYYY-MM-DD`, UTC). Maintainers approve exceptions through normal
independent PR review. An exception expires at the start of that day; expired or
malformed entries fail the gate. An exception permits that exact finding only,
remains visible in reports/issues, and must be removed when the dependency is fixed.

Dependabot covers Actions, the root Bun workspace (`package.json`,
`web/package.json`, `server/package.json`, `bun.lock`) and isolated npm tooling
(`tools/quint/package.json`, `tools/quint/package-lock.json`). Version and security
updates are grouped per ecosystem. Keep dependency graph, Dependabot alerts and
automatic security updates enabled in repository security settings. The
dependency gate checks Bun versions directly, independently of GitHub's alert
ingestion.

For a safe failure demonstration, run `bun run security:check --demo-vulnerable`.
It audits a synthetic shipped `lodash@4.17.15`, exits 1 and names the live GHSA
advisories and available fixes, without changing installed or locked versions.

### November 2026 adm-zip alerts

The eight alerts (#1–#8) were in the **development-only** Quint lock. Quint
0.33.1 upgrades adm-zip from 0.5.18 to 0.6.1, resolving the seven patched alerts.
[GHSA-vwc7-r8mq-g2x9](https://github.com/advisories/GHSA-vwc7-r8mq-g2x9)
has no declared patched version and lists 0.5.9–0.6.0 as affected; 0.6.1 is outside
that published range. Do not infer from that alone that destination symlinks are safe.

The vulnerable operation is extraction with overwrite enabled into a destination
containing a symlink. Quint's `dist/src/rust/binaryManager.js` uses adm-zip's
`extractAllTo(..., true)` only for the Windows Rust evaluator's ZIP installer.
Our supported POSIX verification commands explicitly select the TypeScript
evaluator and TLC, launch the owned Apalache JAR directly and supply its endpoint.
`verification:setup` installs npm dependencies with lifecycle scripts disabled,
then verifies a pinned **tar** archive and JAR digest in a fresh temporary directory.
It never invokes the Rust ZIP installer. The runner policy refuses any `run` without an
explicit `--backend typescript` (including duplicate/backend override flags)
before spawning Quint; its regression preserves this non-reachability claim. Windows checker execution remains unsupported. If an
alert persists after the lock update, dismiss it as code not used with this
analysis linked; re-evaluate before enabling a Rust evaluator or ZIP installer.

## Reporting a Vulnerability

**Do not open a public issue.** Use a private repository security advisory with
versions, reproduction steps, and impact. If unavailable, use the maintainer's
GitHub-profile contact address.

## Trust Model

**UI access grants the Herdr World user's authority:** terminals, repository hooks,
session data, and workspace uploads/deletions. This is privileged administration,
not a sandbox or multi-user permission system.

The default bind is `127.0.0.1`. Every listener requires login, including
`127.0.0.1`, `localhost` and `::1`. Configure `HERDR_WORLD_PASSWORD` with
8–1024 characters or use the generated persistent token. Passwords of at least
15 characters are recommended beyond a trusted private network; startup warns
when a configured password is shorter. Successful login
creates a bounded session signed with a separate random key in private World
storage. Changing the password, generated token or configured PIN rotates that
key and invalidates existing sessions; ordinary restarts preserve sessions.
Repeated login failures receive a cooldown.

`HERDR_WORLD_PIN` optionally enables a 6–12 digit convenience login for trusted
private networks or VPNs. It does not replace the password or generated token.
PIN failures have separate per-client limits and a global one-hour cooldown;
password/token recovery remains available during a PIN lockout.

**Do not expose Herdr World directly to the public internet.** For non-loopback:

- Set a strong `HERDR_WORLD_PASSWORD`; prefer it to `--password`, which exposes
  secrets in process arguments.
- Use HTTPS or a trusted VPN; restrict access with a firewall/reverse proxy.
- Treat worktree hooks as executable code.

The service automatically rejects privileged browser HTTP and WebSocket requests whose
Origin authority does not equal their request Host authority. A loopback listener also
rejects a non-loopback Host authority, preventing a public name from being treated as
the local application through DNS rebinding. This needs no user-maintained allow-list.
An independently authenticated HTTPS reverse proxy to loopback must preserve its public
Host and configure that one exact external origin with `HERDR_WORLD_PUBLIC_ORIGIN` (or
`--public-origin`). Originless native clients remain admissible, so listener access and
authentication are still security boundaries. Configure
[native HTTPS](docs/DEPLOYMENT.md#native-https) or terminate TLS at a trusted proxy. Login throttling applies to authentication attempts. The service supplies no
multi-user authorization or sandboxing.

Built-in sources act with the service user's own access: GitHub through that
user's `gh` sign-in, and Jira with the account email and API token saved in
**Settings → Integrations**. The token is kept in a separate owner-only file in
private World storage, never in `settings.json`, and is never returned to the
browser. Changing the Jira site or email removes the saved token, so it is
only ever sent to the site it was entered for. Anyone who can sign in to World
can see the user's pull requests and tickets, and can replace or remove the
token.

Merging, closing or marking a pull request ready from World runs `gh` with the
service user's sign-in after a confirm in the browser. Merge is pinned to the
head the viewer saw and never bypasses branch protection. These verbs are on
the browser's World API only, not on the `herdr-world` CLI, the agent skill or
MCP. That is a convention, not a boundary: agents run as the same user with
the same `gh` sign-in, so "only a maintainer merges" is a crew rule World does
not enforce.

Updates trust the configured HTTPS release origin (or explicit loopback test
mirror) and its manifest/checksums. Checksums detect corruption and bind the
archive, **not independently verify publisher identity**. Custom mirrors are
trusted executable-code infrastructure.

Update requests require normal listener authentication plus `x-herdr-world-update: 1`.
That header does not replace login.
