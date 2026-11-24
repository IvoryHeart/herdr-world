## Decisions

The existing channel packers/checks become `release-candidate.yml`, called by version-commit main CI and expired-seal recovery. Six native package jobs build once and launch their archives. Npm staging consumes those archives and its native matrix launches the packed launcher. Homebrew checks the same archives on four Unix platforms, including actual previous-release service upgrades. The agent walk downloads those package artifacts. Only these channel checks and the shipped audit precede the content manifest seal.

The tag workflow selects the exact main push, waits through queueing and one infrastructure retry, then copies its verified artifact into the publishing run. A missing/expired seal calls the same candidate workflow. Publishers retain the manifest check immediately before effects. Existing GitHub/npm/tap identities make retry effects idempotent. Only the owner creates tags; no change to that ruleset or credentials.

Homebrew services resolve executable Cellar paths to the validated opt symlink. Formula finalization refreshes a running generated service from this same formula before cleanup removes the old keg. Installer finalization retains its existing executable ownership check.

PR packaging selection uses explicit native inputs rather than the entire server dependency graph. Main accepts the successful PR result only for an identical tree; otherwise the full Linux suite runs. Nightly native/upgrade failures maintain one advisory issue. Main-gate retains its issue through one infrastructure retry and never creates revert branches. The mandate explicitly permits deleting the broken Help and OpenSpec archive bots. Both are removed; targeted capture and the existing reviewed archive helper remain, without an automatic bot-branch repair loop.

## Evidence and limits

Workflow graph tests assert all contract jobs precede sealing/publication, source/browser gates are absent from release, exact artifact reuse and fallback wiring, native selection, publisher ordering and independent Pages. Registry filesystem fixtures exercise interrupted publication and mismatched bytes; gate tests exhaust waiting/failure/expiry selection; service tests replace and remove kegs while retaining opt. Native channel jobs remain authoritative for actual OS package/service behavior. Q41/Q36 mappings name these consumers; the complete verification gate remains required. The owner's RC rehearsal checks hosted permissions, registries, tap CI and a real upgrade; a one-week comparison checks cost, queue and red-main trends.
