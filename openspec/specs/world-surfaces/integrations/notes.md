# Integrations notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Menu → Settings → Integrations lists runtimes, harness skills, Sources, metrics and vault status.
- Hosts management and each source's settings remain the routes for actual changes.
- Desktop and phone use the same settings screen.
- TUI/core runtime rows retain their own connection and generation; harness skills are local.

**Code:**

- `server/src/integrations/registry.ts`
- `server/src/integrations/vault.ts`
- `web/src/components/IntegrationsSettings.tsx`
- `server/src/cli/integration.ts`

**Tests:**

- `server/src/integrations/registry.test.ts`
- `web/src/configuration.browser.tsx`
- `server/src/cli/integration.test.ts`

**Pitfalls:**

- Opening the registry must not start runtimes, install skills or refresh Sources.
- A failed provider must not hide healthy providers or supply fallback authority.
- Vault status exposes names and consumers, never stored secret values.
- CLI integration commands configure harness skills; they are not a second registry owner.
