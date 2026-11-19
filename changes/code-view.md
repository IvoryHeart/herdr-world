### Added

- Code view (`/code`, beside Town, Board and Desk): the complete VS Code of
  the host a project is on, inside World on its own address, with your
  extensions, settings and profile there. For a project on an SSH host World
  starts that host's installed `code serve-web` (or code-server / OpenVSCode
  Server) through the connection's OpenSSH destination and forwards its
  private Unix socket; nothing opens a TCP port or another origin, and nothing
  opens an IDE on a desktop. The workbench fills the view under one thin bar;
  the rail of the project's agents and terminals folds away and starts folded
  on narrow windows. Stock VS Code's webviews (Markdown preview, some
  extension panels) stay blank inside World. Each IDE is an integration (also
  in Settings → Integrations): detected when installed, with a download link
  and program path when not, and a trust and licence dialog before first
  enable. World starts a server only when you click Open, reuses it per
  project folder, and stops it on Stop, disable, shutdown, or when its
  connection reconnects or changes, ending its whole process tree (server,
  extension hosts, terminal shells) on World's computer or the SSH host.
  code-server's port proxies are off.

### Removed

- The Code view design study's standalone mock page.
