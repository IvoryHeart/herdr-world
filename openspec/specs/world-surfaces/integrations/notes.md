# Integrations notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Menu → Settings → Integrations lists runtimes, harness skills, Sources, metrics and vault status.
- Hosts management and each source's settings remain the routes for actual changes.
- Desktop and phone use the same settings screen.
- TUI/core runtime rows retain their own connection and generation; harness skills are local.

**Code:**

- `server/src/features/integrations/`
- `server/src/integrations/http.ts`
- `server/src/integrations/registry.ts`
- `server/src/integrations/vault.ts`
- `web/src/components/IntegrationsSettings.tsx`
- `server/src/cli/integration.ts`

**Tests:**

- `server/src/features/integrations/register.test.ts`
- `server/src/features/integrations/rpc.test.ts`
- `server/src/integrations/registry.test.ts`
- `web/src/configuration.browser.tsx`
- `server/src/cli/integration.test.ts`

**Pitfalls:**

- Opening the registry must not start runtimes, install skills or refresh Sources.
- A failed provider must not hide healthy providers or supply fallback authority.
- Vault status exposes names and consumers, never stored secret values.
- CLI integration commands configure harness skills; they are not a second registry owner.

## Usage reference

### Integrations

**Menu → Settings → Integrations** lists everything World reads from or works through.
**All** opens first and lists every kind under its heading; then one tab per
kind: **Runtimes** (this computer's Herdr or herdr-core and each SSH host),
**Sources** (GitHub, Jira, Weather and Usage metrics), **Agents** (World's skill for
each harness, per host) and **Editors** once one is listed; last, set apart
with its key, the **Vault**. The kind tabs come from the registry's kinds, so a new kind gets
its own tab; a kind with nothing in it has no tab, except Runtimes and
Agents. Each tab shows how many rows it has and a warning mark when one is
failing; the tabs stay on one row and scroll sideways on a phone. The screen
reopens on the tab you last used, or on the row an element's **Connect**
asked for.

**Search** always searches every integration and the vault, by name, status
(`error`, `needs connect`), transport (`ssh`), what a row gives (`tickets`)
or a token's name: typing opens **All** with every match under its kind, and
the counts become match counts. Picking a tab then narrows the results to
that kind; a tab with no match names the tabs that have some
(**Runtimes (1)**) and offers **Clear search**. Agents match within the
host's agent list. To try the screen with dozens of rows, open World with
`?integrationsFixture`: the page drops the parameter and the screen adds 40
sample rows (hosts, trackers and an **Editors** tab) in every state until the
page reloads. Sample rows have no action and give World nothing.

Each row leads with the product's mark where World has one (Herdr, GitHub,
each agent) or a plain symbol (tickets, usage), says what it
gives World (terminals, agents, files, pull requests, tickets, weather or usage) and
shows its state as a coloured chip; its actions stay on its right, on a phone
too. A source's settings open under its row from the settings button
(**Jira settings**). Each kind's own action sits on its heading in **All** and
at the top of its tab: **Add or edit hosts…** for Runtimes, **Refresh
Sources** for Sources.

- **Connected**: in use now.
- **Available**: ready to use; **Connect** switches it on at once.
- **Needs connect**: needs settings first; **Connect** opens them (Jira's site,
  email and token, or the Prometheus URL).
- **Error**: World tried and failed; the row says why.

A source row follows its source while the screen is open: a check that
finishes or fails after the screen opened changes the row at once.

**Connect** and **Disconnect** apply at once. A runtime row acts on the exact
connection it showed: if that connection was replaced since the list was
read, it refuses and asks you to check again rather than acting on the new
one. **Add or edit hosts…** opens the same profile editor as **Hosts → Manage
connections**. Nothing here is required; every request goes from the World
service, never from the browser. A World element missing what it needs (the
closed warehouse, Work's empty lens, Town with no hosts) offers **Connect**,
which opens this screen at that row.

The **Vault** tab shows where World keeps the tokens integrations need
(today only the Jira API token): an owner-only file in World's data
directory. It lists each token by name with the integration that uses it,
never its value. A token is entered in its integration's settings and is
write-only from the browser; links, symlinks or unreadable files are refused. There is no OS keychain backend yet. The registry is read-only
at `GET /api/world/integrations`; editors join it as they land.
