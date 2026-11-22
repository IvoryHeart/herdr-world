### Added

- Code view (`/code`, beside Town, Board and Desk): the complete VS Code of
  the host a project is on, inside World on its own address, with your
  extensions, settings and profile there. For a project on an SSH host World
  starts that host's installed `code serve-web` (or code-server / OpenVSCode
  Server) through the connection's OpenSSH destination and forwards its
  private Unix socket; nothing opens a TCP port or another origin, and nothing
  opens an IDE on a desktop. The workbench fills the view under one thin bar;
  the rail of the project's agents and terminals folds away and starts folded
  on narrow windows. VS Code's light or dark follows World's theme (or
  the system's when World follows it) and switches live with it. Stock VS Code's webviews (Markdown preview, some
  extension panels) stay blank inside World, and Microsoft's VS Code opens
  only when World is on HTTPS or localhost: on a plain-HTTP address the view
  says so and what to do instead of waiting. When VS Code can't download its
  web server, World stops waiting and says what it needs. Each IDE is an
  integration (also in Settings → Integrations): detected when installed, with a download link
  and program path when not, and a trust and licence dialog before first
  enable. World starts a server only when you click Open and reuses it per
  project folder. A server keeps running, with its terminals and tasks,
  when you close the view, World restarts or updates, or the SSH link
  drops; World finds it again and reattaches. Code and Settings →
  Integrations list every running IDE server with since-when and Stop, also
  after a restart and on a host whose connection was removed (with the
  command to stop it there). Only pressing Stop on a server stops it, after
  a warning, and that ends its whole process tree on World's computer or the
  SSH host, terminals that left the tree included; disabling the IDE,
  removing the connection or reaching the limit of four stops none. A Stop
  cut off on its host keeps the server listed until you stop it again.
  code-server's port proxies are off.

### Removed

- The Code view design study's standalone mock page.
