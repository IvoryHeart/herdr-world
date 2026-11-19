### Added

- Code view (`/code`): open a project in the code-server already installed
  on World's computer, with your own extensions, settings and profile, inside
  World and on its own address. Stock VS Code and OpenVSCode Server load
  extension views from another origin, so they are desktop only: Code gives a
  command and link to open the project in desktop VS Code. The
  project's agents and terminals sit beside it. Each IDE is an integration
  (also in Settings → Integrations): detected when installed, with a download
  link and program path when not, and a trust and licence dialog before first
  enable. World starts a server only when you click Open, reuses it per
  project folder, and stops it on Stop, disable, shutdown, or when its
  connection reconnects or changes. code-server's port proxies are off. Projects over SSH
  get a command and link for desktop VS Code with Remote - SSH.

### Removed

- The Code view design study's standalone mock page.
