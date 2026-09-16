# Security Policy

## Supported Versions

Security fixes cover the latest release.

## Reporting a Vulnerability

**Do not open a public issue.** Use a private repository security advisory with
versions, reproduction steps, and impact. If unavailable, use the maintainer's
GitHub-profile contact address.

## Trust Model

**UI access grants the Herdr World user's authority:** terminals, repository hooks,
session data, and workspace uploads/deletions. This is privileged administration,
not a sandbox or multi-user permission system.

The default bind is `127.0.0.1`. Listeners configured as `127.0.0.1`, `localhost`,
or `::1` **bypass login even with `HERDR_WORLD_PASSWORD` set**. A VPN, SSH tunnel, or
reverse proxy forwarding to loopback becomes the entire remote access boundary.
Use an independently authenticated proxy if that boundary is insufficient.

**Do not expose Herdr World directly to the public internet.** For non-loopback:

- Set a strong `HERDR_WORLD_PASSWORD`; prefer it to `--password`, which exposes
  secrets in process arguments.
- Use HTTPS or a trusted VPN; restrict access with a firewall/reverse proxy.
- Treat worktree hooks as executable code.

The bridge checks neither browser Origin nor request Host. Any request reaching
it and passing required authentication has full authority. Secure the outer
access path: built-in authentication supplies no TLS, rate limiting, multi-user
authorization, or sandboxing.

Updates trust the configured HTTPS release origin (or explicit loopback test
mirror) and its manifest/checksums. Checksums detect corruption and bind the
archive, **not independently verify publisher identity**. Custom mirrors are
trusted executable-code infrastructure.

Update requests require normal listener authentication plus `x-herdr-world-update: 1`.
That header does not replace login.
