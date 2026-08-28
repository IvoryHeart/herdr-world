# Herdr World

Herdr World is a browser and mobile client for monitoring and controlling Herdr agents.

## Install

```bash
npm install --global @ivoryheart/herdr-world
herdr-world
```

The package contains the tested Linux x64, macOS ARM64, and macOS x64 bridge binaries and the
bundled web application. It requires Node.js 22.14.0 or newer and Linux glibc 2.34 or newer.
Windows, Linux ARM64, musl Linux, and unknown libc environments are not supported.

Package installation only installs files. It does not download or build native code, install Herdr,
create a workspace, or start a process.

Herdr World still requires a running Herdr 0.8.2 or newer session using terminal protocol 20. Start
Herdr from the directory containing the work it should manage, then run `herdr-world`. Use
`herdr-world --help` for bridge options. The bridge binds to loopback by default; Host, Origin, and
Content Security Policy checks are request protections, not user authentication.

The package includes the complete application legal notices and dependency inventories. The exact
source release and package checksums are recorded in the corresponding GitHub release workflow.
