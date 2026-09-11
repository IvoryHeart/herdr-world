# Development tooling

This package pins the local OpenSpec CLI and Codex CLI used by the native workflow.
Its dependencies are isolated in `harness/node_modules`; the repository and web
dependencies keep their own installations and share only npm's download cache.

Run `npm ci --prefix harness` to install the pinned tools. `npm run agent:bootstrap`
also installs the root and web dependencies and activates only the three selected
Superpowers skills for the current worktree. `npm run agent:skills` installs that
selection or migrates the old full-bundle link; it does not install OpenWiki.
`npm run agent:doctor` checks the local toolchain.

`tool-versions.json` records the versions used by the repository workflow and
`github-policy.json` describes the branch rules checked by `npm run agent:rules`.
The optional native task record is written under `.agents/state/task.json` by
`npm run agent:task native` when a task needs durable provenance.
