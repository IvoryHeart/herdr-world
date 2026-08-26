# Security Policy

## Supported Versions

Security fixes target the latest release and current `main`. Older commits,
prereleases, and locally modified builds are supported only on a best-effort
basis; this personal open-source project does not provide an SLA.

## Reporting A Vulnerability

Use [GitHub private vulnerability reporting](https://github.com/IvoryHeart/herdr-world/security/advisories/new).
Please do not disclose exploitable details in a public issue.

Include the affected revision or release, deployment shape, reproduction steps,
impact, and any suggested mitigation. Reports and fixes are handled on a
best-effort basis. Acknowledgement or publication timing depends on severity
and maintainer availability.

Report vulnerabilities in Herdr itself to `herdrdev/herdr` and vulnerabilities
specific to the upstream browser application to `kcosr/herdr-web`.

## Deployment Boundary

The Herdr World bridge grants admitted browsers terminal-equivalent access to
the connected Herdr runtime. It is local-first and does not provide a complete
authentication or authorization layer. Keep it on loopback unless access is
restricted by a trusted network, firewall, VPN, or authenticated reverse proxy,
and configure allowed hosts and origins explicitly.
