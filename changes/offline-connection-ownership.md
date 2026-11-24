### Fixed

- Serialize offline connection CLI edits with each other and service startup so successful unrelated changes cannot disappear. Busy or uncertain ownership refuses the edit; process exit releases ownership automatically.
- Stop a managed non-loopback World before an offline connection edit with `--restart`, then start it after releasing registry ownership, even on edit refusal.
