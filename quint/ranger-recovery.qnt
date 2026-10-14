module ranger_recovery {
  pure val BROKEN = false
  type Recovery = { captured: bool, saved: bool, opened: bool, loaded: bool, endpoint: bool, boot: bool, workspace: bool, generation: int, recovered: bool, result: str }
  var recovery: Recovery
  var op: str
  action init = all { recovery' = { captured: false, saved: false, opened: true, loaded: false, endpoint: true, boot: true, workspace: true, generation: 1, recovered: false, result: "none" }, op' = "init" }
  action change(replacement, name) = all { recovery' = replacement, op' = name }
  action capture = all { not(recovery.captured), change({ ...recovery, captured: true }, "capture") }
  action save = all { recovery.captured, not(recovery.saved), recovery.opened, recovery.generation == 1, recovery.endpoint, recovery.boot, recovery.workspace, change({ ...recovery, saved: true }, "save") }
  action failedSave = all { recovery.saved, recovery.opened, change(recovery, "failedSave") }
  action close = all { recovery.saved, recovery.opened, change({ ...recovery, opened: false }, "close") }
  action reopen = all { recovery.saved, not(recovery.opened), change({ ...recovery, opened: true, loaded: true }, "reopen") }
  action runtimeReplacement = all { recovery.saved, recovery.generation == 1, change({ ...recovery, generation: 3 }, "runtimeReplacement") }
  action endpointReplacement = all { recovery.saved, recovery.endpoint, not(recovery.recovered), change({ ...recovery, endpoint: false }, "endpointReplacement") }
  action bootReplacement = all { recovery.saved, recovery.boot, not(recovery.recovered), change({ ...recovery, boot: false }, "bootReplacement") }
  action workspaceReplacement = all { recovery.saved, recovery.workspace, not(recovery.recovered), change({ ...recovery, workspace: false }, "workspaceReplacement") }
  action recover = all {
    recovery.loaded, recovery.result == "none",
    val same = recovery.endpoint and recovery.boot and recovery.workspace
    change({ ...recovery, recovered: same or BROKEN, result: if (same or BROKEN) "accepted" else "rejected" }, "recover"),
  }
  action step = any { capture, save, save, failedSave, close, reopen, runtimeReplacement, endpointReplacement, bootReplacement, workspaceReplacement, recover, recover }
  val identityAdmission = not(recovery.recovered) or (recovery.endpoint and recovery.boot and recovery.workspace)
  val safety = identityAdmission
  val stableRecovery = recovery.recovered
  val freshGeneration = recovery.recovered and recovery.generation == 3
  val endpointRejected = recovery.result == "rejected" and not(recovery.endpoint)
  val bootRejected = recovery.result == "rejected" and not(recovery.boot)
  val workspaceRejected = recovery.result == "rejected" and not(recovery.workspace)
  val transactionFailure = op == "failedSave"
}
