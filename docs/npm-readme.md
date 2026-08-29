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

## Using Herdr's plugin

The Herdr plugin is installed from the Herdr World GitHub repository, not from this npm package:

```bash
herdr plugin install IvoryHeart/herdr-world --ref vX.Y.Z
```

It installs the exact matching npm payload privately inside Herdr's managed plugin checkout and
supervises its bridge for the invoking Herdr session. The plugin requires Node.js 22.14.0 or newer
and npm at installation and runtime; it does not use this package's global installation or a
Homebrew installation. See the repository [plugin documentation](https://github.com/IvoryHeart/herdr-world#herdr-plugin) for
configuration, lifecycle actions, security, and the standalone distribution relationship.
